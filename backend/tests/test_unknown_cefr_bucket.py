"""
Tests for the UNKNOWN CEFR bucket (issue #91).

A2 used to double as the classifier's "I give up" bucket, so 53.9% of the
prod lemma registry sat at A2 — proper nouns ("Aleppo", "Fezziwig") and
unplaceable debris ("geoduck") among real beginner vocabulary. Both fallback
branches now write UNKNOWN, which is stored and countable but never taught.

1. The classifier's two fallback branches return UNKNOWN, and the deliberate
   whitelists that also carry source='fallback' still return real levels.
2. should_keep_word drops UNKNOWN at read time (rows stored before this
   existed, and every surface that serves classifications straight from DB).
3. The sentence worker never spends LLM budget on UNKNOWN lemmas.
4. Priority scoring sinks UNKNOWN instead of taking the 0.5 default.
5. Difficulty scoring ignores UNKNOWN words rather than counting them as A1
   or padding the denominator — a name-heavy film is not an easier film.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from src.routes.cefr import should_keep_word
from src.services.cefr_classifier import CEFRLevel, ClassificationSource
from src.services.difficulty_scorer import (
    SCORABLE_CEFR_LEVELS,
    WordData,
    compute_difficulty,
    compute_difficulty_advanced,
    compute_median_cefr_level,
    scorable_words,
)
from src.services.lemmatization_service import compute_priority_score


def _fake_classifier(wordlist: dict | None = None, lemma_map: dict | None = None):
    """
    Minimal stand-in for HybridCEFRClassifier along classify_word's path.

    _classify_by_frequency returns None so the word reaches the final
    fallback — the real one needs wordfreq's corpus loaded.
    """
    return SimpleNamespace(
        cefr_wordlist=wordlist or {},
        multi_word_expressions={},
        has_wordfreq=False,
        use_embedding_classifier=False,
        _get_lemma_fast=lambda w: (lemma_map or {}).get(w, w),
        _classify_by_frequency=lambda *args, **kwargs: None,
    )


# ---------------------------------------------------------------------------
# 1. The classifier's fallback branches
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("word", ["Aleppo", "Fezziwig", "Yabzick", "Orson"])
def test_proper_nouns_and_fantasy_words_are_unknown(word):
    from src.services.cefr_classifier import HybridCEFRClassifier

    result = HybridCEFRClassifier.classify_word(_fake_classifier(), word)

    assert result.cefr_level == CEFRLevel.UNKNOWN
    assert result.source == ClassificationSource.FALLBACK


def test_final_fallback_is_unknown_not_a2():
    """A lowercase word no wordlist, frequency table or heuristic can place."""
    from src.services.cefr_classifier import HybridCEFRClassifier

    result = HybridCEFRClassifier.classify_word(_fake_classifier(), "zzblarg")

    assert result.cefr_level == CEFRLevel.UNKNOWN
    assert result.confidence == 0.2


def test_kids_whitelist_still_returns_a2():
    """
    The kids whitelist also carries source='fallback', but it is a deliberate
    A2 judgement, not a failure to classify. It must survive #91.
    """
    from src.services.cefr_classifier import HybridCEFRClassifier

    result = HybridCEFRClassifier.classify_word(_fake_classifier(), "yippee")

    assert result.cefr_level == CEFRLevel.A2
    assert result.confidence == 0.95


def test_known_word_is_unaffected():
    from src.services.cefr_classifier import HybridCEFRClassifier

    fake = _fake_classifier(
        wordlist={"stakeholder": (CEFRLevel.B2, ClassificationSource.OXFORD_3000)},
        lemma_map={"stakeholders": "stakeholder"},
    )
    result = HybridCEFRClassifier.classify_word(fake, "Stakeholders")

    assert result.cefr_level == CEFRLevel.B2


# ---------------------------------------------------------------------------
# 2. Read-time filter
# ---------------------------------------------------------------------------

def test_should_keep_word_drops_unknown():
    assert should_keep_word("Aleppo", "aleppo", "UNKNOWN") is False
    assert should_keep_word("geoduck", "geoduck", "UNKNOWN") is False


@pytest.mark.parametrize("level", ["A2", "B1", "B2", "C1", "C2"])
def test_should_keep_word_keeps_real_levels(level):
    assert should_keep_word("resilient", "resilient", level) is True


# ---------------------------------------------------------------------------
# 3. Sentence worker: no LLM spend on unclassifiable words
# ---------------------------------------------------------------------------

def test_backlog_sql_excludes_unknown():
    from src.workers.sentence_worker import build_backlog_sql

    sql = build_backlog_sql([], 50)

    assert "l.cefr_level <> 'UNKNOWN'" in sql
    # still the uncorrelated NOT IN that the 2026-07-22 outage fix requires
    assert "l.id NOT IN (SELECT sll.lemma_id" in sql


# ---------------------------------------------------------------------------
# 4. Priority scoring
# ---------------------------------------------------------------------------

def test_unknown_priority_sinks_below_real_levels():
    kwargs = {"frequency_rank": 10, "total_lemmas": 1000}

    unknown = compute_priority_score(cefr_level="UNKNOWN", **kwargs)
    a1 = compute_priority_score(cefr_level="A1", **kwargs)
    b1 = compute_priority_score(cefr_level="B1", **kwargs)

    assert unknown < a1 < b1


# ---------------------------------------------------------------------------
# 5. Difficulty scoring
# ---------------------------------------------------------------------------

def test_scorable_words_drops_unknown_only():
    words = [
        WordData("A1", 0.9, 1, "the"),
        WordData("UNKNOWN", 0.9, None, "Fezziwig"),
        WordData("C1", 0.8, 900, "ostensible"),
    ]

    kept = scorable_words(words)

    assert [w.word for w in kept] == ["the", "ostensible"]
    assert "UNKNOWN" not in SCORABLE_CEFR_LEVELS


def test_median_cefr_ignores_unknown_instead_of_scoring_it_a1():
    real = [WordData("C1", 0.8, 900, "ostensible"), WordData("C1", 0.8, 901, "myriad")]
    with_names = real + [
        WordData("UNKNOWN", 0.9, None, "Fezziwig"),
        WordData("UNKNOWN", 0.9, None, "Aleppo"),
    ]

    assert compute_median_cefr_level(with_names) == compute_median_cefr_level(real)


def test_name_heavy_script_does_not_score_easier():
    """
    The old behaviour: UNKNOWN fell through `CEFR_NUMERIC.get(level, 1)` as
    A1 and swelled the level_counts denominator, so a film full of character
    names looked like beginner material.
    """
    real = [
        WordData("B2", 0.8, 400, "reluctant"),
        WordData("C1", 0.8, 900, "ostensible"),
        WordData("B1", 0.8, 200, "arrange"),
        WordData("A1", 0.9, 1, "the"),
    ]
    names = [WordData("UNKNOWN", 0.9, None, n) for n in ("Fezziwig", "Aleppo", "Orson")]

    level_real, score_real, _ = compute_difficulty_advanced(real)
    level_named, score_named, _ = compute_difficulty_advanced(real + names)

    assert (level_real, score_real) == (level_named, score_named)


def test_legacy_compute_difficulty_excludes_unknown_from_total():
    dist = {"A1": 40, "A2": 30, "B1": 20, "B2": 10}

    level_real, score_real, _ = compute_difficulty(dist)
    level_named, score_named, _ = compute_difficulty({**dist, "UNKNOWN": 500})

    assert (level_real, score_real) == (level_named, score_named)
