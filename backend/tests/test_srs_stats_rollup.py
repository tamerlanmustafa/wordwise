"""
`GET /srs/stats` answers from one query instead of eight (issue #134).

The HomeScreen review CTA asks for this on every open. It used to issue a
`count()` for the total, one for each of the two due windows, and one per
Leitner box — nine awaits back to back, each waiting for the previous to
return, on an endpoint whose own docstring says "cheap queries only". They are
individually cheap and collectively serialized: a 5ms round trip costs 45ms
when you make nine of them.

What is protected here:

1. The counts are the same numbers the eight queries produced, including the
   boxes a user has nothing in (the GROUP BY can't emit a row for those).
2. It is *one* database call, whatever the box count is.
3. Rows in a box outside 1..MAX_BOX still reach `total_saved` — the totals must
   not quietly disagree with what is in the table.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from src.routes.srs import _assemble_box_stats, srs_stats
from src.services.srs_engine import MAX_BOX


def _row(box, in_box, due_now=0, due_today=0):
    return {
        "srs_box": box,
        "in_box": in_box,
        "due_now": due_now,
        "due_today": due_today,
    }


class TestAssembleBoxStats:
    def test_empty_deck_still_lists_every_box(self):
        total, due_now, due_today, by_box = _assemble_box_stats([])

        assert (total, due_now, due_today) == (0, 0, 0)
        assert by_box == {b: 0 for b in range(1, MAX_BOX + 1)}

    def test_totals_are_the_sum_across_boxes(self):
        rows = [
            _row(1, 10, due_now=4, due_today=6),
            _row(3, 5, due_now=1, due_today=2),
        ]
        total, due_now, due_today, by_box = _assemble_box_stats(rows)

        assert total == 15
        assert due_now == 5
        assert due_today == 8
        assert by_box[1] == 10
        assert by_box[3] == 5

    def test_boxes_with_nothing_in_them_report_zero(self):
        # The GROUP BY emits no row for an empty box, but the client renders a
        # bar per box and needs the key present.
        total, _, _, by_box = _assemble_box_stats([_row(2, 7)])

        assert total == 7
        assert sorted(by_box) == list(range(1, MAX_BOX + 1))
        assert by_box[2] == 7
        assert all(by_box[b] == 0 for b in by_box if b != 2)

    def test_box_outside_the_range_still_counts_toward_the_total(self):
        # A row written by an older engine (or a future one) must not vanish
        # from `total_saved` just because it has no bar to sit in.
        total, _, _, by_box = _assemble_box_stats([_row(1, 3), _row(99, 2)])

        assert total == 5
        assert 99 not in by_box

    def test_null_box_counts_toward_the_total(self):
        total, _, _, by_box = _assemble_box_stats([_row(None, 4)])

        assert total == 4
        assert by_box == {b: 0 for b in range(1, MAX_BOX + 1)}


class TestStatsRoundTrips:
    """The whole point of #134: the count of database calls, not the numbers."""

    def _db(self, calls):
        async def query_raw(sql, *args):
            calls.append((sql, args))
            return [
                _row(1, 6, due_now=2, due_today=3),
                _row(4, 2, due_now=0, due_today=1),
            ]

        async def count(where=None):  # pragma: no cover - must not be reached
            raise AssertionError("srs_stats issued a per-box count() again")

        return SimpleNamespace(
            query_raw=query_raw,
            userword=SimpleNamespace(count=count),
        )

    def _user(self):
        return SimpleNamespace(
            id=7,
            isAdmin=True,
            srsTotalReviews=20,
            srsTotalCorrect=15,
            srsCurrentStreak=3,
            srsLongestStreak=9,
            srsLastSessionStartedAt=None,
        )

    def test_one_query_regardless_of_box_count(self):
        calls: list = []
        resp = asyncio.run(srs_stats(current_user=self._user(), db=self._db(calls)))

        assert len(calls) == 1, f"expected 1 round trip, got {len(calls)}"
        assert resp.total_saved == 8
        assert resp.due_now == 2
        assert resp.due_today == 4
        assert resp.by_box == {1: 6, 2: 0, 3: 0, 4: 2, 5: 0}
        assert resp.retention_pct == 75

    def test_due_windows_are_passed_as_now_and_end_of_day(self):
        calls: list = []
        asyncio.run(srs_stats(current_user=self._user(), db=self._db(calls)))

        _sql, args = calls[0]
        user_id, now, end_of_day = args
        assert user_id == 7
        assert now.tzinfo is not None and end_of_day.tzinfo is not None
        # end_of_day is the *same* day, later than now — a stats call at 23:59
        # must not report tomorrow's cards as due today.
        assert end_of_day >= now
        assert end_of_day - now < timedelta(days=1)
        assert end_of_day.date() == datetime.now(timezone.utc).date()
