"""
Unit tests for quiz_service.py — pure card selection + scoring logic.

No DB, no translation API, no network. If scoring behavior changes (stars
threshold, XP economy), these tests will flag it.
"""
from __future__ import annotations

import random

from src.services.quiz_service import (
    CARDS_PER_SESSION,
    XP_PER_CORRECT,
    XP_PER_SELF_RATE,
    XP_THREE_STAR_BONUS,
    XP_TWO_STAR_BONUS,
    build_translation_choices,
    compute_stars,
    compute_xp,
    is_unit_unlocked,
    pick_card_types,
    srs_outcome_for_card,
)

LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]


class TestPickCardTypes:
    def test_session_length(self):
        deck = pick_card_types(rng=random.Random(1))
        assert len(deck) == CARDS_PER_SESSION

    def test_approx_seventy_percent_mcq(self):
        deck = pick_card_types(rng=random.Random(1))
        mcq = sum(1 for c in deck if c == "mcq")
        # With 10 cards and 70% target, allow rounding either way.
        assert 6 <= mcq <= 8

    def test_guarantees_both_types_for_small_sessions(self):
        deck = pick_card_types(total=3, rng=random.Random(0))
        assert "mcq" in deck
        assert "self_rate" in deck

    def test_deterministic_with_seeded_rng(self):
        a = pick_card_types(rng=random.Random(42))
        b = pick_card_types(rng=random.Random(42))
        assert a == b


class TestBuildTranslationChoices:
    TRANSLATIONS = {
        "run": "correr",
        "eat": "comer",
        "sleep": "dormir",
        "speak": "hablar",
        "live": "vivir",
    }

    def test_four_choices_exactly_one_correct(self):
        choices = build_translation_choices("run", self.TRANSLATIONS, rng=random.Random(1))
        assert choices is not None
        assert len(choices) == 4
        assert sum(1 for c in choices if c["is_correct"]) == 1
        correct = next(c for c in choices if c["is_correct"])
        assert correct["word"] == "correr"

    def test_distractors_come_from_other_deck_translations(self):
        choices = build_translation_choices("run", self.TRANSLATIONS, rng=random.Random(1))
        assert choices is not None
        wrong = {c["word"] for c in choices if not c["is_correct"]}
        assert wrong <= {"comer", "dormir", "hablar", "vivir"}

    def test_no_translation_returns_none(self):
        assert build_translation_choices("fly", self.TRANSLATIONS, rng=random.Random(1)) is None

    def test_too_few_distractors_returns_none(self):
        small = {"run": "correr", "eat": "comer", "sleep": "dormir"}
        assert build_translation_choices("run", small, rng=random.Random(1)) is None

    def test_duplicate_translations_cannot_produce_two_right_tiles(self):
        # "sprint" shares run's translation — it must not appear as a
        # distractor, and with it excluded only 2 distinct distractors
        # remain, so the card can't be built.
        dupes = {
            "run": "correr",
            "sprint": "Correr ",  # same translation, case/space noise
            "eat": "comer",
            "sleep": "dormir",
        }
        assert build_translation_choices("run", dupes, rng=random.Random(1)) is None

    def test_deterministic_with_seeded_rng(self):
        a = build_translation_choices("run", self.TRANSLATIONS, rng=random.Random(7))
        b = build_translation_choices("run", self.TRANSLATIONS, rng=random.Random(7))
        assert a == b


class TestComputeStars:
    def test_three_stars_at_ninety_percent(self):
        assert compute_stars(9, 10) == 3
        assert compute_stars(10, 10) == 3

    def test_two_stars_at_seventy_percent(self):
        assert compute_stars(7, 10) == 2
        assert compute_stars(8, 10) == 2

    def test_one_star_at_fifty_percent(self):
        assert compute_stars(5, 10) == 1
        assert compute_stars(6, 10) == 1

    def test_zero_stars_below_fifty(self):
        assert compute_stars(4, 10) == 0
        assert compute_stars(0, 10) == 0

    def test_all_self_rate_session_gives_participation_star(self):
        """A session with zero typed cards (all self-rate) still earns 1 star
        for completion — no zero-star frustration on an honest session."""
        assert compute_stars(0, 0) == 1


class TestComputeXp:
    def test_basic_xp_sum(self):
        # 5 correct typed, 2 self-rate, 0 stars → 5*10 + 2*5 = 60
        assert compute_xp(5, 2, 0) == 60

    def test_three_star_bonus(self):
        # 9 correct, 1 self-rate, 3 stars → 9*10 + 1*5 + 50 = 145
        assert compute_xp(9, 1, 3) == 9 * XP_PER_CORRECT + 1 * XP_PER_SELF_RATE + XP_THREE_STAR_BONUS

    def test_two_star_bonus(self):
        # 7 correct, 3 self-rate, 2 stars → 7*10 + 3*5 + 20 = 105
        assert compute_xp(7, 3, 2) == 7 * XP_PER_CORRECT + 3 * XP_PER_SELF_RATE + XP_TWO_STAR_BONUS

    def test_one_star_no_bonus(self):
        # XP from cards only, no bonus.
        assert compute_xp(5, 0, 1) == 50


class TestSrsOutcomeForCard:
    def test_typed_correct(self):
        assert srs_outcome_for_card("type", is_correct=True, self_rating=None) == "correct"

    def test_typed_incorrect(self):
        assert srs_outcome_for_card("type", is_correct=False, self_rating=None) == "incorrect"

    def test_typed_missing_signal_skips(self):
        assert srs_outcome_for_card("type", is_correct=None, self_rating=None) == "skip"

    def test_mcq_scored_like_type(self):
        assert srs_outcome_for_card("mcq", is_correct=True, self_rating=None) == "correct"
        assert srs_outcome_for_card("mcq", is_correct=False, self_rating=None) == "incorrect"

    def test_synonym_mcq_scored_like_type(self):
        assert srs_outcome_for_card("synonym_mcq", is_correct=True, self_rating=None) == "correct"
        assert srs_outcome_for_card("synonym_mcq", is_correct=False, self_rating=None) == "incorrect"
        assert srs_outcome_for_card("synonym_mcq", is_correct=None, self_rating=None) == "skip"

    def test_self_rate_know_is_correct(self):
        assert srs_outcome_for_card("self_rate", is_correct=None, self_rating="know") == "correct"

    def test_self_rate_dont_is_incorrect(self):
        assert srs_outcome_for_card("self_rate", is_correct=None, self_rating="dont") == "incorrect"

    def test_self_rate_kinda_is_skip(self):
        # "kinda" carries no SRS signal — the user neither claims mastery nor
        # admits forgetting, so we don't move the schedule.
        assert srs_outcome_for_card("self_rate", is_correct=None, self_rating="kinda") == "skip"

    def test_self_rate_missing_rating_is_skip(self):
        assert srs_outcome_for_card("self_rate", is_correct=None, self_rating=None) == "skip"

    def test_unknown_card_type_skips(self):
        # 'recall' is a retired card type old clients might still submit.
        assert srs_outcome_for_card("recall", is_correct=True, self_rating=None) == "skip"


class TestIsUnitUnlocked:
    def test_first_level_always_unlocked(self):
        assert is_unit_unlocked("A1", LEVELS, attempted_levels=set()) is True

    def test_locked_without_previous_attempt(self):
        assert is_unit_unlocked("B1", LEVELS, attempted_levels=set()) is False

    def test_unlocked_after_previous_attempted(self):
        # B1 unlocks once A2 has been attempted (even with 0 stars).
        assert is_unit_unlocked("B1", LEVELS, attempted_levels={"A2"}) is True

    def test_skip_ahead_still_locked(self):
        # Attempting A1 does not unlock B2 — only B1's prereq (A2) was skipped.
        assert is_unit_unlocked("B2", LEVELS, attempted_levels={"A1"}) is False

    def test_unknown_level_locked(self):
        assert is_unit_unlocked("C7", LEVELS, attempted_levels={"A1", "A2"}) is False
