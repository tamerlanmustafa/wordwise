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
