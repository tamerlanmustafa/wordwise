"""
Unit tests for pure helpers in movie_progress_service.py.

The async `recompute_for_user_movie` is integration-only (needs the full
schema + movie_lemma_mappings data) and is exercised by the P1 smoke test.
Here we lock the math + threshold semantics that drive what the user sees.
"""
from __future__ import annotations

import pytest

from src.services.movie_progress_service import (
    MASTERED_THRESHOLD,
    STUDIED_THRESHOLD,
    classify_status,
    compute_comprehensibility_percent,
)


class TestClassifyStatus:
    def test_zero_known_is_unstudied(self):
        assert classify_status(
            lemmas_in_box_2_plus=0, lemmas_mastered=0, total_lemmas=500
        ) == "unstudied"

    def test_no_lemmas_at_all_is_unstudied(self):
        # Defensive — never raise on movies with no MovieLemmaMapping data.
        assert classify_status(
            lemmas_in_box_2_plus=0, lemmas_mastered=0, total_lemmas=0
        ) == "unstudied"

    def test_below_studied_threshold_stays_unstudied(self):
        # 29% of 100 → 29 lemmas in box 2+, just below the 30% cut.
        assert classify_status(
            lemmas_in_box_2_plus=29, lemmas_mastered=0, total_lemmas=100
        ) == "unstudied"

    def test_at_studied_threshold_is_studied(self):
        assert classify_status(
            lemmas_in_box_2_plus=30, lemmas_mastered=0, total_lemmas=100
        ) == "studied"

    def test_just_above_studied_threshold(self):
        assert classify_status(
            lemmas_in_box_2_plus=50, lemmas_mastered=10, total_lemmas=100
        ) == "studied"

    def test_below_mastered_threshold_stays_studied(self):
        # 79% mastered — below the 80% Mastered cut.
        assert classify_status(
            lemmas_in_box_2_plus=90, lemmas_mastered=79, total_lemmas=100
        ) == "studied"

    def test_at_mastered_threshold(self):
        assert classify_status(
            lemmas_in_box_2_plus=95, lemmas_mastered=80, total_lemmas=100
        ) == "mastered"

    def test_fully_mastered(self):
        assert classify_status(
            lemmas_in_box_2_plus=500, lemmas_mastered=500, total_lemmas=500
        ) == "mastered"

    def test_mastered_takes_precedence_over_studied(self):
        # Hypothetical: somehow lemmas_mastered = total but lemmas_in_box_2_plus
        # is < lemmas_mastered (shouldn't happen since mastered ⊆ box2+, but
        # the function must still classify correctly on whatever it gets).
        assert classify_status(
            lemmas_in_box_2_plus=80, lemmas_mastered=80, total_lemmas=100
        ) == "mastered"

    def test_custom_thresholds(self):
        # Stricter custom thresholds — e.g. for a CEFR-weighted variant.
        assert classify_status(
            lemmas_in_box_2_plus=50, lemmas_mastered=0, total_lemmas=100,
            studied_threshold=0.60,
        ) == "unstudied"
        assert classify_status(
            lemmas_in_box_2_plus=60, lemmas_mastered=0, total_lemmas=100,
            studied_threshold=0.60,
        ) == "studied"


class TestComputeComprehensibilityPercent:
    def test_basic_ratio(self):
        # 600 of 1000 total frequency-weighted = 60%.
        assert compute_comprehensibility_percent(600.0, 1000.0) == pytest.approx(60.0)

    def test_zero_total_is_zero(self):
        assert compute_comprehensibility_percent(0.0, 0.0) == 0.0

    def test_negative_total_is_zero(self):
        # Defensive against bad upstream data.
        assert compute_comprehensibility_percent(50.0, -10.0) == 0.0

    def test_full_known_is_100(self):
        assert compute_comprehensibility_percent(500.0, 500.0) == 100.0

    def test_overcount_clamps_to_100(self):
        # If movie_lemma_mappings has dupes that inflated freq_known past
        # total_freq, we still display ≤ 100.
        assert compute_comprehensibility_percent(1500.0, 1000.0) == 100.0

    def test_negative_freq_known_clamps_to_zero(self):
        assert compute_comprehensibility_percent(-50.0, 1000.0) == 0.0


class TestThresholdConstants:
    """Pin the published thresholds — changing these is a product decision
    the user should sign off on, not a silent code change."""

    def test_studied_is_thirty_percent(self):
        assert STUDIED_THRESHOLD == 0.30

    def test_mastered_is_eighty_percent(self):
        assert MASTERED_THRESHOLD == 0.80
