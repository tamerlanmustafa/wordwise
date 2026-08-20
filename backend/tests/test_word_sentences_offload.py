"""
`GET /enrichment/movies/{id}/sentences/{word}` keeps spaCy off the event loop
(issue #143).

This handler is what a tapped word row calls. It is an `async def`, and before
this fix it called spaCy inline in four places — including a whole-script parse
(1.6-2.9s) whenever SentenceBank had nothing for the word. On a single-process
API that is not one slow request, it is every concurrent request stalling for
the length of the parse.

What is protected here:

1. The whole-script parses (slow path and phrase path) run on the NLP worker
   thread, and the event loop keeps serving while they do.
2. They shed at the door once the NLP queue is full, rather than joining a
   line that already guarantees a long wait — the caller gets the row without
   a sentence, flagged as `sentences_unavailable`.
3. Every path costs at most **one** hop to the worker. The lemma retry rides
   the same trip as the first pass, and the legacy `matched_form` rows are
   parsed together with `nlp.pipe` rather than one hop per sentence.
4. The cached fast path — the overwhelmingly common one — still touches the
   worker zero times, so this fix did not add latency to it.

spaCy isn't installed in the CI test env, so the parser is faked. These tests
are about *where* the work runs, not what it finds.
"""
from __future__ import annotations

import ast
import asyncio
import contextlib
import threading
import time
from types import SimpleNamespace

import pytest

from src.routes import enrichment as enrichment_routes
from src.routes.enrichment import MAX_PENDING_SENTENCE_PARSES, get_word_sentences
from src.services import lemmatization_service
from src.services.sentence_example_service import SentenceExampleService
from src.utils.nlp_executor import nlp_slot

SCRIPT = "The captain aborted the mission when the storm rolled in. Nobody argued."


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------

class _FakeNlp:
    """Stands in for the spaCy `Language` object.

    Lemmatizes by lowercasing, which is enough: no test here asserts on
    linguistics, only on which thread the call happened and how many times.
    """

    def __init__(self):
        self.pipe_calls = []

    def __call__(self, text):
        return [
            SimpleNamespace(text=tok, lemma_=tok.lower().strip(".,!?"))
            for tok in text.split()
        ]

    def pipe(self, texts):
        texts = list(texts)
        self.pipe_calls.append(texts)
        return [self(t) for t in texts]


def _link(sentence: str, *, matched_form: str | None, position: int = 0):
    return SimpleNamespace(
        matchedForm=matched_form,
        wordPosition=position,
        score=1.0,
        sentence=SimpleNamespace(sentence=sentence, source="subtitle", movieId=42),
    )


def _fake_db(*, classification=None, lemma_id=1, links=(), script_text=SCRIPT):
    """Enough of the Prisma client for the sentences handler.

    `classification=None` forces the bare-word lemma fallback; `links=()` forces
    the whole-script slow path.
    """
    async def classification_find_first(where):
        return classification

    async def lemma_find_first(where):
        return SimpleNamespace(id=lemma_id, lemma=where["lemma"]) if lemma_id else None

    async def link_find_many(where, include):
        return list(links)

    async def movie_find_unique(where, include):
        return SimpleNamespace(
            id=where["id"],
            movieScripts=[SimpleNamespace(id=7, cleanedScriptText=script_text)],
        )

    return SimpleNamespace(
        wordclassification=SimpleNamespace(find_first=classification_find_first),
        lemma=SimpleNamespace(find_first=lemma_find_first),
        sentencelemmalink=SimpleNamespace(find_many=link_find_many),
        movie=SimpleNamespace(find_unique=movie_find_unique),
    )


def _stub_spacy(monkeypatch):
    """Swap in the fake parser and return it, so tests can inspect `pipe` use."""
    nlp = _FakeNlp()
    monkeypatch.setattr(lemmatization_service, "get_nlp", lambda: nlp)
    return nlp


def _stub_extractor(monkeypatch, name, result=None, *, before=None):
    """Replace one CPU-bound extractor and record the thread it ran on."""
    calls = []

    def fake(self, *args, **kwargs):
        calls.append(threading.current_thread().ident)
        if before is not None:
            before()
        return list(result or [])

    monkeypatch.setattr(SentenceExampleService, name, fake)
    return calls


def _count_hops(monkeypatch):
    """Wrap `run_nlp` so a test can assert one trip to the worker, not N."""
    hops = []
    real_run_nlp = enrichment_routes.run_nlp

    async def counting_run_nlp(fn, *args, **kwargs):
        hops.append(fn)
        return await real_run_nlp(fn, *args, **kwargs)

    monkeypatch.setattr(enrichment_routes, "run_nlp", counting_run_nlp)
    return hops


async def _call(db, word="abort", **kwargs):
    return await get_word_sentences(
        42, word, db=db, current_user=None, _=None, **kwargs
    )


# ---------------------------------------------------------------------------
# 1. The whole-script parses run off the event loop
# ---------------------------------------------------------------------------

async def test_slow_path_parse_runs_on_the_worker_thread(monkeypatch):
    _stub_spacy(monkeypatch)
    calls = _stub_extractor(
        monkeypatch,
        "extract_word_sentences_by_lemma",
        [("The captain aborted the mission.", 2, "aborted")],
    )

    result = await _call(_fake_db())

    assert result["total"] == 1
    assert calls and calls[0] != threading.current_thread().ident


async def test_phrase_path_parse_runs_on_the_worker_thread(monkeypatch):
    _stub_spacy(monkeypatch)
    calls = _stub_extractor(
        monkeypatch, "extract_phrase_sentences", [("Give it up.", 0, "give up")]
    )

    result = await _call(_fake_db(), word="give up")

    assert result["total"] == 1
    assert calls and calls[0] != threading.current_thread().ident


async def test_event_loop_keeps_serving_during_a_slow_path_parse(monkeypatch):
    """The #143 regression guard. Before the fix, `/health` measured 7.86s
    behind one of these parses (#117); here an unrelated coroutine simply has
    to make progress while the parse is in flight."""
    _stub_spacy(monkeypatch)
    _stub_extractor(
        monkeypatch,
        "extract_word_sentences_by_lemma",
        before=lambda: time.sleep(0.2),  # stands in for the 1.6-2.9s pass
    )
    ticks = 0

    async def unrelated_request():
        nonlocal ticks
        while True:
            ticks += 1
            await asyncio.sleep(0.005)

    ticker = asyncio.create_task(unrelated_request())
    try:
        await _call(_fake_db())
    finally:
        ticker.cancel()

    assert ticks > 1


# ---------------------------------------------------------------------------
# 2. Backpressure: a full queue sheds instead of piling up
# ---------------------------------------------------------------------------

@contextlib.contextmanager
def _nlp_queue_full():
    """Hold every slot this endpoint is allowed to claim."""
    with contextlib.ExitStack() as stack:
        for _ in range(MAX_PENDING_SENTENCE_PARSES):
            stack.enter_context(nlp_slot(MAX_PENDING_SENTENCE_PARSES))
        yield


async def test_slow_path_sheds_when_the_nlp_queue_is_full(monkeypatch):
    _stub_spacy(monkeypatch)
    calls = _stub_extractor(
        monkeypatch, "extract_word_sentences_by_lemma", [("A sentence.", 0, "abort")]
    )

    with _nlp_queue_full():
        result = await _call(_fake_db())

    assert calls == [], "the parse should have been shed before it started"
    assert result["sentences"] == []
    assert result["sentences_unavailable"] is True


async def test_phrase_path_sheds_when_the_nlp_queue_is_full(monkeypatch):
    _stub_spacy(monkeypatch)
    calls = _stub_extractor(
        monkeypatch, "extract_phrase_sentences", [("Give it up.", 0, "give up")]
    )

    with _nlp_queue_full():
        result = await _call(_fake_db(), word="give up")

    assert calls == []
    assert result["sentences"] == []
    assert result["sentences_unavailable"] is True


async def test_a_served_answer_is_not_flagged_unavailable(monkeypatch):
    """`sentences_unavailable` must mean "shed", not "found nothing" — the two
    are the same empty list otherwise, and only one of them is a capacity
    problem worth alerting on."""
    _stub_spacy(monkeypatch)
    _stub_extractor(monkeypatch, "extract_word_sentences_by_lemma", [])

    result = await _call(_fake_db())

    assert result["sentences"] == []
    assert result["sentences_unavailable"] is False


async def test_this_endpoint_yields_before_the_vocabulary_preview_does():
    """The caps are priorities on one shared counter, not private reservations.
    A tapped word row is waiting on screen, so it must give up its place before
    the cheaper cached endpoints do."""
    from src.routes.movies import MAX_PENDING_PREVIEW_PARSES

    assert MAX_PENDING_SENTENCE_PARSES < MAX_PENDING_PREVIEW_PARSES


# ---------------------------------------------------------------------------
# 3. One hop per request, never one per item
# ---------------------------------------------------------------------------

async def test_the_lemma_retry_rides_the_same_hop(monkeypatch):
    """When the bare-word lemma disagrees with the in-context one, the handler
    re-runs the extraction against the surface form. Both passes must share a
    single trip to the worker — two would take two queue entries and let
    another caller's script parse interleave between them."""
    _stub_spacy(monkeypatch)
    calls = _stub_extractor(monkeypatch, "extract_word_sentences_by_lemma", [])
    hops = _count_hops(monkeypatch)

    # No classification row → bare-word lemmatization, which the fake resolves
    # to "unimpaired" ≠ ... it matches the surface, so force a mismatch with a
    # classifier lemma that differs from the requested word.
    db = _fake_db(classification=SimpleNamespace(lemma="abort", cefrLevel="B2"))
    await _call(db, word="aborted")

    assert len(calls) == 2, "the surface-form retry did not run"
    assert len(hops) == 1, f"{len(hops)} hops to the NLP worker, expected 1"


async def test_legacy_matched_forms_are_parsed_in_one_pipe_call(monkeypatch):
    """Rows indexed before `matched_form` was stored need a parse to recover it.
    Two such rows must cost one `nlp.pipe` call on one hop, not two hops."""
    nlp = _stub_spacy(monkeypatch)
    hops = _count_hops(monkeypatch)
    links = [
        _link("The captain aborted the mission.", matched_form=None),
        _link("They aborted again at dawn.", matched_form=None),
    ]

    db = _fake_db(
        classification=SimpleNamespace(lemma="aborted", cefrLevel="B2"), links=links
    )
    result = await _call(db, word="aborted", max_examples=2)

    assert len(hops) == 1
    assert nlp.pipe_calls == [
        ["The captain aborted the mission.", "They aborted again at dawn."]
    ]
    assert [s["matched_form"] for s in result["sentences"]] == ["aborted", "aborted"]


async def test_cached_rows_never_touch_the_worker(monkeypatch):
    """The common case: SentenceBank has the row and `matched_form` is stored.
    Adding a thread hop to *this* path would have made the fix a regression."""
    _stub_spacy(monkeypatch)
    hops = _count_hops(monkeypatch)
    links = [_link("The captain aborted the mission.", matched_form="aborted")]

    db = _fake_db(
        classification=SimpleNamespace(lemma="abort", cefrLevel="B2"), links=links
    )
    result = await _call(db, word="abort")

    assert hops == []
    assert result["sentences"][0]["matched_form"] == "aborted"
    assert result["sentences_unavailable"] is False


async def test_bare_word_lemmatization_is_offloaded(monkeypatch):
    """No classification row means the lemma comes from spaCy. One word is
    ~0.6ms, but the first call after a restart is a ~1.8s model load, and this
    handler cannot tell which one it is getting."""
    _stub_spacy(monkeypatch)
    _stub_extractor(monkeypatch, "extract_word_sentences_by_lemma", [])
    hops = _count_hops(monkeypatch)

    result = await _call(_fake_db(classification=None), word="Aborted")

    assert result["lemma"] == "aborted"
    # One hop for the lemma, one for the slow-path extraction — no more.
    assert len(hops) == 2


# ---------------------------------------------------------------------------
# 4. Nothing in this handler offloads per item
# ---------------------------------------------------------------------------

#: Anything that touches the parser. Every one of these must sit inside a
#: nested `def` — the closure `run_nlp` hands to the worker thread — and never
#: in the handler body itself.
SPACY_CALLS = {
    "get_nlp",
    "pipe",
    "extract_word_sentences_by_lemma",
    "extract_phrase_sentences",
}


class _CallScopes(ast.NodeVisitor):
    """Record, for every call, the innermost function that contains it."""

    def __init__(self):
        self.stack: list[str] = []
        self.found: list[tuple[str, str, int]] = []

    def visit_FunctionDef(self, node):
        self.stack.append(node.name)
        self.generic_visit(node)
        self.stack.pop()

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_Call(self, node):
        name = getattr(node.func, "id", None) or getattr(node.func, "attr", None)
        if name in SPACY_CALLS:
            self.found.append((name, self.stack[-1] if self.stack else "", node.lineno))
        self.generic_visit(node)


def test_no_spacy_call_is_left_in_the_handler_body():
    """The guard that survives a refactor: no reviewer, and no linter, can see
    that an ordinary-looking call is a 2.9s CPU burn. Ruff's ASYNC rules only
    know about *known* blocking APIs (`open`, `time.sleep`, `requests`), so a
    reinstated `nlp(sent)` here would lint clean and stall the process again.

    Every parser call must be lexically inside a nested closure — that closure
    is what gets handed to the worker thread.
    """
    import inspect
    import textwrap

    visitor = _CallScopes()
    visitor.visit(ast.parse(textwrap.dedent(inspect.getsource(get_word_sentences))))

    assert visitor.found, "no spaCy calls found at all — did the handler move?"
    offenders = [
        (name, line)
        for name, enclosing, line in visitor.found
        if enclosing == "get_word_sentences"
    ]
    assert not offenders, (
        f"{offenders} run in the handler body, i.e. on the event loop. Move the "
        "call into a closure and await it through run_nlp (#143)."
    )


@pytest.mark.parametrize("word", ["abort", "give up"])
async def test_shed_answers_keep_the_response_shape(monkeypatch, word):
    """A shed must still return the shape the app parses — the row renders
    without an example rather than erroring."""
    _stub_spacy(monkeypatch)
    _stub_extractor(monkeypatch, "extract_word_sentences_by_lemma", [])
    _stub_extractor(monkeypatch, "extract_phrase_sentences", [])

    with _nlp_queue_full():
        result = await _call(_fake_db(), word=word)

    assert set(result) >= {
        "movie_id", "word", "lemma", "sentences", "total", "sentences_unavailable"
    }
    assert result["total"] == 0
