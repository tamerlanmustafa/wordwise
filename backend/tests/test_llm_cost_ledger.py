"""
Unit tests for LedgerSpendTracker — the cumulative-spend read that sits in
front of every Anthropic call (issue #126).

DB-free. `_FakeLedgerDb` keeps (ts, cost) rows and answers either statement by
comparing timestamps the same way the real WHERE clauses do, so these tests
exercise the settled/tail split itself rather than a mocked return value. The
invariant under test is always the same one: whatever the tracker reports must
equal a plain SUM() over every row, because the cap is a lifetime ceiling.

Timestamps are floats here rather than datetimes; the tracker only ever passes
the cutoff string back to the database untouched, so their format is irrelevant
to it.
"""
from __future__ import annotations

import asyncio

import pytest

from src.services.llm_cost_ledger import LedgerSpendTracker

LAG = 60.0


class _FakeLedgerDb:
    """A ledger table small enough to hold in a list."""

    def __init__(self, lag: float = LAG) -> None:
        self.rows: list[tuple[float, float]] = []  # (ts, cost)
        self.now = 1_000.0
        self.lag = lag
        self.queries: list[tuple[str, tuple]] = []
        self.full_scans = 0  # reads with no lower bound — what #126 is about

    # ── table under the test ────────────────────────────────────────────
    def add(self, cost: float, *, at: float | None = None) -> None:
        self.rows.append((self.now if at is None else at, cost))

    def tick(self, seconds: float) -> None:
        self.now += seconds

    @property
    def true_total(self) -> float:
        """What the original `SUM(estimated_cost_usd)` with no WHERE returned."""
        return sum(cost for _ts, cost in self.rows)

    # ── the two statements ──────────────────────────────────────────────
    async def query_raw(self, sql: str, *args):
        self.queries.append((sql, args))
        await asyncio.sleep(0)  # a real round trip yields; let callers interleave
        if "$1" in sql:
            anchor = float(args[0])
            cutoff = max(anchor, self.now - self.lag)  # models GREATEST() in the SQL
            settled = sum(c for ts, c in self.rows if anchor < ts <= cutoff)
        else:
            self.full_scans += 1
            cutoff = self.now - self.lag
            settled = sum(c for ts, c in self.rows if ts <= cutoff)
        tail = sum(c for ts, c in self.rows if ts > cutoff)
        return [{"settled": settled, "tail": tail, "cutoff": f"{cutoff:.6f}"}]


def _tracker() -> LedgerSpendTracker:
    return LedgerSpendTracker(lag_seconds=LAG)


# ─── the scan the issue is about ────────────────────────────────────────────

async def test_only_the_first_call_reads_the_whole_ledger():
    db = _FakeLedgerDb()
    for _ in range(5):
        db.add(1.0, at=db.now - 5_000)  # old enough to settle immediately
    tracker = _tracker()

    assert await tracker.total_usd(db) == pytest.approx(5.0)
    assert db.full_scans == 1

    for _ in range(20):
        assert await tracker.total_usd(db) == pytest.approx(5.0)

    # Every later read is bounded by the anchor, so the ledger's size stops
    # mattering — that is the whole fix.
    assert db.full_scans == 1
    assert all("$1" in sql for sql, _args in db.queries[1:])


async def test_later_reads_bind_the_anchor_postgres_handed_back():
    db = _FakeLedgerDb()
    db.add(2.0, at=db.now - 5_000)
    tracker = _tracker()

    await tracker.total_usd(db)
    await tracker.total_usd(db)

    _sql, args = db.queries[1]
    assert args == (f"{db.now - LAG:.6f}",)


# ─── the number itself ──────────────────────────────────────────────────────

async def test_total_tracks_a_full_sum_as_rows_age_past_the_cutoff():
    db = _FakeLedgerDb()
    tracker = _tracker()

    for _round in range(6):
        db.add(0.25)
        db.add(0.75)
        assert await tracker.total_usd(db) == pytest.approx(db.true_total)
        db.tick(45.0)  # less than the lag, so rows settle mid-flight
        assert await tracker.total_usd(db) == pytest.approx(db.true_total)

    assert db.true_total == pytest.approx(6.0)
    assert db.full_scans == 1


async def test_a_row_written_this_second_counts_immediately():
    """The tail is what makes the cap responsive; a lag that hid new spend
    would let the worker keep buying past the ceiling."""
    db = _FakeLedgerDb()
    db.add(10.0, at=db.now - 5_000)
    tracker = _tracker()
    assert await tracker.total_usd(db) == pytest.approx(10.0)

    db.add(3.0)  # inside the lag window — still unsettled
    assert await tracker.total_usd(db) == pytest.approx(13.0)


async def test_spend_from_another_process_shows_up():
    """The API and the worker are separate containers. Rows the tracker never
    saw written must still land in the total, which is why the tail is read
    from the table instead of counted in memory."""
    db = _FakeLedgerDb()
    db.add(1.0, at=db.now - 5_000)
    tracker = _tracker()
    await tracker.total_usd(db)

    db.add(4.0, at=db.now - 30)  # written by someone else, after our anchor
    assert await tracker.total_usd(db) == pytest.approx(5.0)


async def test_a_clock_that_steps_backwards_does_not_double_count():
    """Postgres owns every timestamp here, but its own clock can still step
    back — an NTP correction, or a failover onto a host that is a few seconds
    behind. The cutoff is pinned to the anchor when that happens (GREATEST in
    the SQL); letting it slide back would put already-settled rows into the
    tail as well, inflating the total and tripping the cap early."""
    db = _FakeLedgerDb()
    db.add(2.0, at=db.now - 5_000)
    tracker = _tracker()
    await tracker.total_usd(db)

    db.add(1.0, at=db.now - 2)  # lands just under where the cutoff will settle
    db.tick(60.0)
    assert await tracker.total_usd(db) == pytest.approx(3.0)

    db.tick(-5.0)
    assert await tracker.total_usd(db) == pytest.approx(3.0)


async def test_a_row_backdated_beyond_the_lag_is_lost():
    """Pins the one thing the lag buys, and its limit. A row is settled once it
    is `lag` old, so an INSERT that only becomes visible after that — `ts` is
    the transaction's start time, not its commit time — is never counted. One
    ledger INSERT commits in well under a millisecond, so 60s of headroom is
    the trade; changing the lag or the bounds should have to change this test."""
    db = _FakeLedgerDb()
    db.add(5.0, at=db.now - 5_000)
    tracker = _tracker()
    await tracker.total_usd(db)  # anchors at now - lag

    db.add(1.0, at=db.now - 5 * LAG)  # older than the anchor: already settled past
    assert await tracker.total_usd(db) == pytest.approx(5.0)
    assert db.true_total == pytest.approx(6.0)


# ─── concurrency ────────────────────────────────────────────────────────────

async def test_concurrent_readers_do_not_double_count_the_roll_forward():
    """Both callers read the same anchor, then both try to advance it. Only one
    advance may stick, or the loser's rows get folded into the baseline twice
    and the cap fires early."""
    db = _FakeLedgerDb()
    db.add(1.0, at=db.now - 5_000)
    tracker = _tracker()
    await tracker.total_usd(db)  # anchor it

    db.add(2.0)
    db.add(3.0)
    db.tick(2 * LAG)  # both are now old enough to fold into the baseline

    totals = await asyncio.gather(*(tracker.total_usd(db) for _ in range(4)))
    assert totals == pytest.approx([6.0] * 4)
    assert await tracker.total_usd(db) == pytest.approx(6.0)


async def test_concurrent_cold_starts_do_not_double_count():
    db = _FakeLedgerDb()
    db.add(7.5, at=db.now - 5_000)
    tracker = _tracker()

    totals = await asyncio.gather(*(tracker.total_usd(db) for _ in range(3)))
    assert totals == pytest.approx([7.5] * 3)
    assert await tracker.total_usd(db) == pytest.approx(7.5)


# ─── degraded reads ─────────────────────────────────────────────────────────

async def test_an_empty_result_reports_the_last_known_total_not_zero():
    """Reporting $0 would read as 'nothing spent yet' and lift the cap."""
    db = _FakeLedgerDb()
    db.add(9.0, at=db.now - 5_000)
    tracker = _tracker()
    await tracker.total_usd(db)

    async def _empty(sql: str, *args):
        return []

    db.query_raw = _empty  # type: ignore[method-assign]
    assert await tracker.total_usd(db) == pytest.approx(9.0)


async def test_reset_re_sums_the_ledger_from_scratch():
    db = _FakeLedgerDb()
    db.add(1.0, at=db.now - 5_000)
    tracker = _tracker()
    await tracker.total_usd(db)
    assert db.full_scans == 1

    tracker.reset()
    assert await tracker.total_usd(db) == pytest.approx(1.0)
    assert db.full_scans == 2


async def test_reset_survives_a_read_that_was_already_in_flight():
    """The read below starts cold, so it snapshots an anchor of None. If the
    compare-and-set only compared anchors, `None is None` would still match on
    the way out and the read would quietly install the anchor reset() just
    cleared — leaving the next call memoised against a ledger nobody re-summed."""
    db = _FakeLedgerDb()
    db.add(4.0, at=db.now - 5_000)
    tracker = _tracker()

    arrived, released = asyncio.Event(), asyncio.Event()
    ungated = db.query_raw

    async def _gated(sql: str, *args):
        rows = await ungated(sql, *args)
        arrived.set()
        await released.wait()
        return rows

    db.query_raw = _gated  # type: ignore[method-assign]
    reader = asyncio.create_task(tracker.total_usd(db))
    await arrived.wait()
    tracker.reset()
    released.set()
    assert await reader == pytest.approx(4.0)

    db.query_raw = ungated  # type: ignore[method-assign]
    assert await tracker.total_usd(db) == pytest.approx(4.0)
    assert db.full_scans == 2  # the reset was honoured, not overwritten


def test_a_zero_lag_is_rejected():
    """Settling a row the instant its timestamp passes could settle it before
    the INSERT is visible, dropping the cost from the total permanently."""
    with pytest.raises(ValueError):
        LedgerSpendTracker(lag_seconds=0)
