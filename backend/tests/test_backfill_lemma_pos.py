"""
`lemmas.pos` gets filled from each lemma's own example sentence.

The cards print "(noun) a wild animal like a large dog". Measured on prod
2026-08-30, 5,839 of 42,668 lemmas had no tag, and the hole is not random: every
lemma created in the March 2026 import is untagged and everything created since
is tagged, so it lands on the oldest and most common words (A1 19.8% tagged, C1
95.3%). Those are exactly the words Explore shows most, so the reader meets the
gap constantly — `wolf` and `bank` had no label while `linger` did.

What is protected here:

1. The tag is read from the token in the lemma's own global example sentence —
   the same sentence its definition was written from. That is what stops
   "(verb)" appearing in front of a noun's gloss on the same card.
2. Silence beats a guess. No token match, a multi-word lemma, a structural tag,
   or a sentence-initial PROPN all leave the row NULL for a later run. A blank
   label costs the reader nothing; a wrong one teaches them something false.
3. One parse for the whole batch, and an idempotent UPDATE narrow enough that
   a re-run cannot touch a row someone else has since tagged.

No spaCy and no database: the Doc is a list of token stubs, which is all
`resolve_pos` reads.
"""
from __future__ import annotations

from types import SimpleNamespace

import backfill_lemma_pos as backfill


def _tok(text: str, pos: str, i: int, lemma: str | None = None):
    """A stand-in for a spaCy Token — `text`, `pos_`, `lemma_`, `i`."""
    return SimpleNamespace(text=text, pos_=pos, lemma_=lemma or text.lower(), i=i)


def _doc(*tokens):
    return list(tokens)


class TestResolvePos:
    def test_the_recorded_surface_form_is_tagged(self):
        # "wolf" as the corpus actually uses it, not as a dictionary would.
        doc = _doc(
            _tok("The", "DET", 0),
            _tok("wolf", "NOUN", 1),
            _tok("howled", "VERB", 2, lemma="howl"),
        )
        assert backfill.resolve_pos(doc, "wolf", "wolf") == "NOUN"

    def test_an_inflected_form_is_found_by_lemma(self):
        # matched_form can be absent or stale; the lemma still locates the token.
        doc = _doc(
            _tok("Wolves", "NOUN", 0, lemma="wolf"),
            _tok("hunt", "VERB", 1),
        )
        assert backfill.resolve_pos(doc, "wolf", None) == "NOUN"

    def test_the_sense_in_the_sentence_wins_over_the_common_one(self):
        # The whole reason for tagging the sentence rather than the headword:
        # this lemma's card shows the river sense, so its label must agree with
        # the gloss printed beside it, not with the word's usual sense.
        doc = _doc(
            _tok("They", "PRON", 0),
            _tok("bank", "VERB", 1),
            _tok("the", "DET", 2),
            _tok("plane", "NOUN", 3),
        )
        assert backfill.resolve_pos(doc, "bank", "bank") == "VERB"

    def test_a_later_occurrence_is_preferred_over_the_first_word(self):
        # Position 0 is where the tagger's proper-noun branch misfires (#91);
        # a second occurrence carries the same sense without the capital.
        doc = _doc(
            _tok("Wolf", "PROPN", 0, lemma="wolf"),
            _tok("packs", "NOUN", 1),
            _tok("wolf", "NOUN", 2),
        )
        assert backfill.resolve_pos(doc, "wolf", "wolf") == "NOUN"

    def test_a_sentence_initial_propn_alone_is_not_enough_evidence(self):
        # "Wolves hunt in packs" must not turn `wolf` into a name. Leaving NULL
        # costs one blank label; writing PROPN prints "(noun)" for a proper
        # noun the word is not.
        doc = _doc(_tok("Wolves", "PROPN", 0, lemma="wolf"), _tok("hunt", "VERB", 1))
        assert backfill.resolve_pos(doc, "wolf", None) is None

    def test_a_propn_away_from_the_start_is_trusted(self):
        # Mid-sentence there is no capitalisation artifact to explain it away.
        doc = _doc(
            _tok("A", "DET", 0),
            _tok("Wolf", "PROPN", 1, lemma="wolf"),
            _tok("arrived", "VERB", 2),
        )
        assert backfill.resolve_pos(doc, "wolf", "Wolf") == "PROPN"

    def test_no_match_leaves_the_row_untagged(self):
        doc = _doc(_tok("Something", "PRON", 0), _tok("else", "ADV", 1))
        assert backfill.resolve_pos(doc, "wolf", "wolf") is None

    def test_structural_tags_mean_the_match_was_wrong(self):
        for junk in ("PUNCT", "SPACE", "NUM", "SYM", "X"):
            doc = _doc(_tok("wolf", junk, 1))
            assert backfill.resolve_pos(doc, "wolf", "wolf") is None

    def test_a_blank_tag_is_not_written(self):
        doc = _doc(_tok("wolf", "", 1))
        assert backfill.resolve_pos(doc, "wolf", "wolf") is None


class _FakeNlp:
    """`nlp.pipe` over the batch, recording how many times it was called."""

    def __init__(self, docs):
        self.docs = docs
        self.pipe_calls = []

    def pipe(self, texts):
        self.pipe_calls.append(list(texts))
        return list(self.docs)


class TestTagRows:
    def test_the_whole_batch_is_one_parse(self):
        # Same reason the SRS lemmatizer batches (#144): per-call overhead
        # dwarfs the text, and 5.5k separate parses cost several times one pipe.
        rows = [
            {"id": 1, "lemma": "wolf", "matched_form": "wolf", "sentence": "The wolf howled.", "is_multi_word": False},
            {"id": 2, "lemma": "howl", "matched_form": "howled", "sentence": "The wolf howled.", "is_multi_word": False},
        ]
        nlp = _FakeNlp([
            _doc(_tok("The", "DET", 0), _tok("wolf", "NOUN", 1)),
            _doc(_tok("The", "DET", 0), _tok("howled", "VERB", 1, lemma="howl")),
        ])

        out = backfill.tag_rows(rows, nlp)

        assert len(nlp.pipe_calls) == 1
        assert out == [{"id": 1, "pos": "NOUN"}, {"id": 2, "pos": "VERB"}]

    def test_a_multi_word_lemma_never_reaches_the_parser(self):
        # "give up" spans two tokens with two tags; choosing one is a guess.
        rows = [{"id": 3, "lemma": "give up", "matched_form": "give", "sentence": "Give up now.", "is_multi_word": True}]
        nlp = _FakeNlp([])

        assert backfill.tag_rows(rows, nlp) == []
        assert nlp.pipe_calls == []

    def test_an_unresolvable_row_is_skipped_not_defaulted(self):
        # The skipped row keeps its NULL and stays in the next run's backlog —
        # it must not be written as NOUN because NOUN is the common answer.
        rows = [
            {"id": 4, "lemma": "wolf", "matched_form": "wolf", "sentence": "Nothing matches.", "is_multi_word": False},
            {"id": 5, "lemma": "howl", "matched_form": "howled", "sentence": "The wolf howled.", "is_multi_word": False},
        ]
        nlp = _FakeNlp([
            _doc(_tok("Nothing", "PRON", 0), _tok("matches", "VERB", 1)),
            _doc(_tok("The", "DET", 0), _tok("howled", "VERB", 1, lemma="howl")),
        ])

        assert backfill.tag_rows(rows, nlp) == [{"id": 5, "pos": "VERB"}]


class TestWriteShape:
    def test_the_update_only_touches_untagged_rows(self):
        # Idempotence and blast radius in one predicate: a re-run cannot
        # overwrite a tag written since, and no other column is in the SET.
        sql = backfill.UPDATE_SQL
        assert "l.pos IS NULL" in sql
        assert "SET pos = r.pos" in sql
        for owned_elsewhere in ("cefr_level", "confidence", "source", "definition"):
            assert owned_elsewhere not in sql

    def test_the_pending_query_anchors_to_the_definition_s_sentence(self):
        # Byte-for-byte the ordering `definition_worker`, `/srs/feed` and both
        # enrichment endpoints use. If this drifts, a lemma gets tagged from one
        # sentence and glossed from another, and the card contradicts itself.
        sql = backfill.PENDING_SQL
        assert "sll.is_representative DESC" in sql
        assert "sll.score DESC NULLS LAST" in sql
        assert "sll.sentence_id ASC" in sql
        assert "l.pos IS NULL" in sql
        assert "sll.is_global" in sql
