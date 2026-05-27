"""
Tests for synonym_service.get_synonyms — the pure WordNet wrapper.

`build_synonym_mcq` is DB-touching and exercised by the P5 smoke test.
These tests rely on NLTK WordNet being installed (already a project dep
via semantic_analyzer.py).
"""
from __future__ import annotations

import pytest

from src.services.synonym_service import get_synonyms


class TestGetSynonyms:
    def test_common_word_has_synonyms(self):
        # "happy" is well-covered in WordNet — at minimum 'glad' is there.
        result = get_synonyms("happy")
        assert "glad" in result, f"expected 'glad' in synonyms, got {sorted(result)}"

    def test_target_excluded(self):
        # The target lemma itself MUST NOT appear in its own synonym set.
        result = get_synonyms("happy")
        assert "happy" not in result

    def test_multi_word_synonyms_excluded(self):
        # WordNet has multi-word lemmas like 'well_chosen' for "happy".
        # We strip those — every result should be a single token.
        for syn in get_synonyms("happy"):
            assert ' ' not in syn, f"unexpected multi-word synonym: {syn!r}"

    def test_case_insensitive(self):
        a = get_synonyms("Happy")
        b = get_synonyms("HAPPY")
        c = get_synonyms("happy")
        assert a == b == c

    def test_unknown_word_returns_empty(self):
        # WordNet won't have synsets for invented strings.
        assert get_synonyms("xqzwvflarble") == set()

    def test_whitespace_tolerant(self):
        assert get_synonyms("  happy  ") == get_synonyms("happy")

    def test_returns_set_type(self):
        # Important: caller depends on set semantics (uniqueness, in checks).
        assert isinstance(get_synonyms("happy"), set)

    @pytest.mark.parametrize("word", ["big", "small", "quick", "happy"])
    def test_common_words_have_at_least_one_synonym(self, word):
        # These should all yield non-empty results; if they don't, the
        # WordNet corpus may not be downloaded.
        result = get_synonyms(word)
        assert len(result) >= 1, f"no WordNet synonyms for {word!r}"


class TestSynonymFiltering:
    """Guards for the three nonsense-synonym fixes: POS scoping,
    dominant-sense restriction, and morphological-derivative filtering."""

    def test_pos_scoping_drops_cross_pos_derivative(self):
        # "coldness" is a lemma of the NOUN sense of "cold"; scoping to the
        # adjective must keep it out (also caught by the derivative filter).
        assert "coldness" not in get_synonyms("cold", "adj")

    def test_morphological_derivative_dropped(self):
        # Same-stem inflections are never synonyms, regardless of POS.
        assert "coldness" not in get_synonyms("cold")
        assert "quickly" not in get_synonyms("quick")

    def test_rare_sense_verb_synonyms_dropped(self):
        # "wander" links to "betray" only via a low-frequency
        # marriage-infidelity sense; "draw" links to "make" via a rare
        # "derive in the mind" sense. Both live past the dominant senses.
        assert "wander" not in get_synonyms("betray", "verb")
        assert "draw" not in get_synonyms("make", "verb")

    def test_common_synonym_survives_filtering(self):
        # The filters must not be so aggressive they drop good synonyms:
        # "glad" is a common synonym of "happy" and should remain.
        assert "glad" in get_synonyms("happy", "adj")

    def test_unknown_pos_falls_back_to_all_senses(self):
        # An unrecognized POS label must degrade to no-POS behavior rather
        # than emptying the pool.
        assert get_synonyms("happy", "gibberish") == get_synonyms("happy")

    def test_max_senses_is_tunable(self):
        # Widening the sense window can only add synonyms, never remove.
        narrow = get_synonyms("betray", "verb", max_senses=3)
        wide = get_synonyms("betray", "verb", max_senses=99)
        assert narrow <= wide
        # The rare "wander" sense reappears once the tail is included.
        assert "wander" in wide
