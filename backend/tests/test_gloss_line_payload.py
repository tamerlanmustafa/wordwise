"""
The gloss line's two halves, from the lemma row to the card.

The Explore card and the movie-detail card deck print "(noun) a place where
money is kept": `lemmas.pos` mapped to a learner label, then
`lemmas.definition`. Three things have to hold for that line to be right, and
each is a separate test below.

  1. The label is mapped server-side. `lemmas.pos` holds raw UPOS tags, and a
     card must never print "PROPN" or "PART". Mapping in one place is what
     stops /srs/feed and /sentences/batch putting different words in front of
     the same definition.
  2. The two halves are independent. `pos` is written when a script is
     classified; `definition` arrives later from the definition worker, and is
     still absent on ~36% of the registry. Every combination of present and
     absent has to render, so neither half may gate the other.
  3. The batch endpoint carries both. It is the deck's only source for a
     collapsed card, and it reads them off rows the lemma-id query already
     fetched — no second query for a cosmetic line.

No DB and no network: SimpleNamespace fakes, and the handler called directly.
"""
import asyncio
from types import SimpleNamespace

import pytest

from src.routes.enrichment import BatchSentencesRequest, get_word_sentences_batch
from src.utils.pos_labels import friendly_pos


# ---------------------------------------------------------------------------
# 1. The label mapping
# ---------------------------------------------------------------------------

def test_content_tags_map_to_learner_labels():
    assert friendly_pos("NOUN") == "noun"
    assert friendly_pos("VERB") == "verb"
    assert friendly_pos("ADJ") == "adj"
    assert friendly_pos("ADV") == "adv"


def test_propn_and_aux_collapse_into_their_plain_forms():
    # Not distinctions a learner needs, and PROPN is frequently a parse error
    # on a capitalised line of dialogue (#91) — labelling those "proper noun"
    # would advertise the mistake.
    assert friendly_pos("PROPN") == "noun"
    assert friendly_pos("AUX") == "verb"


def test_function_word_tags_have_no_label():
    # Dropping beats printing: these words are not taught as vocabulary, so a
    # tag reaching a card at all is already a bug — showing "SCONJ" makes it
    # the reader's problem instead of a blank space.
    for tag in ("PART", "DET", "ADP", "PRON", "SCONJ", "X", "PUNCT"):
        assert friendly_pos(tag) is None


def test_missing_and_odd_input_is_tolerated():
    # `lemmas.pos` is NULL on ~14% of rows and callers pass the column straight
    # through, so None must not raise.
    assert friendly_pos(None) is None
    assert friendly_pos("") is None
    assert friendly_pos("  ") is None
    assert friendly_pos("noun") == "noun"  # already-lowercase input
    assert friendly_pos(" verb ") == "verb"


# ---------------------------------------------------------------------------
# 2 + 3. The batch endpoint's payload
# ---------------------------------------------------------------------------

def _link(lemma_id: int, sentence: str, *, matched_form: str):
    return SimpleNamespace(
        lemmaId=lemma_id,
        matchedForm=matched_form,
        wordPosition=1,
        score=0.9,
        isRepresentative=True,
        sentenceId=lemma_id,
        sentence=SimpleNamespace(sentence=sentence, source="llm", movieId=None),
    )


def _fake_db(*, lemma, definition, pos, sentence="She stood at the bank."):
    """Enough Prisma for the batch handler's fast path.

    Every requested word resolves to one lemma with one global LLM sentence,
    so the slow path is never reached and the payload under test is the cached
    branch — the one that serves the deck in practice.
    """
    async def classification_find_many(where):
        return [SimpleNamespace(word=lemma, lemma=lemma)]

    async def lemma_find_many(where):
        return [
            SimpleNamespace(id=1, lemma=lemma, definition=definition, pos=pos)
        ]

    async def link_find_many(where, include, order):
        return [_link(1, sentence, matched_form=lemma)]

    return SimpleNamespace(
        wordclassification=SimpleNamespace(find_many=classification_find_many),
        lemma=SimpleNamespace(find_many=lemma_find_many),
        sentencelemmalink=SimpleNamespace(find_many=link_find_many),
    )


def _batch(db, word="bank"):
    return asyncio.run(
        get_word_sentences_batch(
            movie_id=42,
            request=BatchSentencesRequest(words=[word], max_examples=1),
            db=db,
            current_user=SimpleNamespace(id=1),
        )
    )["results"][word][0]


def test_batch_payload_carries_both_halves_of_the_line():
    entry = _batch(
        _fake_db(
            lemma="bank",
            definition="the land at the edge of a river",
            pos="NOUN",
        )
    )

    assert entry["pos"] == "noun"
    assert entry["definition"] == "the land at the edge of a river"
    # Still the sentence endpoint it always was.
    assert entry["sentence"] == "She stood at the bank."


@pytest.mark.parametrize(
    "pos,definition,expect_pos,expect_def",
    [
        ("NOUN", "the land at the edge of a river", "noun", "the land at the edge of a river"),
        (None, "the land at the edge of a river", None, "the land at the edge of a river"),
        ("NOUN", None, "noun", None),
        (None, None, None, None),
    ],
    ids=["both", "gloss-only", "label-only", "neither"],
)
def test_each_half_survives_the_other_being_missing(pos, definition, expect_pos, expect_def):
    """The combination that actually dominates prod today is label-only: pos
    has been written for 86% of lemmas and the definition worker has reached
    64%. If a null definition suppressed the label the deck would show an empty
    slot on a third of its cards for no reason."""
    entry = _batch(_fake_db(lemma="bank", definition=definition, pos=pos))

    assert entry["pos"] == expect_pos
    assert entry["definition"] == expect_def
    assert entry["sentence"] == "She stood at the bank."


def test_an_unmapped_tag_reaches_the_client_as_no_label():
    entry = _batch(_fake_db(lemma="up", definition="toward a higher place", pos="PART"), word="up")

    assert entry["pos"] is None
    assert entry["definition"] == "toward a higher place"


def test_the_lemma_row_is_read_once_for_both():
    """The line is cosmetic; it must not cost a query. Both values come off
    the `lemma.find_many` the handler already runs to resolve lemma ids, so
    exactly one call to it serves the whole page."""
    calls = []
    db = _fake_db(lemma="bank", definition="a place for money", pos="NOUN")
    inner = db.lemma.find_many

    async def counting_find_many(where):
        calls.append(where)
        return await inner(where)

    db.lemma.find_many = counting_find_many
    entry = _batch(db)

    assert len(calls) == 1
    assert (entry["pos"], entry["definition"]) == ("noun", "a place for money")
