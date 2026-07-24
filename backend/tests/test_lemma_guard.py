"""
Tests for the lemma purity guard (src/services/lemma_guard.py) and its
integration points:

1. Well-formedness rules reject tokenization debris, gibberish, and
   non-ASCII (foreign-script) tokens regardless of external deps.
2. The dictionary/frequency gate (with injected wordfreq + dictionary)
   rejects typos, foreign-dominant words, and negligible-frequency
   non-words while keeping real rare vocabulary and modern coinages.
3. Curated-wordlist hits rescue entries that fail orthographic checks.
4. Missing optional deps FAIL OPEN: never wipe vocabulary.
5. display_form renders the lemma, not the inflected surface form.
6. classify_word regression: sentence-initial capitalized KNOWN words
   ("Stakeholders") must lemmatize normally instead of being stored as
   proper nouns with the raw plural as their lemma.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from src.services import lemma_guard as lg
from src.services.lemma_guard import display_form, evaluate_lemma, is_wellformed


# Fake English/foreign frequency table: (word, lang) -> frequency
_FREQ = {
    ("stakeholder", "en"): 1e-5,
    ("covid", "en"): 1e-4,
    ("troppo", "en"): 1e-6,
    ("troppo", "it"): 1e-4,
    ("obscurish", "en"): 1e-7,
    ("good", "en"): 1e-3,
}

_DICTIONARY = {"stakeholder", "garnishment", "good", "wife"}


def _fake_freq(word: str, lang: str) -> float:
    return _FREQ.get((word, lang), 0.0)


@pytest.fixture
def guard(monkeypatch):
    """lemma_guard with deterministic injected wordfreq + dictionary."""
    lg._dictionary_gate.cache_clear()
    monkeypatch.setattr(lg, "_wordfreq_checked", True)
    monkeypatch.setattr(lg, "_word_frequency", _fake_freq)
    monkeypatch.setattr(lg, "_dictionary_checked", True)
    monkeypatch.setattr(lg, "_dictionary", _DICTIONARY)
    yield lg
    lg._dictionary_gate.cache_clear()


# ---------------------------------------------------------------------------
# 1. Well-formedness (no external deps involved)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("token,reason", [
    ("", "empty"),
    ("x", "too_short"),
    ("'s", "malformed"),          # tokenization artifact
    ("mr.", "malformed"),         # abbreviation debris
    ("cells|were", "malformed"),  # OCR pipe artifact
    ("-dave", "malformed"),       # leading dialogue dash
    ("life1", "malformed"),       # digit
    ("shari_kenzie", "malformed"),
    ("caf" + chr(233), "malformed"),  # non-ASCII (cafe with accent)
    ("kch", "no_vowel"),
    ("ktns", "no_vowel"),
    ("goood", "repeated_chars"),
])
def test_wellformedness_rejections(token, reason):
    decision = is_wellformed(token)
    assert not decision.keep
    assert decision.reason == reason


def test_wellformed_accepts_normal_words():
    for token in ("stakeholder", "o'clock", "well-known", "ok"):
        assert is_wellformed(token).keep


# ---------------------------------------------------------------------------
# 2. Dictionary / frequency gate
# ---------------------------------------------------------------------------

def test_typo_with_zero_frequency_rejected(guard):
    decision = evaluate_lemma("deallng")
    assert not decision.keep
    assert decision.reason == "unknown_english"


def test_foreign_dominant_word_rejected(guard):
    decision = evaluate_lemma("troppo")  # 100x more frequent in Italian
    assert not decision.keep
    assert decision.reason == "foreign_it"


def test_rare_dictionary_word_kept(guard):
    # Zero corpus frequency but a real dictionary word
    assert evaluate_lemma("garnishment").keep


def test_modern_coinage_kept_by_frequency(guard):
    # Not in the dictionary (predates it) but common in English corpora
    assert evaluate_lemma("covid").keep


def test_negligible_frequency_nonword_rejected(guard):
    decision = evaluate_lemma("obscurish")
    assert not decision.keep
    assert decision.reason == "not_in_dict_low_freq"


# ---------------------------------------------------------------------------
# 3. Wordlist rescue + MWEs
# ---------------------------------------------------------------------------

def test_wordlist_hit_rescues_orthographic_failure(guard):
    known = {"hmm", "tv"}
    for w in known:
        assert evaluate_lemma(w, is_wordlist_known=lambda x: x in known).keep
        assert not evaluate_lemma(w).keep  # fails without the wordlist


def test_surface_word_also_checked_against_wordlist(guard):
    known = {"gonna"}
    decision = evaluate_lemma("deallng", word="gonna",
                              is_wordlist_known=lambda x: x in known)
    assert decision.keep


def test_multi_word_expressions(guard):
    assert evaluate_lemma("give up").keep
    assert not evaluate_lemma("give |up").keep


# ---------------------------------------------------------------------------
# 4. Missing deps fail open
# ---------------------------------------------------------------------------

def test_no_deps_keeps_wellformed_unknown_words(monkeypatch):
    lg._dictionary_gate.cache_clear()
    monkeypatch.setattr(lg, "_wordfreq_checked", True)
    monkeypatch.setattr(lg, "_word_frequency", None)
    monkeypatch.setattr(lg, "_dictionary_checked", True)
    monkeypatch.setattr(lg, "_dictionary", None)
    try:
        assert evaluate_lemma("blorptastic").keep       # gate disabled -> keep
        assert not evaluate_lemma("cells|were").keep    # wellformedness still enforced
    finally:
        lg._dictionary_gate.cache_clear()


# ---------------------------------------------------------------------------
# 5. display_form
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("word,lemma,expected", [
    ("stakeholders", "stakeholder", "stakeholder"),
    ("Running", "run", "run"),
    ("stakeholders", None, "stakeholders"),   # no lemma -> surface form
    ("mr.", "mr.", "mr."),                    # malformed lemma -> surface form
    ("gave up", "give up", "gave up"),        # MWE lemma -> surface form
])
def test_display_form(word, lemma, expected):
    assert display_form(word, lemma) == expected


# ---------------------------------------------------------------------------
# 6. classify_word: capitalized known words must not skip lemmatization
# ---------------------------------------------------------------------------

def _fake_classifier(wordlist: dict, lemma_map: dict) -> SimpleNamespace:
    """Minimal stand-in for HybridCEFRClassifier along classify_word's path."""
    return SimpleNamespace(
        cefr_wordlist=wordlist,
        multi_word_expressions={},
        has_wordfreq=False,
        use_embedding_classifier=False,
        _get_lemma_fast=lambda w: lemma_map.get(w, w),
    )


def test_capitalized_known_word_is_lemmatized_not_proper_nouned():
    from src.services.cefr_classifier import (
        CEFRLevel,
        ClassificationSource,
        HybridCEFRClassifier,
    )

    fake = _fake_classifier(
        wordlist={"stakeholder": (CEFRLevel.B2, ClassificationSource.OXFORD_3000)},
        lemma_map={"stakeholders": "stakeholder"},
    )
    result = HybridCEFRClassifier.classify_word(fake, "Stakeholders")

    assert result.lemma == "stakeholder"       # NOT "stakeholders"
    assert result.cefr_level == CEFRLevel.B2   # NOT the proper-noun shortcut


def test_capitalized_unknown_word_still_hits_proper_noun_branch():
    from src.services.cefr_classifier import CEFRLevel, HybridCEFRClassifier

    fake = _fake_classifier(wordlist={}, lemma_map={})
    result = HybridCEFRClassifier.classify_word(fake, "Yabzick")

    # UNKNOWN since #91 — this branch used to say A2, which taught names.
    assert result.cefr_level == CEFRLevel.UNKNOWN
    assert result.confidence == 0.9
