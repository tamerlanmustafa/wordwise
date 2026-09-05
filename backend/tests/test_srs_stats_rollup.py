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
import io
import re
import tokenize
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from src.routes.srs import _assemble_box_stats, srs_stats
from src.services.srs_engine import MAX_BOX


#: Columns that hold a timestamp. A comparison against any of these needs a
#: cast on the parameter side.
TIME_COLUMNS = (
    "srs_due_at", "created_at", "updated_at", "finished_at", "occurred_at",
    "ts", "captured_at", "unlocked_at", "verified_at", "run_after",
    "claimed_at", "expires_at", "last_at",
)


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


class TestDatetimeParametersAreCast:
    """A `datetime` compared to a timestamp column must carry an explicit cast.

    Found in prod on 2026-09-05: `GET /srs/stats` answered **500 to every
    request** and had done since 8833a00 landed on 2026-08-21 — a fortnight of
    the HomeScreen's review CTA quietly rendering nothing, because the screen
    catches its own errors and a 500 there looks like an empty deck.

        prisma.errors.RawQueryError:
        operator does not exist: timestamp with time zone <= text

    Prisma's Python client sends a `datetime` parameter as an ISO **string**.
    In an INSERT that is harmless — the target column tells Postgres what to
    parse it as, which is why `student_discount.py` gets away with it — but a
    comparison has no target type to infer from, the parameter stays `text`,
    and inside a prepared statement there is no implicit cast to rescue it.

    Nothing else could have caught this. The suite has no database, so the SQL
    string is never executed; the tests above assert the *arguments* are right
    and the fold is right, and both were. Only the statement was wrong, and the
    only place it ran was production. So the guard is a static one: it reads
    the SQL rather than running it.
    """

    #: `<column> <op> $n` with no `::` after the placeholder. Assignment is
    #: excluded below rather than here, because `=` is both operators in SQL.
    PATTERN = re.compile(
        r"\b(" + "|".join(TIME_COLUMNS) + r")\s*(<=|>=|<|>|=|!=|<>)\s*(\$\d+)(?!\s*::)"
    )

    @staticmethod
    def _sql_only(text: str) -> str:
        """Just the string literals — which is to say, just the SQL.

        Scanning the raw file would mean this rule could never be explained
        beside the code it governs: the comment on `_STATS_ROLLUP_SQL` spells
        out the broken comparison in as many words, and a naive scan reads that
        sentence as the bug. Tokenizing and keeping only STRING tokens drops
        every comment while keeping every statement, which is exactly the split
        that matters here.
        """
        try:
            tokens = tokenize.generate_tokens(io.StringIO(text).readline)
            return "\n".join(t.string for t in tokens if t.type == tokenize.STRING)
        except (tokenize.TokenError, IndentationError, SyntaxError):
            return text

    def _offenders(self, text: str) -> list[str]:
        found = []
        for m in self.PATTERN.finditer(self._sql_only(text)):
            # `verified_at = $3` inside `DO UPDATE SET ...` is an assignment,
            # and an assignment is safe: the target column tells Postgres what
            # to parse the string as. Only a comparison lacks that.
            preceding = self._sql_only(text)[max(0, m.start() - 60): m.start()]
            if m.group(2) == "=" and re.search(r"\bset\b", preceding, re.I):
                continue
            found.append(f"{m.group(1)} {m.group(2)} {m.group(3)}")
        return found

    def test_the_rollup_casts_both_due_windows(self):
        from src.routes.srs import _STATS_ROLLUP_SQL

        assert _STATS_ROLLUP_SQL.count("::timestamptz") == 2

    def test_the_guard_would_have_failed_on_the_statement_that_shipped(self):
        # `_offenders` takes Python source, not bare SQL — it reads the string
        # literals out of a module. This is the statement exactly as it was
        # written when it shipped.
        assert self._offenders(
            'SQL = """COUNT(*) FILTER (WHERE srs_due_at <= $2) AS due_now"""'
        ) == ["srs_due_at <= $2"]

    def test_the_guard_passes_the_statement_as_fixed(self):
        assert self._offenders(
            'SQL = """COUNT(*) FILTER (WHERE srs_due_at <= $2::timestamptz) AS due_now"""'
        ) == []

    def test_the_guard_ignores_a_comment_describing_the_bug(self):
        # Otherwise the fix cannot be documented next to the code it fixed, and
        # the next reader deletes the explanation instead of the violation.
        assert self._offenders('# an uncast `srs_due_at <= $2` compares to text\n') == []

    def test_the_guard_allows_an_assignment(self):
        # `SET verified_at = $3` is safe: the target column tells Postgres what
        # to parse the string as. Only a comparison has no type to infer from.
        assert self._offenders(
            'SQL = """DO UPDATE SET email = $2, verified = true, verified_at = $3"""'
        ) == []

    def test_no_route_or_service_compares_a_timestamp_column_to_a_bare_parameter(self):
        src = Path(__file__).resolve().parents[1] / "src"
        offenders: dict[str, list[str]] = {}
        for path in sorted(src.rglob("*.py")):
            found = self._offenders(path.read_text())
            if found:
                offenders[str(path.relative_to(src))] = found

        assert offenders == {}, (
            f"{offenders} compare a timestamp column to an uncast parameter. "
            "Prisma sends a datetime as text, and a prepared statement will not "
            "coerce it — add ::timestamptz to the placeholder."
        )
