"""
Cumulative Anthropic spend, read without re-scanning the whole ledger.

The LLM cost cap is a *lifetime* ceiling: before every Anthropic call we ask
"what have we spent in total?" and refuse to fire at or above
`settings.llm_cost_cap_usd`. Asked literally — `SUM(estimated_cost_usd)` over
`llm_usage_ledger` with no WHERE — that question costs a full sequential scan
whose price rises with every row the ledger has ever gained. Prod showed 2,547
such scans reading 40.3M rows off a 17k-row table, while `ix_llm_usage_ledger_ts`
sat at zero uses (issue #126).

Splitting the answer in two makes it cheap without changing it:

  settled — everything older than a cutoff a little way in the past. Those rows
            can't change any more, so they're summed once and remembered.
  tail    — everything newer than that cutoff. Its size is bounded by
            wall-clock time rather than by table size, and the `ts` index
            serves it.

Every call reads the tail and rolls the cutoff forward, folding whatever aged
past it into `settled`. Only the first call in a process pays for a full scan.

Why the cutoff *lags* now(): `ts` defaults to `now()`, which is the inserting
transaction's START time, so a row can become visible a moment after the
timestamp it carries. Rows inside the lag window stay in the tail, so a row is
never settled before it is visible — which would drop it from the total for
good.

The total stays exact across processes. `settled` + `tail` covers every row in
the table regardless of who wrote it, so the API and the worker (separate
containers, separate memory) still see each other's spend. A plain in-memory
running counter would not: each would only ever count its own calls.

Event-loop-affine by design, like `utils/ttl_cache.py`: the anchor is swapped
between awaits on one loop thread, and a roll-forward that raced another one is
discarded by an identity check rather than serialised behind a lock. Don't call
this from a `run_cpu` / `run_nlp` worker thread.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Optional, Protocol

# How far behind now() a row must fall before its cost counts as settled. Sized
# for "an INSERT of one ledger row commits within a minute of starting", which
# is generous by three orders of magnitude.
DEFAULT_LAG_SECONDS = 60.0

# One statement, one snapshot: `settled` and `tail` are summed against the same
# cutoff, so every row lands in exactly one of them — never both, never neither.
# `{lag}` is a float this module owns, not caller input; it is formatted in
# because an interval literal cannot be a bind parameter.
_COLD_SQL = """
SELECT
  (SELECT COALESCE(SUM(estimated_cost_usd), 0)::float
     FROM llm_usage_ledger WHERE ts <= b.cutoff)   AS settled,
  (SELECT COALESCE(SUM(estimated_cost_usd), 0)::float
     FROM llm_usage_ledger WHERE ts >  b.cutoff)   AS tail,
  b.cutoff::text                                   AS cutoff
FROM (SELECT now() - interval '{lag} seconds' AS cutoff) b
"""

# GREATEST() keeps the cutoff from ever moving back behind the anchor. Without
# it, two calls less than `lag` apart would put the rows between the old anchor
# and the new cutoff into `settled` (already folded) AND into `tail`, counting
# them twice.
_WARM_SQL = """
SELECT
  (SELECT COALESCE(SUM(estimated_cost_usd), 0)::float
     FROM llm_usage_ledger
    WHERE ts > $1::timestamptz AND ts <= b.cutoff) AS settled,
  (SELECT COALESCE(SUM(estimated_cost_usd), 0)::float
     FROM llm_usage_ledger WHERE ts > b.cutoff)    AS tail,
  b.cutoff::text                                   AS cutoff
FROM (SELECT GREATEST($1::timestamptz, now() - interval '{lag} seconds')
        AS cutoff) b
"""


class _SupportsQueryRaw(Protocol):
    async def query_raw(self, sql: str, *args): ...


@dataclass(frozen=True)
class _Anchor:
    """Spend settled through `through`; anything newer is still read live.

    Frozen so advancing it is a single attribute swap, which is what makes the
    identity check in `total_usd` a valid compare-and-set on one loop thread.
    """

    through: str  # a Postgres timestamptz, in the text form Postgres printed
    settled_usd: float


def _as_pg_timestamp(value: Any) -> Optional[str]:
    """Normalise the driver's `cutoff` back to something Postgres re-parses.

    We ask for `cutoff::text`, so this is already a string in production. The
    datetime branch is here because a raw-query driver is free to hand back a
    parsed value, and a wrong type here would silently reset the anchor on
    every call.
    """
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


class LedgerSpendTracker:
    """Total `llm_usage_ledger` spend in USD, without a full scan per call."""

    def __init__(self, *, lag_seconds: float = DEFAULT_LAG_SECONDS) -> None:
        lag = float(lag_seconds)
        if lag <= 0:
            raise ValueError(
                "lag_seconds must be > 0: a zero lag can settle a row before it is visible"
            )
        self._lag = lag
        self._cold_sql = _COLD_SQL.format(lag=lag)
        self._warm_sql = _WARM_SQL.format(lag=lag)
        self._anchor: Optional[_Anchor] = None
        # Bumped by reset(). The anchor alone can't carry the compare-and-set:
        # a read that starts cold snapshots `None`, and if reset() runs while
        # it is awaiting, `None is None` still matches and the read installs an
        # anchor the reset was meant to clear.
        self._generation = 0

    async def total_usd(self, db: _SupportsQueryRaw) -> float:
        """Every dollar in the ledger, from the first row to the newest one."""
        anchor = self._anchor
        generation = self._generation
        if anchor is None:
            rows = await db.query_raw(self._cold_sql)
        else:
            rows = await db.query_raw(self._warm_sql, anchor.through)

        settled_base = anchor.settled_usd if anchor else 0.0
        if not rows:
            # Shouldn't happen — both statements select from a one-row subquery
            # — but if it does, report what we last knew rather than $0. Zero
            # would read as "nothing spent yet" and quietly lift the cap.
            return settled_base

        row = rows[0]
        settled = settled_base + float(row.get("settled") or 0.0)
        total = settled + float(row.get("tail") or 0.0)

        cutoff = _as_pg_timestamp(row.get("cutoff"))
        if cutoff is not None and self._generation == generation and self._anchor is anchor:
            # Compare-and-set. Every concurrent caller folds onto the SAME
            # `settled_base` it snapshotted, so a lost update can't double-count
            # — but it can install an older cutoff than the one already there
            # and make the next tail re-read rows that were done with. Dropping
            # ours when someone else got there first keeps the cutoff monotonic.
            self._anchor = _Anchor(through=cutoff, settled_usd=settled)
        return total

    def reset(self) -> None:
        """Forget the anchor, so the next read re-sums the ledger from scratch."""
        self._anchor = None
        self._generation += 1


# Process-wide by design: the ledger is global, and the API builds a fresh
# LLMSentenceService per batch request, so a per-instance anchor would be cold
# every time and we'd be back to a full scan per call.
spend_tracker = LedgerSpendTracker()
