"""
The Practice lesson number belongs to the account, not to the phone.

Reported 2026-09-04: the same login showed **lesson 34 on iOS and lesson 8 on
Android**. Nothing was corrupt — the cursor had simply never been a property
of the user. It lived in AsyncStorage (`practice.path.cursor.v1`), which is
per *install*, so the two phones were keeping two counters that had never met.
Reinstalling reset it to lesson 1 for the same reason, and none of that was
visible as a bug until someone signed in twice.

`users.practice_lessons_completed` is where it lives now, and this file pins
the two writes that keep it honest:

  1. `/srs/session/complete` increments it — the same event that already
     records the streak day, under the same guard.
  2. `/srs/practice-progress` **merges** an install's number into it with
     GREATEST, rather than overwriting.

Why a merge and not a PUT is the whole design. The column starts at 0 for
every existing user, so a client that simply adopted the server's value would
tell a long-standing user their progress was gone; a server that simply took
the client's value would let a fresh install (which reports 0) erase an
account, and reinstalls are far more common than the bug being fixed. GREATEST
is commutative and idempotent, so the result does not depend on which device
syncs first, how many times a request is retried, or whether two arrive at
once — which is also why no backfill had to be written. The devices heal the
column themselves on next launch.

Monotonicity is the property under test throughout: **this number must never
go down**, for either side.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

# The endpoints read the real clock, so a fixture pinned to a hard-coded
# "yesterday" only looks like yesterday on the day it was written — see the
# note in test_session_completion.py, which this file deliberately mirrors.
REAL_TODAY = datetime.now(timezone.utc).date()
REAL_YESTERDAY = REAL_TODAY - timedelta(days=1)


def _dt(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)


def _user(**overrides):
    base = dict(
        id=1,
        srsCurrentStreak=0,
        srsLongestStreak=0,
        srsLastSessionDate=_dt(REAL_YESTERDAY),
        srsTotalReviews=0,
        srsTotalCorrect=0,
        srsLastChestDate=None,
        unlockedCosmetics=None,
        practiceLessonsCompleted=0,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


class _FakeUserTable:
    def __init__(self, user):
        self._user = user

    async def find_unique(self, where):
        u = self._user
        return u if u is not None and where.get("id") == u.id else None

    async def update(self, where, data):
        for k, v in data.items():
            setattr(self._user, k, v)
        return self._user


class _FakeDb:
    """Stands in for the two raw statements the counter is written with.

    Both are raw on purpose: `+ 1` and `GREATEST` have to be evaluated by
    Postgres so that two devices writing at the same moment cannot read the
    same N and both write N+1. A read-modify-write in Python would pass every
    test here and lose a lesson in production.
    """

    def __init__(self, user):
        self.user = _FakeUserTable(user)
        self.statements: list[str] = []

    async def execute_raw(self, sql: str, *args):
        self.statements.append(sql)
        u = self.user._user
        if u is None or args[0] != u.id:
            return 0
        current = u.practiceLessonsCompleted or 0
        if "GREATEST" in sql:
            u.practiceLessonsCompleted = max(current, args[1])
        else:
            u.practiceLessonsCompleted = current + 1
        return 1


@pytest.fixture(autouse=True)
def _no_milestone_writes(monkeypatch):
    async def _noop(db, **kwargs):
        return []

    monkeypatch.setattr("src.services.srs_engine.apply_milestone_unlocks", _noop)


async def _sync(db, submitted: int):
    from src.routes.srs import PracticeProgressBody, sync_practice_progress

    return await sync_practice_progress(
        PracticeProgressBody(lessons_completed=submitted),
        current_user=SimpleNamespace(id=1),
        db=db,
    )


# ---------------------------------------------------------------------------
# 1. The reported bug: two installs, two numbers, one account
# ---------------------------------------------------------------------------

class TestTheTwoDevices:
    async def test_the_further_ahead_install_defines_the_account(self):
        """iOS is on lesson 34 and the column has never been written."""
        db = _FakeDb(_user(practiceLessonsCompleted=0))

        res = await _sync(db, 34)

        assert res.lessons_completed == 34
        assert db.user._user.practiceLessonsCompleted == 34

    async def test_the_behind_install_is_pulled_forward_not_backward(self):
        """Android then syncs its 8 and must come back with 34, not keep 8 and
        certainly not push the account back down to it."""
        db = _FakeDb(_user(practiceLessonsCompleted=34))

        res = await _sync(db, 8)

        assert res.lessons_completed == 34
        assert db.user._user.practiceLessonsCompleted == 34

    async def test_order_of_arrival_does_not_matter(self):
        """Commutativity is the reason this needs no sync protocol: whichever
        phone opens the app first, both accounts converge on the same number."""
        android_first = _FakeDb(_user())
        await _sync(android_first, 8)
        await _sync(android_first, 34)

        ios_first = _FakeDb(_user())
        await _sync(ios_first, 34)
        await _sync(ios_first, 8)

        assert (
            android_first.user._user.practiceLessonsCompleted
            == ios_first.user._user.practiceLessonsCompleted
            == 34
        )


# ---------------------------------------------------------------------------
# 2. The merge has to survive the ordinary things clients do
# ---------------------------------------------------------------------------

class TestMergeIsSafe:
    async def test_a_repeated_sync_changes_nothing(self):
        """Idempotent: a retry after a timeout must not advance anyone."""
        db = _FakeDb(_user(practiceLessonsCompleted=12))

        for _ in range(5):
            res = await _sync(db, 12)

        assert res.lessons_completed == 12
        assert db.user._user.practiceLessonsCompleted == 12

    async def test_a_fresh_install_cannot_erase_an_account(self):
        """The single most likely way to lose real progress: reinstall, local
        storage empty, client reports 0. A PUT would wipe 34 lessons here."""
        db = _FakeDb(_user(practiceLessonsCompleted=34))

        res = await _sync(db, 0)

        assert res.lessons_completed == 34
        assert db.user._user.practiceLessonsCompleted == 34

    async def test_a_negative_number_is_clamped_rather_than_stored(self):
        """The body is client-supplied; a corrupted cache should not be able
        to write a lesson number the path cannot render."""
        db = _FakeDb(_user(practiceLessonsCompleted=3))

        res = await _sync(db, -10)

        assert res.lessons_completed == 3
        assert db.user._user.practiceLessonsCompleted == 3

    async def test_a_null_column_reads_as_zero(self):
        """Rows written before the column existed come back as NULL through
        Prisma's optional field, and NULL + anything is NULL in SQL."""
        db = _FakeDb(_user(practiceLessonsCompleted=None))

        assert (await _sync(db, 7)).lessons_completed == 7

    async def test_a_deleted_account_does_not_raise(self):
        """The account can go away between launch and this call; the Practice
        tab must still paint rather than 500."""
        db = _FakeDb(None)

        assert (await _sync(db, 9)).lessons_completed == 9


# ---------------------------------------------------------------------------
# 3. Finishing a session is what moves the number
# ---------------------------------------------------------------------------

class TestSessionCompletionIncrements:
    async def _complete(self, db, correct, total):
        from src.routes.srs import CompleteSessionBody, complete_session

        return await complete_session(
            CompleteSessionBody(correct_count=correct, total_count=total),
            current_user=SimpleNamespace(id=1),
            db=db,
        )

    @pytest.fixture(autouse=True)
    def _no_chest(self, monkeypatch):
        class _Reward:
            def as_dict(self):
                return {"kind": "xp_small", "label": "XP", "payload": {"xp": 10}}

        async def _award(db, *, user_id):
            return _Reward()

        monkeypatch.setattr("src.routes.srs.award_session_chest", _award)

    async def test_finishing_a_lesson_advances_the_account(self):
        db = _FakeDb(_user(practiceLessonsCompleted=33))

        res = await self._complete(db, correct=8, total=10)

        assert res.lessons_completed == 34
        assert db.user._user.practiceLessonsCompleted == 34

    async def test_the_returned_number_is_the_post_increment_one(self):
        """The client adopts this value, so returning the pre-increment number
        would leave every device exactly one lesson behind the account."""
        db = _FakeDb(_user(practiceLessonsCompleted=0))

        assert (await self._complete(db, correct=1, total=1)).lessons_completed == 1

    async def test_a_session_that_scored_nothing_is_not_a_lesson(self):
        """Same guard as the streak, for the same reason: a deck whose every
        card turned out to be unrenderable is dropped card by card and then
        'finishes' without ever asking the user anything."""
        db = _FakeDb(_user(practiceLessonsCompleted=12))

        res = await self._complete(db, correct=0, total=0)

        assert res.lessons_completed == 12
        assert db.statements == []

    async def test_the_increment_is_written_in_sql_not_read_modify_write(self):
        """Guards the concurrency property a fake cannot: if this ever becomes
        `data={"practiceLessonsCompleted": n + 1}`, two devices finishing at
        the same moment both read n and one lesson is lost."""
        db = _FakeDb(_user(practiceLessonsCompleted=1))

        await self._complete(db, correct=1, total=1)

        assert any("practice_lessons_completed" in s for s in db.statements)

    async def test_it_moves_in_step_with_the_streak_day(self):
        """Both hang off the same completion, so a user who practises today
        gets exactly one of each — not a lesson without a day, or the reverse."""
        db = _FakeDb(_user(srsCurrentStreak=4, practiceLessonsCompleted=20))

        res = await self._complete(db, correct=5, total=5)

        assert (res.streak, res.lessons_completed) == (5, 21)
