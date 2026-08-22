"""
Achievement checks are two round trips, not one per key (issue #135).

`check_and_unlock` used to loop over the keys it was given and, for each one,
`SELECT` the definition, `INSERT` the progress, then `SELECT` the row back to
work out whether the badge had just been earned. `/achievements/check` sends
18 keys, so opening the badge screen cost up to 54 serialized database calls
for 18 rows of static reference data.

What is protected here:

1. The definitions are read once per process, not once per key per call.
2. Progress for every key travels in a single statement.
3. "Newly unlocked" is decided from state read *before* the write, not from how
   recently `unlocked_at` was stamped. The old ±2s timestamp heuristic
   re-reported a badge whenever two checks landed within two seconds of each
   other, which is exactly what a save followed by a screen open looks like.
4. An already-earned badge is never re-announced and never revoked, even when
   progress falls back below the threshold (a user deleting saved words).
"""
from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

from src.routes import gamification
from src.routes.gamification import (
    _plan_unlocks,
    check_and_unlock,
    reset_achievement_defs_cache,
)


DEFS = [
    {"key": "first_save", "title": "First Save", "description": None,
     "icon": "star", "category": "words", "threshold": 1},
    {"key": "word_collector_10", "title": "Ten Words", "description": None,
     "icon": "book", "category": "words", "threshold": 10},
    {"key": "streak_3", "title": "Three Days", "description": None,
     "icon": "flame", "category": "streak", "threshold": 3},
]

DEFS_BY_KEY = {d["key"]: d for d in DEFS}


class _FakeDb:
    """Records every call so the tests can count round trips."""

    def __init__(self, unlocked_keys=()):
        self.queries: list[tuple[str, tuple]] = []
        self.executes: list[tuple[str, tuple]] = []
        self._unlocked = list(unlocked_keys)

    async def query_raw(self, sql, *args):
        self.queries.append((sql, args))
        if "FROM achievements" in sql:
            return [dict(d) for d in DEFS]
        if "user_achievements" in sql:
            return [{"achievement_key": k} for k in self._unlocked]
        return []

    async def execute_raw(self, sql, *args):
        self.executes.append((sql, args))
        return len(args)


def setup_function(_fn):
    # The defs cache is process-wide by design; a test that populated it must
    # not decide the next test's round-trip count.
    reset_achievement_defs_cache()


def teardown_module(_mod):
    reset_achievement_defs_cache()


class TestPlanUnlocks:
    def test_crossing_the_threshold_is_newly_unlocked(self):
        rows, newly = _plan_unlocks(DEFS_BY_KEY, set(), {"first_save": 1})

        assert rows == [{"key": "first_save", "progress": 1, "unlocked": True}]
        assert [n.key for n in newly] == ["first_save"]
        assert newly[0].title == "First Save"

    def test_below_the_threshold_is_written_but_not_announced(self):
        rows, newly = _plan_unlocks(DEFS_BY_KEY, set(), {"word_collector_10": 4})

        assert rows == [{"key": "word_collector_10", "progress": 4, "unlocked": False}]
        assert newly == []

    def test_already_unlocked_is_never_announced_twice(self):
        rows, newly = _plan_unlocks(
            DEFS_BY_KEY, {"first_save"}, {"first_save": 12}
        )

        assert rows[0]["unlocked"] is True   # still written, progress moved
        assert newly == []

    def test_unknown_key_is_skipped_not_written(self):
        rows, newly = _plan_unlocks(DEFS_BY_KEY, set(), {"no_such_badge": 99})

        assert rows == []
        assert newly == []

    def test_every_key_lands_in_one_payload(self):
        checks = {"first_save": 1, "word_collector_10": 10, "streak_3": 0}
        rows, newly = _plan_unlocks(DEFS_BY_KEY, set(), checks)

        assert len(rows) == 3
        assert {n.key for n in newly} == {"first_save", "word_collector_10"}


class TestRoundTrips:
    def test_cold_process_is_three_calls_for_any_number_of_keys(self):
        db = _FakeDb()
        checks = {"first_save": 1, "word_collector_10": 10, "streak_3": 5}

        newly = asyncio.run(check_and_unlock(db, user_id=1, checks=checks))

        # defs + existing-unlocks read, then one write.
        assert len(db.queries) == 2
        assert len(db.executes) == 1
        assert {n.key for n in newly} == {"first_save", "word_collector_10", "streak_3"}

    def test_warm_process_drops_the_defs_query(self):
        first = _FakeDb()
        asyncio.run(check_and_unlock(first, user_id=1, checks={"first_save": 1}))

        second = _FakeDb()
        asyncio.run(check_and_unlock(second, user_id=1, checks={"first_save": 1}))

        assert len(second.queries) == 1     # the defs are memoized
        assert "FROM achievements" not in second.queries[0][0]

    def test_the_write_carries_every_key_in_one_payload(self):
        db = _FakeDb()
        checks = {"first_save": 1, "word_collector_10": 3, "streak_3": 4}

        asyncio.run(check_and_unlock(db, user_id=42, checks=checks))

        _sql, args = db.executes[0]
        user_id, payload, _now = args
        assert user_id == 42
        rows = json.loads(payload)
        assert {r["key"] for r in rows} == set(checks)
        assert {r["key"]: r["unlocked"] for r in rows} == {
            "first_save": True, "word_collector_10": False, "streak_3": True,
        }

    def test_already_unlocked_badges_are_not_reannounced(self):
        db = _FakeDb(unlocked_keys=["first_save"])

        newly = asyncio.run(
            check_and_unlock(db, user_id=1, checks={"first_save": 50, "streak_3": 3})
        )

        assert [n.key for n in newly] == ["streak_3"]

    def test_no_known_keys_means_no_write_at_all(self):
        db = _FakeDb()

        newly = asyncio.run(check_and_unlock(db, user_id=1, checks={"bogus": 1}))

        assert newly == []
        assert db.executes == []

    def test_upsert_never_clears_an_earned_badge(self):
        # Progress can regress (words get deleted); the badge must not.
        db = _FakeDb()
        asyncio.run(check_and_unlock(db, user_id=1, checks={"first_save": 0}))

        sql, _args = db.executes[0]
        assert "user_achievements.unlocked OR EXCLUDED.unlocked" in sql
        assert "WHEN user_achievements.unlocked THEN user_achievements.unlocked_at" in sql


class TestMyAchievementsSharesTheCache:
    def test_badge_screen_does_not_reread_the_definitions(self):
        db = _FakeDb()
        asyncio.run(check_and_unlock(db, user_id=1, checks={"first_save": 1}))

        db2 = _FakeDb()
        resp = asyncio.run(
            gamification.my_achievements(
                current_user=SimpleNamespace(id=1), db=db2
            )
        )

        assert len(db2.queries) == 1
        assert "FROM achievements" not in db2.queries[0][0]
        assert resp.total_available == len(DEFS)
        # Ordering moved to Python; it must still be (category, threshold).
        assert [a.key for a in resp.achievements] == [
            "streak_3", "first_save", "word_collector_10",
        ]
