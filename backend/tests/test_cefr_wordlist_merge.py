"""
Tests for how graded wordlist entries collapse onto a lemma, and for the
Zipf=0 branch that used to make B2 a drain.

The wordlists grade **surface forms**; `cefr_wordlist` is keyed by **lemma**.
That is a many-to-one map (952 collisions in comprehensive_cefr.json alone),
and the old merge rule was "whichever entry was read first wins" — which in a
roughly alphabetical file handed the key to an inflected form:

    made B2   beat  make A1        said B2  beat  say A1
    ran  B2   beat  run  A1        babies C1 beat baby A1

79 lemmas ended up graded harder than their own base form says, and prod
served `make` (the 8th most frequent English word) as a B2 card.

1. Within one wordlist the easiest grade wins, whatever the read order.
2. A higher-priority wordlist still wins outright — that ordering is
   deliberate and the collision fix must not flatten it.
3. Collisions are counted, because a silent merge is what hid this.
4. Zipf=0 ("in no corpus at all") is no opinion, not B2.
5. End to end against the real data file: the top-40 words come out easy.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from src.services.cefr_classifier import (
    CEFRLevel,
    ClassificationSource,
    HybridCEFRClassifier,
)


def _merge_target():
    """Bare stand-in carrying only what `_record_wordlist_entry` touches."""
    return SimpleNamespace(
        cefr_wordlist={},
        _wordlist_priority={},
        _wordlist_collisions=0,
        _wordlist_relaxations=0,
    )


def _record(target, lemma, level, source=ClassificationSource.EFLLEX, priority=1):
    return HybridCEFRClassifier._record_wordlist_entry(
        target, lemma, level, source, priority
    )


# ---------------------------------------------------------------------------
# 1. Easiest grade wins inside one wordlist
# ---------------------------------------------------------------------------

def test_harder_inflected_form_does_not_claim_the_lemma():
    """`made`=B2 read before `make`=A1 must still leave the lemma at A1."""
    t = _merge_target()
    _record(t, "make", CEFRLevel.B2)   # from the entry "made"
    _record(t, "make", CEFRLevel.A1)   # from the entry "make"
    assert t.cefr_wordlist["make"][0] == CEFRLevel.A1


def test_easiest_wins_regardless_of_read_order():
    t_forward = _merge_target()
    _record(t_forward, "baby", CEFRLevel.C1)
    _record(t_forward, "baby", CEFRLevel.A1)

    t_reverse = _merge_target()
    _record(t_reverse, "baby", CEFRLevel.A1)
    _record(t_reverse, "baby", CEFRLevel.C1)

    assert t_forward.cefr_wordlist["baby"] == t_reverse.cefr_wordlist["baby"]
    assert t_forward.cefr_wordlist["baby"][0] == CEFRLevel.A1


def test_a_harder_entry_never_replaces_an_easier_one():
    t = _merge_target()
    assert _record(t, "angry", CEFRLevel.A1) is True
    assert _record(t, "angry", CEFRLevel.C1) is False
    assert t.cefr_wordlist["angry"][0] == CEFRLevel.A1


def test_unknown_is_not_a_level_and_is_never_recorded():
    """UNKNOWN must not sort as 'easiest' and win every collision."""
    t = _merge_target()
    assert _record(t, "widget", CEFRLevel.UNKNOWN) is False
    assert "widget" not in t.cefr_wordlist

    _record(t, "widget", CEFRLevel.B1)
    assert _record(t, "widget", CEFRLevel.UNKNOWN) is False
    assert t.cefr_wordlist["widget"][0] == CEFRLevel.B1


# ---------------------------------------------------------------------------
# 2. Source priority still beats level
# ---------------------------------------------------------------------------

def test_lower_priority_wordlist_cannot_override_a_higher_one():
    """Even with an easier grade — `_load_cefr_wordlists` order is deliberate."""
    t = _merge_target()
    _record(t, "estate", CEFRLevel.B2, ClassificationSource.EFLLEX, priority=1)
    assert (
        _record(t, "estate", CEFRLevel.A1, ClassificationSource.EVP, priority=4)
        is False
    )
    assert t.cefr_wordlist["estate"] == (CEFRLevel.B2, ClassificationSource.EFLLEX)


def test_source_is_carried_with_the_winning_level():
    t = _merge_target()
    _record(t, "clothe", CEFRLevel.C1, ClassificationSource.EFLLEX, priority=1)
    _record(t, "clothe", CEFRLevel.A1, ClassificationSource.OXFORD_3000, priority=1)
    assert t.cefr_wordlist["clothe"] == (CEFRLevel.A1, ClassificationSource.OXFORD_3000)


# ---------------------------------------------------------------------------
# 3. Collisions are counted, not silent
# ---------------------------------------------------------------------------

def test_collisions_and_relaxations_are_counted():
    t = _merge_target()
    _record(t, "make", CEFRLevel.B2)
    assert t._wordlist_collisions == 0          # first write is not a collision

    _record(t, "make", CEFRLevel.A1)            # collision, and it relaxes
    assert t._wordlist_collisions == 1
    assert t._wordlist_relaxations == 1

    _record(t, "make", CEFRLevel.C2)            # collision, but changes nothing
    assert t._wordlist_collisions == 2
    assert t._wordlist_relaxations == 1


# ---------------------------------------------------------------------------
# 4. Zipf = 0 is the absence of evidence
# ---------------------------------------------------------------------------

def _frequency_target(rank, zipf):
    return SimpleNamespace(_get_frequency_data=lambda lemma: (rank, zipf))


def test_word_in_no_corpus_gets_no_level():
    """`triregnum`/`bushwa` used to land in B2 at confidence 0.20."""
    result = HybridCEFRClassifier._classify_by_frequency(
        _frequency_target(rank=0, zipf=0.0), "triregnum", "triregnum"
    )
    assert result is None


@pytest.mark.parametrize(
    "zipf,expected",
    [
        (6.4, CEFRLevel.A1),
        (5.2, CEFRLevel.A2),
        (4.1, CEFRLevel.B1),
        (3.4, CEFRLevel.B2),
    ],
)
def test_words_with_real_frequency_still_get_graded(zipf, expected):
    """The Zipf ladder above 0 is untouched by the fix."""
    result = HybridCEFRClassifier._classify_by_frequency(
        _frequency_target(rank=500, zipf=zipf), "word", "word"
    )
    assert result is not None
    assert result.cefr_level == expected
    assert result.source == ClassificationSource.FREQUENCY_BACKOFF


# ---------------------------------------------------------------------------
# 5. End to end against the shipped wordlist
# ---------------------------------------------------------------------------

# The words that made this visible in prod, with the entry that used to win.
REGRESSION_WORDS = {
    "make": CEFRLevel.A1,    # lost to made=B2
    "say": CEFRLevel.A1,     # lost to said=B2
    "run": CEFRLevel.A1,     # lost to ran=B2
    "baby": CEFRLevel.A1,    # lost to babies=C1
    "angry": CEFRLevel.A1,   # lost to angrier=C1
    "amaze": CEFRLevel.A1,   # lost to amaze=B2, poisoning "amazing"
    "excite": CEFRLevel.A1,  # lost to excite=B2, poisoning "excited"
    "clothe": CEFRLevel.A1,  # lost to clothe=C1, poisoning "clothes"
}


@pytest.fixture(scope="module")
def loaded_wordlist():
    """Run the real loader over the shipped file, without a full classifier.

    `HybridCEFRClassifier.__init__` pulls in the embedding model and the NLTK
    downloads; the loader itself only needs a lemmatizer and the four merge
    attributes, so bind the methods onto a namespace carrying those.
    """
    from pathlib import Path

    from nltk.stem import WordNetLemmatizer

    data_dir = Path(__file__).resolve().parents[1] / "data" / "cefr"
    path = data_dir / "comprehensive_cefr.json"
    if not path.exists():
        pytest.skip("CEFR wordlist data not present")

    target = _merge_target()
    target.multi_word_expressions = {}
    target.lemmatizer = WordNetLemmatizer()
    target._get_lemma_simple = lambda w: HybridCEFRClassifier._get_lemma_simple(
        target, w
    )
    target._record_wordlist_entry = (
        lambda lemma, level, source, priority: (
            HybridCEFRClassifier._record_wordlist_entry(
                target, lemma, level, source, priority
            )
        )
    )
    HybridCEFRClassifier._load_comprehensive_wordlist(target, path)
    assert target.cefr_wordlist, "loader produced nothing — fixture is wrong"
    return target.cefr_wordlist


@pytest.mark.parametrize("word,expected", sorted(REGRESSION_WORDS.items()))
def test_common_words_are_not_graded_by_their_hardest_inflection(
    loaded_wordlist, word, expected
):
    assert word in loaded_wordlist, f"{word!r} missing from the loaded wordlist"
    assert loaded_wordlist[word][0] == expected
