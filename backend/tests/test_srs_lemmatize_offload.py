"""
`POST /srs/session/start` batches its spaCy work and keeps it off the event
loop (issue #144).

Starting a review session lemmatizes every surface form in the deck twice: once
to dedupe the queue (two saved inflections of one word must not become two
identical-looking cards) and once to hydrate the cards. Both used to be a
`for` loop calling spaCy one word at a time, inline in an `async def`. At
~0.64ms a word and a composer cap of ten rows that is only ~13ms — but it is
~13ms during which *every* concurrent request on this single-process API is
stopped, and it grows with the user's deck.

Measured locally on `en_core_web_sm`, ten one-word forms, median of five runs:
per-word `nlp(w)` 6.40ms, batched `nlp.pipe` 1.73ms, identical results.

What is protected here:

1. Batching does not change what comes out: same lemma, same POS chip, same
   fallbacks for blanks and for a spaCy that won't load.
2. The whole deck is one `nlp.pipe` call, and repeats are parsed once.
3. Session start costs at most **two** hops to the NLP worker — one for the due
   rows, one more only if padding added forms — never one per word. The worker
   pool is a single thread, so N hops is N queue entries behind every other
   caller's script parse.
4. The event loop keeps serving while the parse is in flight.
5. A static guard, because nothing else can see it: no reviewer and no linter
   can tell that `_lemmatize_many(...)` on its own is a CPU burn on the loop.

spaCy isn't installed in the CI test env, so the parser is faked. These tests
are about *where* and *how often* the work runs, not about linguistics.
"""
from __future__ import annotations

import ast
import asyncio
import inspect
import textwrap
import threading
import time
from datetime import datetime, timezone
from types import SimpleNamespace

from src.routes import srs as srs_routes
from src.routes.srs import _lemmatize_many, start_session
from src.services import lemmatization_service


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------

class _FakeToken:
    def __init__(self, text: str, lemma: str, pos: str):
        self.text = text
        self.lemma_ = lemma
        self.pos_ = pos


#: Just enough irregularity to prove the map is keyed on the surface form and
#: the pipe order is preserved. Anything absent lemmatizes to itself.
_LEMMAS = {
    "running": ("run", "VERB"),
    "hated": ("hate", "VERB"),
    "ran": ("run", "VERB"),
    "storms": ("storm", "NOUN"),
    "Captain": ("captain", "NOUN"),
}


class _FakeNlp:
    """Stands in for the spaCy `Language` object."""

    def __init__(self, *, before=None):
        self.pipe_calls: list[list[str]] = []
        self.call_threads: list[int] = []
        self._before = before

    def _parse(self, text: str):
        lemma, pos = _LEMMAS.get(text, (text.lower(), "NOUN"))
        return [_FakeToken(text, lemma, pos)]

    def __call__(self, text):
        return self._parse(text)

    def pipe(self, texts):
        texts = list(texts)
        self.pipe_calls.append(texts)
        self.call_threads.append(threading.current_thread().ident)
        if self._before is not None:
            self._before()
        return [self._parse(t) for t in texts]


def _stub_spacy(monkeypatch, **kwargs) -> _FakeNlp:
    nlp = _FakeNlp(**kwargs)
    monkeypatch.setattr(lemmatization_service, "get_nlp", lambda: nlp)
    return nlp


def _user_word(id: int, word: str, movie_id=None):
    return SimpleNamespace(
        id=id,
        word=word,
        movieId=movie_id,
        srsBox=1,
        srsDueAt=datetime.now(timezone.utc),
    )


def _fake_db(due_count: int = 0):
    """Enough of the Prisma client for the session-start handler."""
    async def count(where):
        return due_count

    async def find_many(where=None, **kwargs):
        return []

    async def query_raw(sql, *args):
        return []

    async def update(where, data):
        return None

    return SimpleNamespace(
        userword=SimpleNamespace(count=count, find_many=find_many),
        word=SimpleNamespace(find_many=find_many),
        movie=SimpleNamespace(find_many=find_many),
        user=SimpleNamespace(update=update),
        query_raw=query_raw,
    )


def _premium_user():
    # Admin ⇒ premium ⇒ the free daily cap doesn't fire, so these tests are
    # about the parse and nothing else.
    return SimpleNamespace(
        id=1, isAdmin=True, nativeLanguage="en", proficiencyLevel="B1",
    )


def _count_hops(monkeypatch):
    """Wrap `run_nlp` so a test can assert two trips to the worker, not N."""
    hops = []
    real_run_nlp = srs_routes.run_nlp

    async def counting_run_nlp(fn, *args, **kwargs):
        hops.append(fn)
        return await real_run_nlp(fn, *args, **kwargs)

    monkeypatch.setattr(srs_routes, "run_nlp", counting_run_nlp)
    return hops


def _stub_session(monkeypatch, *, due: list, padded: list = ()):
    """Pin the two row sources and neutralise everything after hydration."""
    async def compose(db, **kwargs):
        return list(due)

    async def pad(db, **kwargs):
        return list(padded)

    async def no_examples(db, lemmas):
        return {}

    monkeypatch.setattr(srs_routes, "compose_for_kind", compose)
    monkeypatch.setattr(srs_routes, "_pad_with_fresh_reel_lemmas", pad)
    monkeypatch.setattr(srs_routes, "get_llm_examples_for_lemmas", no_examples)
    # One card per row, so the response reflects the deduped queue rather than
    # whatever the (separately tested) distractor picker decides.
    monkeypatch.setattr(
        srs_routes, "build_translation_choices",
        lambda lemma, translations, rng=None: [{"word": lemma, "is_correct": True}],
    )


async def _start(db=None, user=None):
    return await start_session(
        kind="quick_recall",
        movie_id=None,
        list_id=None,
        current_user=user or _premium_user(),
        db=db or _fake_db(),
    )


# ---------------------------------------------------------------------------
# 1. Batching did not change the answers
# ---------------------------------------------------------------------------

def test_batch_returns_lemma_and_friendly_pos_per_surface_form(monkeypatch):
    _stub_spacy(monkeypatch)

    result = _lemmatize_many(["running", "storms"])

    assert result == {"running": ("run", "verb"), "storms": ("storm", "noun")}


def test_lemma_is_lowercased(monkeypatch):
    """Downstream translation/CEFR lookups key on the lemma, so a capitalized
    saved word must not produce a second, differently-cased card."""
    _stub_spacy(monkeypatch)

    assert _lemmatize_many(["Captain"])["Captain"][0] == "captain"


def test_unmapped_pos_gets_no_chip(monkeypatch):
    """spaCy tags outside `POS_FRIENDLY` render no chip rather than a
    confusing raw "PART" / "X"."""
    _stub_spacy(monkeypatch)
    monkeypatch.setitem(_LEMMAS, "up", ("up", "PART"))

    assert _lemmatize_many(["up"])["up"] == ("up", None)


def test_blank_forms_never_reach_the_parser(monkeypatch):
    nlp = _stub_spacy(monkeypatch)

    assert _lemmatize_many(["", "   "]) == {"": ("", None), "   ": ("   ", None)}
    assert nlp.pipe_calls == [], "a blank word should not cost a parse"


def test_a_dead_parser_degrades_the_whole_batch_instead_of_raising(monkeypatch):
    """The failure this guards against is model-level — an unloadable model —
    so it takes the batch with it. Session start must still compose cards,
    keyed on the lowercased surface form."""
    def boom():
        raise RuntimeError("model not found")

    monkeypatch.setattr(lemmatization_service, "get_nlp", boom)

    assert _lemmatize_many(["Running", "hated"]) == {
        "Running": ("running", None),
        "hated": ("hated", None),
    }


# ---------------------------------------------------------------------------
# 2. One pipe call for the deck, repeats parsed once
# ---------------------------------------------------------------------------

def test_the_whole_batch_is_one_pipe_call(monkeypatch):
    nlp = _stub_spacy(monkeypatch)

    _lemmatize_many(["running", "hated", "storms"])

    assert nlp.pipe_calls == [["running", "hated", "storms"]]


def test_a_repeated_form_is_parsed_once_and_still_answered(monkeypatch):
    nlp = _stub_spacy(monkeypatch)

    result = _lemmatize_many(["ran", "running", "ran"])

    assert nlp.pipe_calls == [["ran", "running"]]
    assert result == {"ran": ("run", "verb"), "running": ("run", "verb")}


# ---------------------------------------------------------------------------
# 3. Hops per session start: at most two, never one per word
# ---------------------------------------------------------------------------

async def test_a_full_deck_costs_one_hop(monkeypatch):
    """The common case — the due queue already fills the session, so nothing is
    padded and the hydration pass reuses the map the dedupe pass built."""
    _stub_spacy(monkeypatch)
    rows = [_user_word(i, w) for i, w in enumerate(
        ["running", "hated", "storms", "ran", "captain",
         "alpha", "beta", "gamma", "delta", "epsilon"], start=1)]
    _stub_session(monkeypatch, due=rows)
    hops = _count_hops(monkeypatch)

    result = await _start()

    assert len(hops) == 1, f"{len(hops)} hops for a 10-word deck, expected 1"
    # "ran" and "running" both lemmatize to "run" — one card, not two.
    assert [c.word for c in result.cards] == [
        "run", "hate", "storm", "captain",
        "alpha", "beta", "gamma", "delta", "epsilon",
    ]


async def test_padding_adds_exactly_one_more_hop(monkeypatch):
    """A short queue gets topped up from the reel *after* the dedupe pass, so
    those forms need a second parse — one hop for all of them, not one each."""
    nlp = _stub_spacy(monkeypatch)
    _stub_session(
        monkeypatch,
        due=[_user_word(1, "running")],
        padded=[_user_word(i, w) for i, w in enumerate(["storms", "hated"], start=2)],
    )
    hops = _count_hops(monkeypatch)

    result = await _start()

    assert len(hops) == 2, f"{len(hops)} hops with padding, expected 2"
    assert sorted(nlp.pipe_calls[1]) == ["hated", "storms"], (
        "the second hop re-parsed forms the first hop already resolved"
    )
    assert sorted(c.word for c in result.cards) == ["hate", "run", "storm"]


async def test_an_empty_queue_never_touches_the_worker(monkeypatch):
    """Nothing due and nothing padded — a free user tapping into an empty queue
    must not pay for a thread hop, or for a model load."""
    _stub_spacy(monkeypatch)
    _stub_session(monkeypatch, due=[])
    hops = _count_hops(monkeypatch)

    result = await _start()

    assert hops == []
    assert result.cards == []


# ---------------------------------------------------------------------------
# 4. The parse runs off the event loop
# ---------------------------------------------------------------------------

async def test_the_parse_runs_on_the_worker_thread(monkeypatch):
    nlp = _stub_spacy(monkeypatch)
    _stub_session(monkeypatch, due=[_user_word(1, "running")])

    await _start()

    assert nlp.call_threads and nlp.call_threads[0] != threading.current_thread().ident


async def test_event_loop_keeps_serving_during_the_parse(monkeypatch):
    """The #117 regression guard, scaled down to this handler: an unrelated
    request has to make progress while the deck is being parsed."""
    _stub_spacy(monkeypatch, before=lambda: time.sleep(0.2))
    _stub_session(monkeypatch, due=[_user_word(1, "running")])
    ticks = 0

    async def unrelated_request():
        nonlocal ticks
        while True:
            ticks += 1
            await asyncio.sleep(0.005)

    ticker = asyncio.create_task(unrelated_request())
    try:
        await _start()
    finally:
        ticker.cancel()

    assert ticks > 1


# ---------------------------------------------------------------------------
# 5. Static guard: the parse can only be reached through the worker
# ---------------------------------------------------------------------------

def _handler_tree() -> ast.AST:
    return ast.parse(textwrap.dedent(inspect.getsource(start_session)))


def test_the_handler_never_calls_the_parser_directly():
    """`run_nlp(_lemmatize_many, words)` passes the function *by name*, so the
    only way a `_lemmatize_many(...)` call node appears in this handler is
    somebody calling it inline again. That would lint clean — Ruff's ASYNC
    rules only know *known* blocking APIs, not that an ordinary-looking call
    is spaCy — and would put the parse back on the event loop."""
    offenders = [
        node.lineno
        for node in ast.walk(_handler_tree())
        if isinstance(node, ast.Call)
        and (getattr(node.func, "id", None) or getattr(node.func, "attr", None))
        == "_lemmatize_many"
    ]

    assert not offenders, (
        f"_lemmatize_many is called directly at line(s) {offenders}. "
        "Await it through run_nlp (#144)."
    )


def test_the_handler_still_offloads_the_lemmatization():
    """The mirror of the test above: if the call disappeared entirely, that
    guard would pass for the wrong reason."""
    assert inspect.getsource(start_session).count("run_nlp(_lemmatize_many") == 2, (
        "expected exactly two offloaded batches — the due rows and the padded "
        "forms. More means a loop crept back in; fewer means one of the two "
        "passes stopped lemmatizing."
    )


def test_no_lemmatization_hop_sits_inside_a_loop():
    """`tests/test_offload.py` enforces this repo-wide; asserted here too
    because this handler is the concrete case #144 was filed about."""
    offenders = [
        inner.lineno
        for node in ast.walk(_handler_tree())
        if isinstance(node, (ast.For, ast.AsyncFor, ast.While))
        for inner in ast.walk(node)
        if isinstance(inner, ast.Call) and getattr(inner.func, "id", None) == "run_nlp"
    ]

    assert not offenders, (
        f"run_nlp called inside a loop at {offenders}: N hops cost N executor "
        "round-trips on a single-threaded pool (#147)."
    )
