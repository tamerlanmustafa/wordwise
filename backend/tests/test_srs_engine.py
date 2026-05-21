"""
Unit tests for srs_engine.py — pure SRS scheduling primitives.

No DB, no clock side-effects (all helpers take `now`/`today` injectable).
DB-touching `advance_*` functions are exercised at the route level via
integration tests; this file pins down the math that drives them.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from src.services.srs_engine import (
    BOX_INTERVALS_DAYS,
    MAX_BOX,
    can_free_user_start_session_today,
    compute_new_box,
    compute_new_streak,
    next_due_after,
)


class TestNextDueAfter:
    def test_box_one_is_one_day_out(self):
        now = datetime(2026, 5, 19, 12, 0, tzinfo=timezone.utc)
        due = next_due_after(1, now=now)
        assert (due - now).days == 1

    def test_box_five_is_thirty_days_out(self):
        now = datetime(2026, 5, 19, 12, 0, tzinfo=timezone.utc)
        due = next_due_after(5, now=now)
        assert (due - now).days == 30

    def test_box_above_max_clamps_to_max_interval(self):
        # A graduated card that's still "correct" stays at MAX_BOX and gets
        # the longest interval. compute_new_box also clamps, but defend in
        # depth here too.
        now = datetime(2026, 5, 19, 12, 0, tzinfo=timezone.utc)
        due = next_due_after(99, now=now)
        assert (due - now).days == BOX_INTERVALS_DAYS[-1]

    def test_box_below_one_clamps_to_first_interval(self):
        now = datetime(2026, 5, 19, 12, 0, tzinfo=timezone.utc)
        due = next_due_after(0, now=now)
        assert (due - now).days == BOX_INTERVALS_DAYS[0]


class TestComputeNewBox:
    def test_correct_advances_by_one(self):
        assert compute_new_box(2, correct=True) == 3

    def test_correct_at_max_stays_at_max(self):
        assert compute_new_box(MAX_BOX, correct=True) == MAX_BOX

    def test_incorrect_resets_to_one(self):
        assert compute_new_box(4, correct=False) == 1

    def test_none_current_box_treated_as_box_one(self):
        # Fresh UserWord rows can have srsBox=NULL — treat as box 1.
        assert compute_new_box(None, correct=True) == 2
        assert compute_new_box(None, correct=False) == 1

    def test_zero_box_correct_advances_to_two(self):
        # Defensive: if some row has box=0 (shouldn't, but possible),
        # correct still bumps it forward rather than stalling.
        assert compute_new_box(0, correct=True) == 2


class TestCanFreeUserStartSessionToday:
    NOW = datetime(2026, 5, 19, 14, 30, tzinfo=timezone.utc)

    def test_first_ever_session_allowed(self):
        assert can_free_user_start_session_today(None, now=self.NOW) is True

    def test_yesterday_session_allows_today(self):
        yesterday = datetime(2026, 5, 18, 23, 59, tzinfo=timezone.utc)
        assert can_free_user_start_session_today(yesterday, now=self.NOW) is True

    def test_today_session_blocks_second(self):
        earlier_today = datetime(2026, 5, 19, 6, 0, tzinfo=timezone.utc)
        assert can_free_user_start_session_today(earlier_today, now=self.NOW) is False

    def test_same_instant_blocks(self):
        # Defensive: replaying the same call shouldn't open a new session.
        assert can_free_user_start_session_today(self.NOW, now=self.NOW) is False

    def test_utc_day_boundary(self):
        # 23:59 UTC and 00:01 UTC are different UTC days — the gate
        # explicitly uses UTC dates (see helper docstring).
        late_yesterday = datetime(2026, 5, 18, 23, 59, tzinfo=timezone.utc)
        early_today = datetime(2026, 5, 19, 0, 1, tzinfo=timezone.utc)
        assert can_free_user_start_session_today(late_yesterday, now=early_today) is True


class TestComputeNewStreak:
    def test_first_ever_session_starts_at_one(self):
        assert compute_new_streak(0, None, date(2026, 5, 19)) == 1

    def test_consecutive_day_increments(self):
        assert compute_new_streak(
            prev_streak=4,
            last_session_date=date(2026, 5, 18),
            today=date(2026, 5, 19),
        ) == 5

    def test_two_day_gap_resets_to_one(self):
        assert compute_new_streak(
            prev_streak=12,
            last_session_date=date(2026, 5, 17),
            today=date(2026, 5, 19),
        ) == 1

    def test_long_gap_resets_to_one(self):
        assert compute_new_streak(
            prev_streak=99,
            last_session_date=date(2026, 1, 1),
            today=date(2026, 5, 19),
        ) == 1

    def test_same_day_is_idempotent(self):
        # Re-bumping on the same day (e.g. user does 2 sessions back-to-back)
        # must not inflate the streak.
        assert compute_new_streak(
            prev_streak=7,
            last_session_date=date(2026, 5, 19),
            today=date(2026, 5, 19),
        ) == 7

    def test_negative_delta_is_idempotent(self):
        # Clock skew / timezone weirdness — if today < last_date, behave as
        # same-day rather than resetting the user's streak.
        assert compute_new_streak(
            prev_streak=7,
            last_session_date=date(2026, 5, 20),
            today=date(2026, 5, 19),
        ) == 7

    def test_datetime_last_session_is_normalized(self):
        # Prisma Python can return `datetime` for an `@db.Date` column
        # depending on how the value was written. The helper must
        # tolerate either type — otherwise a `date - datetime`
        # subtraction crashes the streak path in production.
        from datetime import datetime, timezone
        ls = datetime(2026, 5, 18, 14, 30, tzinfo=timezone.utc)
        assert compute_new_streak(
            prev_streak=4,
            last_session_date=ls,  # type: ignore[arg-type]
            today=date(2026, 5, 19),
        ) == 5
