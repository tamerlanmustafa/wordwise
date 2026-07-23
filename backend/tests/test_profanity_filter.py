"""
Tests for the vocabulary profanity filter (src/services/profanity_filter.py)
and its integration points:

1. Strong profanity and slurs are blocked, including regular inflections.
2. Innocent words that merely CONTAIN a blocked substring are never touched
   (the Scunthorpe problem) - matching must stay exact.
3. Mild swears we deliberately teach stay in the vocabulary.
4. The lemma guard rejects profanity, and a curated-wordlist hit does NOT
   rescue it (our wordlists contain swear words).
5. The read-time filter in should_keep_word drops profanity at any CEFR
   level, for classifications stored before the guard existed.
"""
from __future__ import annotations

import pytest

from src.services.profanity_filter import (
    BLOCKED_WORDS,
    KEPT_MILD,
    is_profane,
    is_profane_entry,
)


# ---------------------------------------------------------------------------
# 1. Blocked terms and their inflections
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("term", [
    "fuck", "fucks", "fucked", "fucking", "fucker", "motherfucker",
    "shit", "shits", "shitty", "bullshit", "shithead",
    "cunt", "cunts", "bitch", "bitches", "bitchy", "bastard", "bastards",
    "asshole", "assholes", "dickhead", "whore", "whores", "slut", "twat",
    "wanker", "goddamn", "cocksucker", "douchebag",
])
def test_strong_profanity_blocked(term):
    assert is_profane(term)


@pytest.mark.parametrize("term", [
    "nigger", "nigga", "chink", "spic", "kike", "wetback",
    "faggot", "fag", "tranny", "shemale",
    "retard", "retarded", "spaz", "midget",
])
def test_slurs_blocked(term):
    assert is_profane(term)


def test_case_and_whitespace_insensitive():
    assert is_profane("  FUCK  ")
    assert is_profane("BiTcH")


@pytest.mark.parametrize("term", ["fucked-up", "son of a bitch", "son-of-a-bitch"])
def test_compound_forms_blocked(term):
    assert is_profane(term)


@pytest.mark.parametrize("term", [
    "a chink in the armor", "chink in the armor",
    "cock and bull story", "spick and span",
])
def test_idioms_built_on_innocent_senses_are_kept(term):
    """
    Regression, caught against prod data: these are real C2 idioms in our own
    MWE dictionary. A blocked-but-ambiguous part ("chink" = a crack, "cock" =
    rooster) must not condemn the whole phrase.
    """
    assert not is_profane(term)


@pytest.mark.parametrize("term", ["fuckhead", "goddam", "whorehouse", "chinky", "tittie"])
def test_compounds_found_in_prod_vocabulary_blocked(term):
    """These were sitting in prod word_classifications and the filter missed them."""
    assert is_profane(term)


def test_is_profane_entry_checks_both_forms():
    # Surface form profane, lemma clean-looking, and vice versa.
    assert is_profane_entry("fucking", "fuck")
    assert is_profane_entry("shitting", None)
    assert not is_profane_entry("running", "run")


# ---------------------------------------------------------------------------
# 2. Scunthorpe safety: exact matching only, never substring
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("word", [
    # contain "ass"
    "classic", "assume", "assassin", "bass", "passage", "grass", "embassy",
    # contain "cock"
    "cockpit", "cocktail", "peacock", "cockroach",
    # contain "tit"
    "title", "attitude", "constitution", "titan", "competitive",
    # contain "cum" / "hell" / "dick"
    "document", "cucumber", "shellfish", "hello", "dickens",
    # contain "homo" / "fag" / "spic"
    "homogeneous", "homophone", "fagot", "suspicion",
    # hyphenated compounds with an innocent part list
    "shell-shocked", "well-known", "sign-off",
])
def test_innocent_words_not_flagged(word):
    assert not is_profane(word)


@pytest.mark.parametrize("word", [
    "spiced", "spicing",   # spic + verb endings
    "japed", "japing",     # jap + verb endings ("jape" = to joke)
    "poofed", "dyking", "fagged",
])
def test_slur_bases_are_not_given_verb_endings(word):
    """
    Regression: slurs are nouns. Expanding them with -ed/-ing manufactured
    real English words and silently deleted them from the vocabulary.
    """
    assert not is_profane(word)


def test_no_blocked_form_is_a_substring_false_positive():
    # Structural guarantee: the filter never scans substrings, so a word is
    # flagged only if it (or a separated part) is literally in the blocklist.
    assert not is_profane("assassinate")
    assert "assassinate" not in BLOCKED_WORDS


# ---------------------------------------------------------------------------
# 3. Mild swears are kept on purpose
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("term", [
    "damn", "hell", "crap", "bloody", "screw", "screwed", "jerk",
    "ass", "piss", "suck", "sucks", "freaking", "bugger",
])
def test_mild_swears_kept(term):
    assert not is_profane(term)


def test_kept_mild_never_leaks_into_blocklist():
    # Guards against an inflection expander accidentally re-adding one.
    assert not (KEPT_MILD & BLOCKED_WORDS)


# ---------------------------------------------------------------------------
# 4. Lemma guard integration
# ---------------------------------------------------------------------------

def test_guard_rejects_profanity():
    from src.services.lemma_guard import evaluate_lemma

    decision = evaluate_lemma("fuck")
    assert not decision.keep
    assert decision.reason == "profanity"


def test_wordlist_does_not_rescue_profanity():
    # INFORMAL_SIMPLE_VOCAB really does contain "bitch"/"bastard", so the
    # profanity check must run before the wordlist short-circuit.
    from src.services.lemma_guard import evaluate_lemma

    known = {"bitch", "bastard"}
    for w in known:
        decision = evaluate_lemma(w, is_wordlist_known=lambda x: x in known)
        assert not decision.keep
        assert decision.reason == "profanity"


def test_guard_rejects_when_only_surface_form_is_profane():
    from src.services.lemma_guard import evaluate_lemma

    decision = evaluate_lemma("fuck", word="fucking")
    assert not decision.keep
    assert decision.reason == "profanity"


def test_curated_wordlists_are_actually_affected():
    """The premise of the ordering fix: our wordlists do contain swear words."""
    from src.services.cefr_classifier import INFORMAL_SIMPLE_VOCAB

    assert any(is_profane(w) for w in INFORMAL_SIMPLE_VOCAB)


# ---------------------------------------------------------------------------
# 5. Read-time filter (pre-guard rows already in the DB)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("word,lemma,level", [
    ("fucking", "fuck", "B1"),
    ("bitches", "bitch", "A2"),
    ("bastard", "bastard", "C1"),
])
def test_should_keep_word_drops_profanity_at_any_level(word, lemma, level):
    from src.routes.cefr import should_keep_word

    assert not should_keep_word(word, lemma, level)


def test_should_keep_word_still_keeps_normal_vocabulary():
    from src.routes.cefr import should_keep_word

    assert should_keep_word("stakeholder", "stakeholder", "B2")
    assert should_keep_word("damn", "damn", "B1")   # mild, kept on purpose
    assert not should_keep_word("the", "the", "A1")  # ultra-common A1 filter
