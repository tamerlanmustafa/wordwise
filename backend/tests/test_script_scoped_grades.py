"""
Script-scoped CEFR adjustments must not reach the global `lemmas` registry.

`word_classifications` is keyed on (script, word) and may hold a softened grade
— the kids-genre branch and the C2-spike sanity check both exist to make one
film read at the right level. `lemmas` is keyed on the word alone and is served
to every user on every screen, so it must be told the unadjusted grade.

Prod on 2026-09-06 is what happens when the two are confused. The kids branch
graded `contingent` A2 at confidence 0.6 while classifying Rango (Animation,
Family); `_level_wins` keeps the higher confidence, so that beat the B2 at 0.55
that 21 other scripts agreed on, and A2 became the word's level app-wide.
1,522 registry rows carried that exact signature, `unilateral` among them.

1. A kids-genre downgrade rewrites cefr_level but preserves the global grade.
2. The registry writer reads the preserved grade, not the downgraded one.
3. An unadjusted classification reports itself unchanged.
4. Chained adjustments keep the ORIGINAL grade, not the previous rewrite.
"""
from __future__ import annotations

from types import SimpleNamespace

from src.services.cefr_classifier import (
    CEFRLevel,
    ClassificationSource,
    WordClassification,
    _script_scoped,
)


def _b2_by_frequency(word: str, lemma: str) -> WordClassification:
    """What _classify_by_frequency returns for a Zipf 3.0-4.0 word."""
    return WordClassification(
        word=word,
        lemma=lemma,
        pos="",
        cefr_level=CEFRLevel.B2,
        confidence=0.55,
        source=ClassificationSource.FREQUENCY_BACKOFF,
        frequency_rank=2041,
        zipf_score=3.4,
    )


def _fake_classifier():
    """Minimal stand-in for HybridCEFRClassifier along classify_word's path."""
    return SimpleNamespace(
        cefr_wordlist={},
        multi_word_expressions={},
        has_wordfreq=True,
        use_embedding_classifier=False,
        _get_lemma_fast=lambda w: w,
        _classify_by_frequency=lambda word, lemma: _b2_by_frequency(word, lemma),
    )


# ---------------------------------------------------------------------------
# 1. The kids-genre branch
# ---------------------------------------------------------------------------

def test_kids_genre_downgrade_preserves_the_global_grade():
    from src.services.cefr_classifier import HybridCEFRClassifier

    result = HybridCEFRClassifier.classify_word(
        _fake_classifier(), "contingent", is_kids_genre=True
    )

    # This script reads it as A2 — that is the point of the branch.
    assert result.cefr_level == CEFRLevel.A2
    assert result.confidence == 0.6
    # Everywhere else it is still B2.
    assert result.registry_level == CEFRLevel.B2
    assert result.registry_confidence == 0.55


def test_same_word_outside_a_kids_genre_is_untouched():
    from src.services.cefr_classifier import HybridCEFRClassifier

    result = HybridCEFRClassifier.classify_word(
        _fake_classifier(), "contingent", is_kids_genre=False
    )

    assert result.cefr_level == CEFRLevel.B2
    assert result.registry_level == CEFRLevel.B2


# ---------------------------------------------------------------------------
# 2. What the registry writer is handed
# ---------------------------------------------------------------------------

def test_registry_lookup_carries_the_unadjusted_grade():
    """The cls_lookup that routes/cefr.py builds for populate_lemma_registry.

    A2 at 0.6 beating B2 at 0.55 in `_level_wins` is exactly how the 1,522
    prod rows were written, so the guard is that 0.6 never gets there.
    """
    from src.services.cefr_classifier import HybridCEFRClassifier

    cls = HybridCEFRClassifier.classify_word(
        _fake_classifier(), "contingent", is_kids_genre=True
    )

    entry = {
        "cefr_level": cls.registry_level.value,
        "confidence": cls.registry_confidence,
        "source": cls.source.value,
    }

    assert entry["cefr_level"] == "B2"
    assert entry["confidence"] == 0.55


def test_level_wins_no_longer_lets_a_kids_film_overwrite_b2():
    from src.services.lemmatization_service import _level_wins

    # Stored: B2 from 21 adult scripts. Incoming: what a kids film now sends.
    assert _level_wins("B2", 0.55, "B2", 0.55) is False
    # The old behaviour, for contrast: A2@0.6 would have won.
    assert _level_wins("B2", 0.55, "A2", 0.6) is True


# ---------------------------------------------------------------------------
# 3 & 4. The helper itself
# ---------------------------------------------------------------------------

def test_unadjusted_classification_reports_itself():
    cls = _b2_by_frequency("contingent", "contingent")

    assert cls.base_level is None
    assert cls.registry_level == cls.cefr_level
    assert cls.registry_confidence == cls.confidence


def test_chained_adjustments_keep_the_original_grade():
    """Kids downgrade then C2-spike downgrade must not stack their bases."""
    original = WordClassification(
        word="rapscallion",
        lemma="rapscallion",
        pos="",
        cefr_level=CEFRLevel.C2,
        confidence=0.35,
        source=ClassificationSource.FREQUENCY_BACKOFF,
    )

    once = _script_scoped(original, CEFRLevel.A2, 0.6)
    twice = _script_scoped(once, CEFRLevel.A2, 0.3)

    assert twice.cefr_level == CEFRLevel.A2
    assert twice.confidence == 0.3
    assert twice.registry_level == CEFRLevel.C2
    assert twice.registry_confidence == 0.35


def test_script_scoped_does_not_mutate_its_input():
    """classify_word hands back cached objects; mutating one relabels the
    word for every other movie in the process."""
    original = _b2_by_frequency("contingent", "contingent")

    _script_scoped(original, CEFRLevel.A2, 0.6)

    assert original.cefr_level == CEFRLevel.B2
    assert original.base_level is None


def test_other_fields_survive_an_adjustment():
    original = _b2_by_frequency("contingent", "contingent")

    adjusted = _script_scoped(original, CEFRLevel.A2, 0.6)

    assert adjusted.frequency_rank == 2041
    assert adjusted.zipf_score == 3.4
    assert adjusted.source == ClassificationSource.FREQUENCY_BACKOFF
    assert adjusted.lemma == "contingent"
