"""
Unit tests for session_kinds.py pure helpers.

The async per-kind composers are DB-touching and covered by smoke tests.
Here we lock down `is_kind_unlocked` + the thresholds table.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from src.services.session_kinds import (
    KIND_SESSION_SIZE,
    KIND_UNLOCK_THRESHOLDS,
    LIST_KINDS,
    REVIEW_COOLDOWN_HOURS,
    VALID_KINDS,
    cooldown_where_fragment,
    is_kind_unlocked,
    recently_reviewed_cutoff,
)


class TestKindThresholds:
    def test_quick_recall_always_unlocked(self):
        assert is_kind_unlocked("quick_recall", current_streak=0)
        assert is_kind_unlocked("quick_recall", current_streak=999)

    def test_retired_synonym_round_is_locked(self):
        # Removed with the synonym MCQ format — a stale client asking for
        # it must not auto-unlock.
        assert not is_kind_unlocked("synonym_round", 999)

    def test_tough_words_unlocks_at_five(self):
        assert not is_kind_unlocked("tough_words", 4)
        assert is_kind_unlocked("tough_words", 5)

    def test_movie_deep_dive_unlocks_at_seven(self):
        assert not is_kind_unlocked("movie_deep_dive", 6)
        assert is_kind_unlocked("movie_deep_dive", 7)

    def test_unknown_kind_is_locked(self):
        # Defensive: stale client / typo'd kind name shouldn't auto-grant.
        assert not is_kind_unlocked("nonexistent_kind", 999)

    def test_thresholds_cover_all_valid_kinds(self):
        assert set(KIND_UNLOCK_THRESHOLDS.keys()) == VALID_KINDS

    def test_session_size_constant_matches_route(self):
        # If this drifts from the route's SESSION_SIZE we'd over- or
        # under-fill queues. Pin it to the published value.
        assert KIND_SESSION_SIZE == 10


class TestValidKindsSet:
    def test_set_contains_expected_keys(self):
        assert VALID_KINDS == {
            "quick_recall", "tough_words", "movie_deep_dive",
            # Lists tab — started from a list's gold button, not the
            # Practice path.
            "list_words", "list_films",
        }

    def test_list_kinds_are_a_subset_of_valid_kinds(self):
        assert LIST_KINDS <= VALID_KINDS

    @pytest.mark.parametrize("kind", [
        "list_words", "list_films",
    ])
    def test_list_kinds_are_ungated(self, kind):
        # A streak gate on a button the user pressed in the Lists tab would
        # read as the button being broken.
        assert is_kind_unlocked(kind, current_streak=0)

    @pytest.mark.parametrize("kind", [
        "quick_recall", "tough_words", "movie_deep_dive",
        "list_words", "list_films",
    ])
    def test_each_kind_has_threshold(self, kind):
        assert kind in KIND_UNLOCK_THRESHOLDS
        assert isinstance(KIND_UNLOCK_THRESHOLDS[kind], int)
        assert KIND_UNLOCK_THRESHOLDS[kind] >= 0


class TestReviewCooldown:
    NOW = datetime(2026, 6, 2, 12, 0, tzinfo=timezone.utc)

    def test_cutoff_subtracts_default_window(self):
        cutoff = recently_reviewed_cutoff(self.NOW)
        assert cutoff == self.NOW - timedelta(hours=REVIEW_COOLDOWN_HOURS)

    def test_cutoff_honours_explicit_hours(self):
        assert recently_reviewed_cutoff(self.NOW, hours=24) == self.NOW - timedelta(hours=24)

    def test_default_window_is_positive(self):
        # A non-positive window would make the cooldown a no-op (every row
        # is "older than now"), silently disabling the anti-repetition fix.
        assert REVIEW_COOLDOWN_HOURS > 0

    def test_fragment_admits_never_reviewed_or_pre_cutoff(self):
        cutoff = recently_reviewed_cutoff(self.NOW)
        frag = cooldown_where_fragment(cutoff)
        # Shape: an OR of "never reviewed" and "reviewed before cutoff".
        assert frag == {
            "OR": [
                {"srsLastReviewedAt": None},
                {"srsLastReviewedAt": {"lt": cutoff}},
            ]
        }

    def test_fragment_is_a_pure_or_only_clause(self):
        # It must contribute only the OR key so callers can spread it
        # alongside their scalar filters (userId / srsBox / movieId)
        # without clobbering them.
        frag = cooldown_where_fragment(self.NOW)
        assert set(frag.keys()) == {"OR"}
