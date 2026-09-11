"""Seven days, and each of them has to be honest.

The Practice header used to be two chips: a freeze count and a streak count. A
number on its own is a scoreboard; a row of days with a gap in it is feedback
you can act on, which is why every app with this mechanic eventually ships the
strip.

The strip is DERIVED, from `practice_sessions.local_date` and
`user_streak_freezes.covered_date`, rather than stored. A denormalised "week"
column would be a second copy of the same fact needing invalidation on every
completion, every freeze spend and every timezone change; seven rows off two
indexes is cheaper than the bug that eventually follows from that.

The distinction these tests care most about is `frozen` vs `missed`. Both are
days the user did not practise, and collapsing them would be simpler — but a
day a freeze paid for, drawn as a gap, reports the freeze as having *failed*,
on the one mechanic the user is being asked to trust.
"""
from datetime import date, datetime, timezone

import pytest

from src.services.streak_service import build_week, week_bounds


class Row:
    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


class Table:
    """Returns everything it holds. The range filter is Postgres's job; these
    tests seed only in-range rows and assert the mapping, which is the part
    written in Python."""

    def __init__(self, rows):
        self.rows = rows
        self.queries: list[dict] = []

    async def find_many(self, where):
        self.queries.append(where)
        return self.rows


class DB:
    def __init__(self, sessions=(), freezes=()):
        self.practicesession = Table(list(sessions))
        self.userstreakfreeze = Table(list(freezes))


def dt(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)


MON = date(2026, 9, 7)
TUE, WED, THU, FRI, SAT, SUN = (date(2026, 9, d) for d in (8, 9, 10, 11, 12, 13))


class TestWeekBounds:
    def test_the_week_is_monday_to_sunday(self):
        assert week_bounds(FRI) == (MON, SUN)

    def test_monday_and_sunday_land_in_the_same_week(self):
        # Off-by-one on either end shows up here: a Sunday that rolled into
        # next week would make the strip jump on the wrong night.
        assert week_bounds(MON) == (MON, SUN)
        assert week_bounds(SUN) == (MON, SUN)


class TestTheStates:
    @pytest.mark.asyncio
    async def test_a_realistic_week(self):
        # Practised Mon+Tue, froze Wed, missed Thu, today is Fri and not yet
        # done, weekend still to come.
        db = DB(
            sessions=[Row(localDate=dt(MON)), Row(localDate=dt(TUE))],
            freezes=[Row(coveredDate=dt(WED))],
        )
        week = await build_week(db, user_id=1, today=FRI)

        assert [d["state"] for d in week] == [
            "done", "done", "frozen", "missed", "missed", "future", "future"
        ]
        assert [d["is_today"] for d in week] == [False] * 4 + [True] + [False] * 2
        assert week[0]["date"] == MON.isoformat()

    @pytest.mark.asyncio
    async def test_a_frozen_day_is_not_a_missed_day(self):
        # The distinction the whole column exists for. If this ever collapses,
        # the app tells a user their freeze did nothing.
        db = DB(freezes=[Row(coveredDate=dt(TUE))])
        week = await build_week(db, user_id=1, today=FRI)
        assert week[1]["state"] == "frozen"
        assert week[2]["state"] == "missed"

    @pytest.mark.asyncio
    async def test_practising_beats_a_freeze_on_the_same_day(self):
        # Can only happen if something upstream went wrong — a freeze covering
        # a day the user was active. `done` wins, because that is the fact the
        # user actually experienced.
        db = DB(sessions=[Row(localDate=dt(TUE))], freezes=[Row(coveredDate=dt(TUE))])
        week = await build_week(db, user_id=1, today=FRI)
        assert week[1]["state"] == "done"

    @pytest.mark.asyncio
    async def test_today_is_missed_until_it_is_done(self):
        # Not "future". Today is a day you can still lose, and drawing it as
        # untouchable removes the only nudge the strip exists to give.
        db = DB()
        week = await build_week(db, user_id=1, today=FRI)
        assert week[4]["state"] == "missed"
        assert week[4]["is_today"] is True

    @pytest.mark.asyncio
    async def test_today_done_reads_done(self):
        db = DB(sessions=[Row(localDate=dt(FRI))])
        week = await build_week(db, user_id=1, today=FRI)
        assert week[4]["state"] == "done"

    @pytest.mark.asyncio
    async def test_an_empty_week_is_all_missed_then_future(self):
        db = DB()
        week = await build_week(db, user_id=1, today=WED)
        assert [d["state"] for d in week] == [
            "missed", "missed", "missed", "future", "future", "future", "future"
        ]

    @pytest.mark.asyncio
    async def test_it_always_returns_exactly_seven(self):
        for today in (MON, WED, SUN):
            assert len(await build_week(DB(), user_id=1, today=today)) == 7


class TestTheQueries:
    @pytest.mark.asyncio
    async def test_it_only_counts_completed_sessions(self):
        # A dealt-but-abandoned deck is not a day practised. Those rows are
        # kept on purpose, so the filter is what stops them counting.
        db = DB()
        await build_week(db, user_id=1, today=FRI)
        where = db.practicesession.queries[0]
        assert where["completedAt"] == {"not": None}
        assert where["userId"] == 1

    @pytest.mark.asyncio
    async def test_both_queries_are_bounded_to_the_week(self):
        # Unbounded, this would scan a user's whole history on every
        # /daily/state — a read that fires on every Practice tab visit.
        db = DB()
        await build_week(db, user_id=1, today=FRI)
        for where in (db.practicesession.queries[0], db.userstreakfreeze.queries[0]):
            rng = where.get("localDate") or where.get("coveredDate")
            assert rng and "gte" in rng and "lte" in rng
