"""
Tests for the internationalism filter (src/services/internationalism_filter.py)
and its integration points (issue #89).

1. Internationally recognisable words are blocked, including regular
   inflections and the written-apart variants ("wi-fi", "hot dog").
2. Innocent words that merely CONTAIN a blocked form are never touched
   ("grammar" vs "gram") - matching must stay exact.
3. Words deliberately kept teachable stay in the vocabulary, including the
   English homographs ("rock", "second") and the Latinate layer we chose not
   to cut ("problem", "doctor").
4. The lemma guard rejects internationalisms, and a curated-wordlist hit does
   NOT rescue them (the CEFR lists rate many of them A1/A2).
5. The read-time filter in should_keep_word drops them at any CEFR level, for
   classifications stored before the filter existed.
"""
from __future__ import annotations

import pytest

from src.services.internationalism_filter import (
    BLOCKED_WORDS,
    KEPT_TEACHABLE,
    is_internationalism,
    is_internationalism_entry,
)


# ---------------------------------------------------------------------------
# 1. Blocked terms and their inflections
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("term", [
    # the four examples named in issue #89
    "gram", "kilometer", "football", "iphone",
    # units
    "kilogram", "milligram", "metre", "liter", "litre", "tonne", "volt",
    "kilowatt", "hertz", "celsius", "fahrenheit", "calorie", "megabyte",
    # tech
    "internet", "wifi", "email", "laptop", "software", "podcast", "selfie",
    "emoji", "robot", "laser", "radar", "bluetooth",
    # brands
    "ipad", "android", "google", "facebook", "instagram", "youtube",
    "netflix", "spotify", "wikipedia", "playstation", "xbox",
    # sports
    "basketball", "volleyball", "tennis", "golf", "hockey", "judo",
    "karate", "yoga", "marathon",
    # food and drink
    "pizza", "spaghetti", "pasta", "hamburger", "chocolate", "banana",
    "cocktail", "sushi", "kebab", "yogurt", "restaurant", "alcohol",
    # travel, culture, misc
    "taxi", "hotel", "metro", "helicopter", "piano", "guitar", "jazz",
    "karaoke", "cinema", "shampoo", "plastic", "tsunami", "bikini", "jeans",
])
def test_internationalisms_blocked(term):
    assert is_internationalism(term)


@pytest.mark.parametrize("term", [
    "grams", "kilometers", "kilometres", "liters", "footballs", "iphones",
    "taxis", "hotels", "pizzas", "robots", "lasers", "emojis", "selfies",
    "footballer", "footballers", "olympiad",
])
def test_regular_inflections_blocked(term):
    assert is_internationalism(term)


@pytest.mark.parametrize("term", [
    "googled", "googling", "filmed", "filming", "tattooed", "tattooing",
    "barbecued", "snowboarding", "skateboarded",
])
def test_verbal_forms_blocked(term):
    """The handful of bases that are genuinely English verbs get -ed/-ing."""
    assert is_internationalism(term)


@pytest.mark.parametrize("term", ["picnicked", "picnicking"])
def test_irregular_forms_spelled_out(term):
    """picnic takes a k; the regular -ed/-ing rule cannot produce these."""
    assert is_internationalism(term)


def test_case_and_whitespace_insensitive():
    assert is_internationalism("  GRAM  ")
    assert is_internationalism("iPhone")
    assert is_internationalism("KiLoMeTeR")


@pytest.mark.parametrize("term", ["wi-fi", "wi fi", "e-mail", "hot dog", "hot-dog"])
def test_written_apart_variants_blocked(term):
    """Hyphen/space variants must reach the solid blocklist entry."""
    assert is_internationalism(term)


def test_is_internationalism_entry_checks_both_forms():
    # Surface form matches, lemma matches, and neither matches.
    assert is_internationalism_entry("kilometers", "kilometer")
    assert is_internationalism_entry("grams", None)
    assert not is_internationalism_entry("running", "run")


# ---------------------------------------------------------------------------
# 2. Exact matching only, never substring
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("word", [
    # contain "gram"
    "grammar", "program", "programme", "telegram", "diagram", "grammatical",
    "anagram", "grampa",
    # contain "meter" / "metre"
    "parameter", "perimeter", "symmetry", "barometer",
    # contain "ton" / "bus"
    "tone", "stone", "button", "cotton", "business", "busy", "ambush",
    # contain "film" / "bar" / "menu"
    "filmy", "barn", "barrier", "embargo",
    # contain "cola" / "jazz" / "golf"
    "chocolate_bar", "colander", "gulf",
    # contain a brand name
    "androgynous", "windowsill", "goggle",
])
def test_innocent_words_not_flagged(word):
    assert not is_internationalism(word)


def test_windows_is_not_blocked():
    """
    Regression: "windows" is the plural of "window" far more often than it is
    the OS, so the brand list must not contain it.
    """
    assert not is_internationalism("windows")
    assert not is_internationalism("window")


def test_no_blocked_form_is_a_substring_false_positive():
    # Structural guarantee: the filter never scans substrings, so a word is
    # flagged only if it is literally in the blocklist.
    assert not is_internationalism("grammar")
    assert "grammar" not in BLOCKED_WORDS


def test_phrases_are_not_condemned_by_one_part():
    """
    Unlike the profanity filter, no single part condemns a phrase - real
    idioms in our MWE dictionary are built on these words.
    """
    assert not is_internationalism("get the ball rolling")
    assert not is_internationalism("drop the ball")
    assert not is_internationalism("a piece of cake")


# ---------------------------------------------------------------------------
# 3. Words kept teachable on purpose
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("term", [
    # English homograph dominates the international sense
    "rock", "pop", "bar", "zoom", "app", "cricket", "second", "minute",
    "star", "click", "block", "post", "match", "set", "table", "note",
])
def test_english_homographs_kept(term):
    assert not is_internationalism(term)


@pytest.mark.parametrize("term", [
    # the Latinate layer we deliberately did not cut (conservative scope)
    "computer", "problem", "system", "police", "doctor", "student",
    "university", "professor", "program", "information", "family",
    "virus", "vitamin", "television", "telephone", "president", "camera",
    "photo", "video", "studio", "festival", "concert", "museum", "energy",
])
def test_latinate_layer_kept_teachable(term):
    assert not is_internationalism(term)


def test_kept_teachable_never_leaks_into_blocklist():
    # Guards against a future expander change silently re-adding one.
    assert not (KEPT_TEACHABLE & BLOCKED_WORDS)


# ---------------------------------------------------------------------------
# 4. Lemma guard integration
# ---------------------------------------------------------------------------

def test_guard_rejects_internationalism():
    from src.services.lemma_guard import evaluate_lemma

    decision = evaluate_lemma("kilometer")
    assert not decision.keep
    assert decision.reason == "internationalism"


def test_wordlist_does_not_rescue_internationalism():
    # The CEFR wordlists really do rate these A1/A2, so the internationalism
    # check must run before the wordlist short-circuit.
    from src.services.lemma_guard import evaluate_lemma

    known = {"pizza", "football", "hotel"}
    for w in known:
        decision = evaluate_lemma(w, is_wordlist_known=lambda x: x in known)
        assert not decision.keep
        assert decision.reason == "internationalism"


def test_guard_rejects_when_only_surface_form_matches():
    from src.services.lemma_guard import evaluate_lemma

    decision = evaluate_lemma("kilometer", word="kilometers")
    assert not decision.keep
    assert decision.reason == "internationalism"


def test_guard_still_keeps_normal_vocabulary():
    from src.services.lemma_guard import evaluate_lemma

    for w in ("stakeholder", "reluctant", "grammar", "doctor"):
        assert evaluate_lemma(w).keep, w


def test_profanity_still_outranks_internationalism():
    """Ordering regression: the profanity reason must not be shadowed."""
    from src.services.lemma_guard import evaluate_lemma

    decision = evaluate_lemma("fuck")
    assert not decision.keep
    assert decision.reason == "profanity"


def test_curated_wordlists_are_actually_affected():
    """
    The premise of the ordering fix: our curated wordlists really do contain
    internationalisms ("pizza", "chocolate", "robot" are all in the kids/
    informal vocab), so a wordlist hit would rescue them if it ran first.
    """
    from src.services.cefr_classifier import INFORMAL_SIMPLE_VOCAB, KIDS_SIMPLE_VOCAB

    assert any(is_internationalism(w) for w in KIDS_SIMPLE_VOCAB | INFORMAL_SIMPLE_VOCAB)


# ---------------------------------------------------------------------------
# 5. Read-time filter (rows stored before the filter existed)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("word,lemma,level", [
    ("kilometers", "kilometer", "A2"),
    ("football", "football", "A1"),
    ("saxophone", "saxophone", "B2"),
    ("kilowatt", "kilowatt", "C1"),
])
def test_should_keep_word_drops_internationalisms_at_any_level(word, lemma, level):
    from src.routes.cefr import should_keep_word

    assert not should_keep_word(word, lemma, level)


def test_should_keep_word_still_keeps_normal_vocabulary():
    from src.routes.cefr import should_keep_word

    assert should_keep_word("stakeholder", "stakeholder", "B2")
    assert should_keep_word("grammar", "grammar", "B1")
    assert should_keep_word("doctor", "doctor", "A2")
