"""
Finishing a Practice session is recorded by the endpoint named for it.

The Practice tab's whole loop is: tap the active coin → answer N cards →
done screen with a streak number and a chest. Two of those three steps
wrote to the database. The middle one — the streak, and "has this user
practised today" — was a side effect of `POST /srs/review`, one call per
card, which the mobile client fires *fire-and-forget*: a rejected promise
is logged to the console and dropped.

That trade is right about the card. A lost `/srs/review` means the
scheduler shows that word once more, which costs the user nothing. It is
wrong about the day. With the per-card writes gone there was no other
record that a session happened at all, so:

  • the done screen said "Streak extended — day 5" (client-side count)
    while the server still held 4, and the Practice header, which reads
    the server, showed 4 one tap later;
  • `/daily/state` still reported `today_done: false`;
  • the streak milestones that hang off the bump never fired.

Even on a perfect connection the returned `streak` was stale: the last
card's `/srs/review` is still in flight when the client calls
`/srs/session/complete`, so the read raced the write it depended on.

`record_session_day` moves that record onto session completion, where it
belongs, and is idempotent so the two paths can both run in either order.
It deliberately does NOT touch `srsTotalReviews` / `srsTotalCorrect` —
those stay one-per-card, and rolling them up here would double-count
every answer in the session.

The second thing protected here is `deck_status`. An empty deck has two
causes that want opposite responses from the user, and the client had no
way to tell them apart.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from src.services.srs_engine import record_session_day

# `record_session_day` takes `today` as an argument, so its own tests pin it
# to a fixed date and stay hermetic.
TODAY = date(2026, 9, 2)
YESTERDAY = date(2026, 9, 1)

# The *endpoint* cannot use those. `complete_session` reads the real clock, so
# a fixture pinned to a frozen "yesterday" only looks like yesterday on the day
# the test was written — this file went red in CI on 2026-09-03 and would have
# gone red every morning after, on a commit that never touched the streak.
# Deriving the fixture from the same clock the code under test reads is what
# makes "practised yesterday, practises today" mean that on every day.
REAL_TODAY = datetime.now(timezone.utc).date()
REAL_YESTERDAY = REAL_TODAY - timedelta(days=1)


def _dt(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)


def _user(**overrides):
    base = dict(
        id=1,
        srsCurrentStreak=0,
        srsLongestStreak=0,
        srsLastSessionDate=None,
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
        self.updates: list[dict] = []

    async def find_unique(self, where):
        u = self._user
        return u if u is not None and where.get("id") == u.id else None

    async def update(self, where, data):
        self.updates.append(data)
        for k, v in data.items():
            setattr(self._user, k, v)
        return self._user


class _FakeDb:
    def __init__(self, user):
        self.user = _FakeUserTable(user)
        self.raw: list[tuple[str, tuple]] = []

    async def execute_raw(self, sql: str, *args):
        """Just enough Postgres for the Practice lesson counter.

        `complete_session` bumps that counter in SQL rather than with a
        read-modify-write, so two devices finishing at the same moment cannot
        both read N and both write N+1. That makes it raw, and a fake has to
        stand in for the arithmetic here — the statement itself is exercised
        in `test_practice_lesson_sync.py` and in prod.
        """
        self.raw.append((sql, args))
        u = self.user._user
        if u is None or args[0] != u.id:
            return 0
        u.practiceLessonsCompleted = (u.practiceLessonsCompleted or 0) + 1
        return 1


@pytest.fixture(autouse=True)
def _no_milestone_writes(monkeypatch):
    """Milestone unlocks have their own tests and their own table."""
    async def _noop(db, **kwargs):
        return []

    monkeypatch.setattr("src.services.srs_engine.apply_milestone_unlocks", _noop)


# ---------------------------------------------------------------------------
# 1. A completed session is recorded even when every /srs/review was lost
# ---------------------------------------------------------------------------

class TestRecordSessionDay:
    async def test_first_ever_session_starts_the_streak_at_one(self):
        db = _FakeDb(_user())

        streak = await record_session_day(db, user_id=1, today=TODAY)

        assert streak == 1
        assert db.user._user.srsLastSessionDate == _dt(TODAY)

    async def test_consecutive_day_extends_the_streak(self):
        db = _FakeDb(_user(srsCurrentStreak=4, srsLastSessionDate=_dt(YESTERDAY)))

        assert await record_session_day(db, user_id=1, today=TODAY) == 5

    async def test_a_missed_day_restarts_at_one(self):
        gap = _dt(TODAY - timedelta(days=3))
        db = _FakeDb(_user(srsCurrentStreak=9, srsLastSessionDate=gap))

        assert await record_session_day(db, user_id=1, today=TODAY) == 1

    async def test_longest_streak_keeps_the_high_water_mark(self):
        db = _FakeDb(_user(
            srsCurrentStreak=4,
            srsLongestStreak=11,
            srsLastSessionDate=_dt(YESTERDAY),
        ))

        await record_session_day(db, user_id=1, today=TODAY)

        assert db.user._user.srsLongestStreak == 11

    async def test_longest_streak_rises_when_the_current_one_passes_it(self):
        db = _FakeDb(_user(
            srsCurrentStreak=4,
            srsLongestStreak=4,
            srsLastSessionDate=_dt(YESTERDAY),
        ))

        await record_session_day(db, user_id=1, today=TODAY)

        assert db.user._user.srsLongestStreak == 5

    async def test_a_date_column_handed_back_as_datetime_is_normalized(self):
        """Prisma Python returns `datetime` for an `@db.Date` column; the
        same-day short-circuit has to see through that or it writes every
        time and inflates nothing but the write count."""
        db = _FakeDb(_user(srsCurrentStreak=3, srsLastSessionDate=_dt(TODAY)))

        assert await record_session_day(db, user_id=1, today=TODAY) == 3
        assert db.user.updates == []


class TestIdempotence:
    """The per-card write and the session write can land in either order."""

    async def test_second_call_the_same_day_does_not_bump_again(self):
        db = _FakeDb(_user(srsCurrentStreak=4, srsLastSessionDate=_dt(YESTERDAY)))

        first = await record_session_day(db, user_id=1, today=TODAY)
        second = await record_session_day(db, user_id=1, today=TODAY)

        assert (first, second) == (5, 5)
        assert len(db.user.updates) == 1

    async def test_a_late_srs_review_write_cannot_double_bump(self):
        """The last card's `/srs/review` often lands *after*
        `/srs/session/complete`. Both go through streak logic that is
        idempotent for the same day, so the ordering does not matter."""
        from src.services.srs_engine import compute_new_streak

        db = _FakeDb(_user(srsCurrentStreak=4, srsLastSessionDate=_dt(YESTERDAY)))
        streak = await record_session_day(db, user_id=1, today=TODAY)

        # What the trailing /srs/review would then compute for itself.
        late = compute_new_streak(
            db.user._user.srsCurrentStreak,
            db.user._user.srsLastSessionDate,
            TODAY,
        )
        assert (streak, late) == (5, 5)

    async def test_a_premium_users_second_session_today_is_a_no_op(self):
        db = _FakeDb(_user(srsCurrentStreak=5, srsLastSessionDate=_dt(TODAY)))

        assert await record_session_day(db, user_id=1, today=TODAY) == 5
        assert db.user.updates == []


class TestTotalsAreLeftAlone:
    """The reason this is not `advance_user_rollup_after_review`."""

    async def test_review_totals_are_not_touched(self):
        db = _FakeDb(_user(
            srsTotalReviews=120,
            srsTotalCorrect=90,
            srsLastSessionDate=_dt(YESTERDAY),
        ))

        await record_session_day(db, user_id=1, today=TODAY)

        written = db.user.updates[0]
        assert "srsTotalReviews" not in written
        assert "srsTotalCorrect" not in written
        assert db.user._user.srsTotalReviews == 120
        assert db.user._user.srsTotalCorrect == 90


class TestMissingUser:
    async def test_a_deleted_user_mid_session_does_not_raise(self):
        """The account can go away between the last card and this call —
        the done screen must still render rather than 500."""
        db = _FakeDb(None)

        assert await record_session_day(db, user_id=1, today=TODAY) == 0


# ---------------------------------------------------------------------------
# 2. `today_done` derives from the same column, so it follows for free
# ---------------------------------------------------------------------------

class TestDailyStateFollows:
    async def test_completing_a_session_makes_today_done_true(self):
        """`/daily/state` reports `today_done = (srsLastSessionDate == today)`.
        Recording the session is therefore what flips it — before this, a
        session whose per-card POSTs all failed left it false all day."""
        db = _FakeDb(_user())

        await record_session_day(db, user_id=1, today=TODAY)

        last = db.user._user.srsLastSessionDate
        assert last.date() == TODAY


# ---------------------------------------------------------------------------
# 3. The endpoint wires it up, and refuses to credit an empty session
# ---------------------------------------------------------------------------

class TestCompleteSessionEndpoint:
    async def _complete(self, db, correct, total):
        from src.routes.srs import CompleteSessionBody, complete_session

        return await complete_session(
            CompleteSessionBody(correct_count=correct, total_count=total),
            current_user=SimpleNamespace(id=1),
            db=db,
        )

    @pytest.fixture(autouse=True)
    def _no_chest(self, monkeypatch):
        """The chest roll has its own tests and its own daily ledger."""
        class _Reward:
            def as_dict(self):
                return {"kind": "xp_small", "label": "XP", "payload": {"xp": 10}}

        async def _award(db, *, user_id):
            return _Reward()

        monkeypatch.setattr("src.routes.srs.award_session_chest", _award)

    async def test_finishing_a_session_bumps_the_streak(self):
        """The whole point: this happens even when every `/srs/review` was
        lost, because the client fires those and forgets them."""
        db = _FakeDb(_user(srsCurrentStreak=4, srsLastSessionDate=_dt(REAL_YESTERDAY)))

        res = await self._complete(db, correct=8, total=10)

        assert res.streak == 5
        assert db.user._user.srsLastSessionDate.date() == datetime.now(timezone.utc).date()

    async def test_returns_the_post_bump_streak_not_the_stale_one(self):
        """It used to read the user row while the last card's `/srs/review`
        was still in flight, so the number came back one bump behind."""
        db = _FakeDb(_user(srsCurrentStreak=0, srsLastSessionDate=None))

        res = await self._complete(db, correct=10, total=10)

        assert res.streak == 1

    async def test_a_session_that_scored_nothing_earns_no_day(self):
        """A deck whose every card was unrenderable finishes with 0 scored.
        Crediting a streak day for a session the user was never asked
        anything in is exactly the hollow number the streak exists against."""
        db = _FakeDb(_user(srsCurrentStreak=4, srsLastSessionDate=_dt(REAL_YESTERDAY)))

        res = await self._complete(db, correct=0, total=0)

        assert res.streak == 4
        # The chest write still happens — that ledger is one-per-day and its
        # own concern. What must not move is the streak.
        streak_writes = [u for u in db.user.updates if "srsCurrentStreak" in u]
        assert streak_writes == []
        assert db.user._user.srsLastSessionDate == _dt(REAL_YESTERDAY)

    async def test_the_echoed_counts_are_untouched(self):
        db = _FakeDb(_user(srsLastSessionDate=_dt(REAL_YESTERDAY)))

        res = await self._complete(db, correct=7, total=10)

        assert (res.correct_count, res.total_count) == (7, 10)


# ---------------------------------------------------------------------------
# 4. deck_status: "caught up" and "we couldn't build it" are different
# ---------------------------------------------------------------------------

class TestDeckStatus:
    """The response model's default keeps old clients parsing."""

    def test_defaults_to_ok_so_older_builds_are_unaffected(self):
        from src.routes.srs import SessionStartResponse

        res = SessionStartResponse(
            cards=[],
            total_due=0,
            session_size=10,
            is_preview=True,
            previews_remaining=1,
        )
        assert res.deck_status == "ok"

    def test_carries_the_three_states(self):
        from src.routes.srs import SessionStartResponse

        for status in ("ok", "caught_up", "unavailable"):
            res = SessionStartResponse(
                cards=[],
                total_due=0,
                session_size=10,
                is_preview=True,
                previews_remaining=1,
                deck_status=status,
            )
            assert res.deck_status == status


# ---------------------------------------------------------------------------
# 4. The daily-cap 402 carries counts installed builds can render
# ---------------------------------------------------------------------------

class TestDailyCapPayload:
    async def test_the_402_detail_names_a_budget_of_one(self):
        """The mobile paywall defaults a missing count to 0, so an absent
        pair rendered "You've used 0 of 0 free review sessions" on the one
        screen whose job is to ask for money. Already-installed builds read
        these fields and cannot be fixed from the client."""
        from fastapi import HTTPException

        from src.routes.srs import start_session

        user = SimpleNamespace(
            id=1,
            subscriptionTier=None,
            subscriptionExpiresAt=None,
            isAdmin=False,
            srsLastSessionStartedAt=datetime.now(timezone.utc),
        )

        # Called directly rather than through the app, so FastAPI is not here
        # to resolve `Query(...)` defaults — pass the kind the client sends.
        with pytest.raises(HTTPException) as exc:
            await start_session(
                kind="practice",
                movie_id=None,
                list_id=None,
                current_user=user,
                db=_FakeDb(user),
            )

        assert exc.value.status_code == 402
        detail = exc.value.detail
        assert detail["paywall"] == "srs_daily_cap_reached"
        assert detail["previews_used"] == 1
        assert detail["previews_limit"] == 1
        assert detail["message"]
