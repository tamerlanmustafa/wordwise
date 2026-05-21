"""
Unit tests for streak_service.py — pure freeze decision logic.

DB-touching wrappers are exercised in the P3 smoke test (need a real
user + freeze inventory). Here we lock down the decision math.
"""
from __future__ import annotations

from datetime import date

from src.services.streak_service import (
    MAX_FREEZES_HELD,
    freezes_to_consume_for_gap,
    repair_window_active,
    should_auto_grant_weekly,
)


class TestShouldAutoGrantWeekly:
    TODAY = date(2026, 5, 19)  # Tuesday, ISO week 21

    def test_first_ever_grant(self):
        assert should_auto_grant_weekly(self.TODAY, held_count=0, last_weekly_grant=None) is True

    def test_already_at_cap_blocks(self):
        # User holds MAX freezes — even if it's a new week, don't grant.
        assert should_auto_grant_weekly(
            self.TODAY, held_count=MAX_FREEZES_HELD, last_weekly_grant=None
        ) is False

    def test_same_week_blocks(self):
        # Already got a grant earlier this week.
        same_week = date(2026, 5, 17)  # Sunday of ISO week 20? Actually 2026-05-17 is a Sunday in week 20
        # 2026-05-19 is Tuesday in week 21. Use a same-week prior date:
        same_week = date(2026, 5, 18)  # Monday of week 21
        assert should_auto_grant_weekly(self.TODAY, held_count=1, last_weekly_grant=same_week) is False

    def test_new_week_grants(self):
        last = date(2026, 5, 11)  # week 20
        assert should_auto_grant_weekly(self.TODAY, held_count=1, last_weekly_grant=last) is True

    def test_at_cap_overrides_new_week(self):
        last = date(2026, 5, 11)
        assert should_auto_grant_weekly(
            self.TODAY, held_count=MAX_FREEZES_HELD, last_weekly_grant=last
        ) is False


class TestFreezesToConsumeForGap:
    TODAY = date(2026, 5, 19)

    def test_no_prior_session_consumes_nothing(self):
        assert freezes_to_consume_for_gap(self.TODAY, None, held_count=3) == 0

    def test_no_freezes_consumes_nothing(self):
        last = date(2026, 5, 14)
        assert freezes_to_consume_for_gap(self.TODAY, last, held_count=0) == 0

    def test_same_day_consumes_nothing(self):
        # User was active today — no gap.
        assert freezes_to_consume_for_gap(self.TODAY, self.TODAY, held_count=3) == 0

    def test_yesterday_consumes_nothing(self):
        # User was active yesterday — streak just continues, no freeze needed.
        last = date(2026, 5, 18)
        assert freezes_to_consume_for_gap(self.TODAY, last, held_count=3) == 0

    def test_two_day_gap_consumes_one(self):
        # Missed one day (the day in between today and last). Burn 1.
        last = date(2026, 5, 17)
        assert freezes_to_consume_for_gap(self.TODAY, last, held_count=3) == 1

    def test_five_day_gap_consumes_four(self):
        # Missed 4 days. Burn 4 if we have them.
        last = date(2026, 5, 14)
        assert freezes_to_consume_for_gap(self.TODAY, last, held_count=5) == 4

    def test_gap_larger_than_held_consumes_all_held(self):
        # Missed 4 days but only have 2 freezes — burn what we have.
        last = date(2026, 5, 14)
        assert freezes_to_consume_for_gap(self.TODAY, last, held_count=2) == 2


class TestRepairWindowActive:
    TODAY = date(2026, 5, 19)

    def test_no_prior_session_no_window(self):
        assert repair_window_active(self.TODAY, None, held_count=0) is False

    def test_yesterday_no_window(self):
        # Active yesterday — nothing to repair.
        assert repair_window_active(self.TODAY, date(2026, 5, 18), held_count=0) is False

    def test_exactly_one_day_missed_with_zero_freezes(self):
        # The repair sweet spot: one day missed, no freezes.
        assert repair_window_active(self.TODAY, date(2026, 5, 17), held_count=0) is True

    def test_one_day_missed_but_has_freeze_no_window(self):
        # Freeze would have already saved them via auto-consume.
        assert repair_window_active(self.TODAY, date(2026, 5, 17), held_count=1) is False

    def test_two_days_missed_no_window(self):
        # Too late to repair (we don't offer multi-day catch-ups).
        assert repair_window_active(self.TODAY, date(2026, 5, 16), held_count=0) is False
