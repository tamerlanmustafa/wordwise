"""
Unit tests for session_kinds.py pure helpers.

The async per-kind composers are DB-touching and covered by smoke tests.
Here we lock down `is_kind_unlocked` + the thresholds table.
"""
from __future__ import annotations

import pytest

from src.services.session_kinds import (
    KIND_SESSION_SIZE,
    KIND_UNLOCK_THRESHOLDS,
    VALID_KINDS,
    is_kind_unlocked,
)


class TestKindThresholds:
    def test_quick_recall_always_unlocked(self):
        assert is_kind_unlocked("quick_recall", current_streak=0)
        assert is_kind_unlocked("quick_recall", current_streak=999)

    def test_synonym_round_unlocks_at_three(self):
        assert not is_kind_unlocked("synonym_round", 2)
        assert is_kind_unlocked("synonym_round", 3)
        assert is_kind_unlocked("synonym_round", 100)

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
            "quick_recall", "synonym_round", "tough_words", "movie_deep_dive",
        }

    @pytest.mark.parametrize("kind", [
        "quick_recall", "synonym_round", "tough_words", "movie_deep_dive",
    ])
    def test_each_kind_has_threshold(self, kind):
        assert kind in KIND_UNLOCK_THRESHOLDS
        assert isinstance(KIND_UNLOCK_THRESHOLDS[kind], int)
        assert KIND_UNLOCK_THRESHOLDS[kind] >= 0
