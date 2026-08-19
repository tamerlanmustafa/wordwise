"""
Unit tests for sentence_bank_service: reading example sentences back out
(get_llm_examples_for_lemmas plus the quiz-route glue that attaches them to
session cards), and writing them in (populate_movie_sentence_bank).

Two things are being protected here:

1. Quiz/review surfaces must only ever show LLM-authored (Haiku) example
   sentences — never raw subtitle extracts — so these tests pin the SQL
   filter and the degrade-to-no-sentence behavior.
2. Population must never run on the event loop (issue #142). It is reached
   from a FastAPI `BackgroundTask`, which is *not* offloading — the task runs
   on the loop once the response is sent — so a full-script spaCy pass there
   stalled every other request in the process.
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.routes import cefr as cefr_routes
from src.routes import quiz as quiz_routes
from src.services import sentence_bank_service
from src.services.quiz_service import CardSpec
from src.services.sentence_bank_service import (
    extract_lemma_sentences,
    get_llm_examples_for_lemmas,
    populate_movie_sentence_bank,
)
from src.utils.nlp_executor import NLPOverloaded, nlp_slot


class _FakeDb:
    """Serves the helper's single raw query and records what was asked."""

    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    async def query_raw(self, sql: str, *args):
        self.calls.append((" ".join(sql.split()), args))
        return self.rows


async def test_returns_best_sentence_per_lemma():
    db = _FakeDb([
        {"lemma": "run", "sentence": "She runs every morning before work."},
        {"lemma": "cold", "sentence": "The soup went cold while we talked."},
    ])
    out = await get_llm_examples_for_lemmas(db, ["run", "cold", "missing"])
    assert out == {
        "run": "She runs every morning before work.",
        "cold": "The soup went cold while we talked.",
    }


async def test_query_restricts_to_global_llm_rows():
    db = _FakeDb([])
    await get_llm_examples_for_lemmas(db, ["run"])
    sql, args = db.calls[0]
    # The whole point of the helper: subtitle-extracted rows must never
    # qualify — only the Haiku-authored global sentences. Since #120 that
    # filter is the denormalized flag on the link rather than two predicates
    # on sentence_bank, so it reads a 2 MB partial index.
    assert "sll.is_global" in sql
    assert "sb.movie_id IS NULL" not in sql
    assert args == (["run"],)


async def test_query_orders_by_the_partial_index_key():
    """
    #120: ORDER BY must name `sll.sentence_id`, not `sb.id`. They are the same
    value, but only the link-side spelling matches ix_sll_global_lemma's key
    order — which is what lets DISTINCT ON walk the index instead of sorting.
    """
    db = _FakeDb([])
    await get_llm_examples_for_lemmas(db, ["run"])
    sql, _ = db.calls[0]
    assert "sll.is_representative DESC" in sql
    assert "sll.score DESC NULLS LAST" in sql
    assert "sll.sentence_id ASC" in sql
    assert "sb.id ASC" not in sql


async def test_empty_input_short_circuits():
    db = _FakeDb([])
    assert await get_llm_examples_for_lemmas(db, []) == {}
    assert db.calls == []


async def test_cards_response_attaches_examples():
    db = _FakeDb([{"lemma": "run", "sentence": "She runs every morning."}])
    cards = [
        CardSpec(word="run", card_type="mcq", translation="correr",
                 choices=[{"word": "correr", "is_correct": True}]),
        CardSpec(word="walk", card_type="self_rate", translation="caminar"),
    ]
    resp = await quiz_routes._cards_response(db, session_id=7, cards=cards)
    by_word = {c.word: c for c in resp.cards}
    assert resp.session_id == 7
    assert by_word["run"].example_sentence == "She runs every morning."
    assert by_word["walk"].example_sentence is None


async def test_cards_response_survives_lookup_failure():
    class _BrokenDb:
        async def query_raw(self, *args):
            raise RuntimeError("db down")

    cards = [CardSpec(word="run", card_type="self_rate", translation=None)]
    resp = await quiz_routes._cards_response(_BrokenDb(), session_id=1, cards=cards)
    assert resp.cards[0].example_sentence is None


# ---------------------------------------------------------------------------
# Population keeps off the event loop (issue #142)
# ---------------------------------------------------------------------------

SCRIPT = "The captain aborted the mission when the storm rolled in. Nobody argued."


def _fake_db(*, populated: bool = False, classifications=(("aborted", "abort"),),
             lemmas=("abort",), script_text: str = SCRIPT):
    """Enough of the Prisma client for populate_movie_sentence_bank.

    Records what gets written so a test can tell "ran and wrote nothing" from
    "never ran at all".
    """
    state = SimpleNamespace(sentences=[], links=[])

    async def sentencebank_find_first(where):
        # The skip_if_exists probe asks by movie alone; the write path asks by
        # (hash, movie). Only the latter should see rows this call created.
        if "sentenceHash" not in where:
            return SimpleNamespace(id=1) if populated else None
        return next(
            (s for s in state.sentences if s.sentenceHash == where["sentenceHash"]),
            None,
        )

    async def sentencebank_create(data):
        row = SimpleNamespace(id=len(state.sentences) + 1, **data)
        state.sentences.append(row)
        return row

    async def link_create(data):
        state.links.append(data)
        return SimpleNamespace(id=len(state.links))

    async def movie_find_unique(where, include):
        return SimpleNamespace(
            id=where["id"],
            movieScripts=[SimpleNamespace(id=7, cleanedScriptText=script_text)],
        )

    async def classification_find_many(where):
        return [SimpleNamespace(word=w, lemma=lem) for w, lem in classifications]

    async def lemma_find_many(where):
        return [SimpleNamespace(lemma=lem, id=i) for i, lem in enumerate(lemmas, 1)]

    return SimpleNamespace(
        state=state,
        sentencebank=SimpleNamespace(
            find_first=sentencebank_find_first, create=sentencebank_create
        ),
        sentencelemmalink=SimpleNamespace(create=link_create),
        movie=SimpleNamespace(find_unique=movie_find_unique),
        wordclassification=SimpleNamespace(find_many=classification_find_many),
        lemma=SimpleNamespace(find_many=lemma_find_many),
    )


def _stub_extraction(monkeypatch, result=None, *, before=None):
    """Replace the CPU-bound extractor: spaCy isn't installed in CI, and these
    tests are about where the work runs, not what it finds."""
    calls = []

    def fake_extract(script_text, target_lemmas, word_to_lemma, max_per_lemma):
        calls.append(threading.current_thread().ident)
        if before is not None:
            before()
        return {} if result is None else result

    monkeypatch.setattr(sentence_bank_service, "extract_lemma_sentences", fake_extract)
    return calls


async def test_extraction_runs_on_the_worker_thread(monkeypatch):
    calls = _stub_extraction(
        monkeypatch, {"abort": [("The captain aborted the mission.", 2, "aborted")]}
    )
    db = _fake_db()

    stats = await populate_movie_sentence_bank(db, 42)

    assert stats["status"] == "populated"
    assert stats["links_created"] == 1
    assert calls and calls[0] != threading.current_thread().ident


async def test_event_loop_keeps_serving_during_population():
    """The #142 regression guard: an unrelated request must make progress
    while a movie's sentence bank is being built. Before the fix this ran
    inline in a BackgroundTask and the loop got nothing for the whole parse."""
    ticks = 0

    async def unrelated_request():
        nonlocal ticks
        while True:
            ticks += 1
            await asyncio.sleep(0.005)

    def slow_extract(*_args):
        time.sleep(0.2)  # stands in for the 1.6-2.9s spaCy pass
        return {}

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(sentence_bank_service, "extract_lemma_sentences", slow_extract)
        ticker = asyncio.create_task(unrelated_request())
        try:
            await populate_movie_sentence_bank(_fake_db(), 42)
        finally:
            ticker.cancel()

    assert ticks > 1


async def test_offloads_once_for_the_whole_script(monkeypatch):
    """Both CPU passes — the spaCy parse and the regex gap-filler — ride one
    trip to the worker. Two hops would take two queue slots and let another
    caller's parse interleave between them (utils/offload.py)."""
    hops = []
    real_run_nlp = sentence_bank_service.run_nlp

    async def counting_run_nlp(fn, *args, **kwargs):
        hops.append(fn)
        return await real_run_nlp(fn, *args, **kwargs)

    _stub_extraction(monkeypatch)
    monkeypatch.setattr(sentence_bank_service, "run_nlp", counting_run_nlp)

    await populate_movie_sentence_bank(_fake_db(), 42)

    assert len(hops) == 1


async def test_sheds_at_the_door_when_the_nlp_queue_is_full(monkeypatch):
    """Backpressure: past the cap the population is dropped before any work
    starts, rather than joining a queue that already guarantees a long wait."""
    calls = _stub_extraction(monkeypatch)
    db = _fake_db()

    with nlp_slot(1):  # queue already at this caller's cap
        with pytest.raises(NLPOverloaded):
            await populate_movie_sentence_bank(db, 42, max_pending=1)

    assert calls == []
    assert db.state.sentences == []


async def test_offline_callers_are_never_shed(monkeypatch):
    """The backfill script and the movie worker pass no cap. Their whole job
    is to populate, and neither shares a process with live requests."""
    _stub_extraction(monkeypatch, {"abort": [("A sentence.", 0, "aborted")]})

    with nlp_slot(1):
        stats = await populate_movie_sentence_bank(_fake_db(), 42)

    assert stats["status"] == "populated"


async def test_already_populated_movie_never_touches_the_queue(monkeypatch):
    """Idempotence check comes first, so a re-open of a done movie costs one
    query and no place in line."""
    calls = _stub_extraction(monkeypatch)

    stats = await populate_movie_sentence_bank(
        _fake_db(populated=True), 42, max_pending=1
    )

    assert stats["status"] == "already_populated"
    assert calls == []


# ---------------------------------------------------------------------------
# The gap-filler survived the move onto the worker thread
# ---------------------------------------------------------------------------

def _stub_spacy_pass(monkeypatch, returns):
    from src.services import lemmatization_service
    from src.services.sentence_example_service import SentenceExampleService

    monkeypatch.setattr(lemmatization_service, "get_nlp", lambda: None)
    monkeypatch.setattr(
        SentenceExampleService,
        "extract_sentences_for_lemmas",
        lambda self, *a, **k: dict(returns),
    )


def test_gap_filler_covers_what_the_parse_missed(monkeypatch):
    """A classified word that spaCy didn't return still gets the literal
    whole-word fallback — the behavior users notice ("the word is in the
    script, just find a sentence")."""
    _stub_spacy_pass(monkeypatch, {})

    out = extract_lemma_sentences(SCRIPT, {"abort"}, {"aborted": "abort"}, 3)

    sentence, position, matched_form = out["abort"][0]
    assert sentence.startswith("The captain aborted")
    assert matched_form == "aborted"
    assert position == 2  # index of "aborted" in the tokenized sentence


def test_gap_filler_leaves_parsed_lemmas_alone(monkeypatch):
    """Fallback sentences are lower quality, so they only fill real gaps."""
    parsed = {"abort": [("Mission aborted, everyone out.", 1, "aborted")]}
    _stub_spacy_pass(monkeypatch, parsed)

    out = extract_lemma_sentences(SCRIPT, {"abort"}, {"aborted": "abort"}, 3)

    assert out["abort"] == parsed["abort"]


def test_gap_filler_skips_words_with_no_lemma_row(monkeypatch):
    """target_lemmas is the set that resolved to a Lemma id; anything else has
    nowhere to link to."""
    _stub_spacy_pass(monkeypatch, {})

    out = extract_lemma_sentences(SCRIPT, {"abort"}, {"storm": "storm"}, 3)

    assert out == {}


# ---------------------------------------------------------------------------
# Route + background-task wiring
# ---------------------------------------------------------------------------

async def test_route_hands_the_cap_to_the_background_task(monkeypatch):
    """Without the cap the population queues unboundedly behind user-facing
    parses, which is the state #142 left the loop in once it stopped blocking."""
    from fastapi import BackgroundTasks

    monkeypatch.setattr(
        cefr_routes, "run_script_classification", AsyncMock(return_value="result")
    )
    background_tasks = BackgroundTasks()

    await cefr_routes.classify_script(
        cefr_routes.ScriptClassificationRequest(movie_id=7),
        background_tasks,
        db=None,
        current_user=None,
    )

    task = background_tasks.tasks[0]
    assert task.func is cefr_routes.populate_sentence_bank_bg
    assert task.args == (7,)
    assert task.kwargs == {"max_pending": cefr_routes.MAX_PENDING_BANK_PARSES}
    assert cefr_routes.MAX_PENDING_BANK_PARSES > 0


async def test_background_task_treats_a_shed_as_a_skip(monkeypatch, caplog):
    """A full queue is not an error — population refires on the next
    classification of the movie — so it must not page anyone."""
    db = SimpleNamespace(connect=AsyncMock(), disconnect=AsyncMock())
    monkeypatch.setattr(cefr_routes, "Prisma", lambda: db)
    monkeypatch.setattr(
        sentence_bank_service,
        "populate_movie_sentence_bank",
        AsyncMock(side_effect=NLPOverloaded("NLP queue at capacity (2/2)")),
    )

    with caplog.at_level(logging.WARNING):
        await cefr_routes.populate_sentence_bank_bg(42, max_pending=2)

    db.disconnect.assert_awaited_once()
    assert "NLP queue full" in caplog.text
    assert not [r for r in caplog.records if r.levelno >= logging.ERROR]
