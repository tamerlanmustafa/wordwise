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
    # Real vocabulary the 1934 dictionary predates and the frequency floor
    # rejects — the exact shape of the 876 curated entries the registry used
    # to lose (#96). "gibberage" is the control: same band, not curated.
    ("stopwatch", "en"): 1e-7,
    ("gibberage", "en"): 1e-7,
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


# ---------------------------------------------------------------------------
# 7. Write-path parity (#96): the two callers must agree
#
# classify_text (word_classifications) always passed the curated wordlists;
# lemmatize_script (the V2 `lemmas` registry) passed nothing, so 876 curated
# forms were classified but never registered. These tests pin the wiring, not
# the wordlist contents — the curated set is injected.
# ---------------------------------------------------------------------------

class _FakeToken:
    """Only the attributes lemmatize_script reads off a spaCy token.

    spaCy is not installed in CI, and lemmatize_script takes a pre-parsed
    `doc` (#140), so the parse is supplied rather than run.
    """

    def __init__(self, text: str, lemma: str, pos: str = "NOUN"):
        self.text = text
        self.lemma_ = lemma
        self.pos_ = pos
        self.is_punct = False
        self.is_space = False
        self.like_num = False


@pytest.fixture
def curated(monkeypatch):
    """Inject the curated vocabulary set, bypassing the wordlist files.

    "mr." and "1970s" stand in for the 176 real entries that are curated but
    are not vocabulary — the shipped lists really do contain "'s", "etc.",
    "3rd", "km" and "paralyze/paralyse".
    """
    from src.services import cefr_classifier as cc

    monkeypatch.setattr(cc, "_curated_forms", frozenset({"stopwatch", "mr.", "1970s"}))
    yield


def test_curated_lemma_rescued_in_registry_path(guard, curated):
    from src.services.cefr_classifier import is_curated_vocabulary
    from src.services.lemmatization_service import lemmatize_script

    doc = [
        _FakeToken("stopwatch", "stopwatch"),
        _FakeToken("gibberage", "gibberage"),
    ]
    result = lemmatize_script("a stopwatch and a gibberage", doc=doc)

    # The curated word now reaches the registry...
    assert "stopwatch" in result.unique_lemmas
    # ...and the uncurated one in the same frequency band still does not.
    assert "gibberage" not in result.unique_lemmas

    # Mutation check: drop the wordlist argument, as the code did before #96,
    # and "stopwatch" is rejected — so the assertion above is load-bearing.
    assert not evaluate_lemma("stopwatch").keep
    assert evaluate_lemma("stopwatch", is_wordlist_known=is_curated_vocabulary).keep


def test_wordlist_rescue_does_not_override_orthography_in_registry(guard, curated):
    """Curated != vocabulary: debris must not ride the rescue into `lemmas`.

    evaluate_lemma's wordlist short-circuit outranks well-formedness, so
    handing it the raw curated set would admit "'s", "mr.", "etc." and "1970s"
    — exactly what purge_impure_lemmas.py had to delete. The registry's
    predicate applies the rescue to the dictionary/frequency gate only.
    """
    from src.services.cefr_classifier import is_curated_vocabulary
    from src.services.lemmatization_service import lemmatize_script, registry_wordlist_known

    doc = [
        _FakeToken("Mr.", "mr.", pos="PROPN"),
        _FakeToken("1970s", "1970s"),
        _FakeToken("stopwatch", "stopwatch"),
    ]
    result = lemmatize_script("Mr. Smith in the 1970s with a stopwatch", doc=doc)

    assert "mr." not in result.unique_lemmas
    assert "1970s" not in result.unique_lemmas
    assert "stopwatch" in result.unique_lemmas

    # The raw predicate would have let both through — the wrapper is the fix,
    # not the wordlist contents.
    assert evaluate_lemma("mr.", is_wordlist_known=is_curated_vocabulary).keep
    assert not evaluate_lemma("mr.", is_wordlist_known=registry_wordlist_known).keep


def test_both_write_paths_agree_on_the_same_lemma(guard, curated):
    """classify_text's closure and the registry's predicate give one answer."""
    from src.services.cefr_classifier import (
        KIDS_SIMPLE_VOCAB,
        INFORMAL_SIMPLE_VOCAB,
        is_curated_vocabulary,
    )

    classifier_side = _fake_classifier(wordlist={"stopwatch": None}, lemma_map={})

    def classify_text_closure(w: str) -> bool:
        # Verbatim shape of the closure in cefr_classifier.classify_text.
        return (
            w in classifier_side.cefr_wordlist
            or w in classifier_side.multi_word_expressions
            or w in KIDS_SIMPLE_VOCAB
            or w in INFORMAL_SIMPLE_VOCAB
        )

    for lemma in ("stopwatch", "gibberage"):
        assert (
            evaluate_lemma(lemma, is_wordlist_known=classify_text_closure).keep
            == evaluate_lemma(lemma, is_wordlist_known=is_curated_vocabulary).keep
        )


def test_missing_wordlists_fall_back_to_pre_96_behaviour(guard, monkeypatch):
    """A failed wordlist load must not change any decision, or crash a parse."""
    from src.services import cefr_classifier as cc

    monkeypatch.setattr(cc, "_curated_forms", None)
    monkeypatch.setattr(
        cc, "get_shared_classifier", lambda: (_ for _ in ()).throw(OSError("no data dir"))
    )

    assert cc.is_curated_vocabulary("stopwatch") is False
    assert not evaluate_lemma("stopwatch", is_wordlist_known=cc.is_curated_vocabulary).keep
    assert evaluate_lemma("good", is_wordlist_known=cc.is_curated_vocabulary).keep


def test_routes_share_one_classifier_instance(monkeypatch):
    """#96 collapsed two route-local singletons onto one shared instance."""
    from src.routes import admin as admin_routes
    from src.routes import cefr as cefr_routes
    from src.services import cefr_classifier as cc

    sentinel = object()
    monkeypatch.setattr(cc, "get_shared_classifier", lambda: sentinel)
    monkeypatch.setattr(cefr_routes, "get_shared_classifier", lambda: sentinel)
    monkeypatch.setattr(admin_routes, "get_shared_classifier", lambda: sentinel)

    assert cefr_routes.get_classifier() is sentinel
    assert admin_routes.get_classifier() is sentinel
