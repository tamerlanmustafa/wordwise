"""
Tests for the NLP worker thread (issue #117).

spaCy parsing used to run synchronously inside `async def` handlers. Since the
API is one uvicorn process with one replica by design, that CPU work pinned the
event loop for *every* concurrent request: in production a single
`/movies/{id}/vocabulary/preview` pushed `/health` from 0.16s to 7.86s — a 48x
degradation reachable without authentication.

What matters and is asserted here:
1. `run_nlp` executes off the event loop thread.
2. The event loop keeps serving while a parse is in flight — the actual
   regression guard for the DoS.
3. Parses are serialized (max_workers=1), so a burst can't spawn N CPU-bound
   spaCy parses or race the shared Language singleton.
4. Return values, kwargs and exceptions all behave as a direct call would.
5. `get_nlp` loads the model once even when several threads race for it.
6. No route module calls the synchronous spaCy entry points any more — a
   static guard so a future handler can't quietly reintroduce the stall.

spaCy itself is never imported: it isn't installed in CI, and none of these
behaviors need a real model.
"""
from __future__ import annotations

import ast
import asyncio
import sys
import threading
import time
import types
from pathlib import Path

import pytest

from src.utils.nlp_executor import run_nlp


# ---------------------------------------------------------------------------
# 1-4. run_nlp offloads, keeps the loop free, and serializes
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_runs_off_the_event_loop_thread():
    main_thread = threading.current_thread().ident

    worker_thread = await run_nlp(lambda: threading.current_thread().ident)

    assert worker_thread != main_thread


@pytest.mark.asyncio
async def test_event_loop_keeps_serving_during_a_parse():
    """The regression guard for #117: an unrelated coroutine must make progress
    while a blocking, GIL-holding call is in flight."""
    ticks = 0

    async def unrelated_request():
        nonlocal ticks
        while True:
            ticks += 1
            await asyncio.sleep(0.005)

    ticker = asyncio.create_task(unrelated_request())
    try:
        # time.sleep stands in for spaCy: blocking, and not awaitable.
        await run_nlp(time.sleep, 0.2)
    finally:
        ticker.cancel()

    # Before the fix this was 0 — the loop never got a chance to run.
    assert ticks > 1


@pytest.mark.asyncio
async def test_parses_are_serialized_not_run_in_parallel():
    concurrent = 0
    peak = 0
    lock = threading.Lock()

    def slow_parse():
        nonlocal concurrent, peak
        with lock:
            concurrent += 1
            peak = max(peak, concurrent)
        time.sleep(0.05)
        with lock:
            concurrent -= 1

    await asyncio.gather(*(run_nlp(slow_parse) for _ in range(4)))

    assert peak == 1


@pytest.mark.asyncio
async def test_passes_through_args_kwargs_and_return_value():
    def detect(text, *, level="B1"):
        return [(text.lower(), "idiom", level)]

    assert await run_nlp(detect, "Break A Leg", level="C1") == [
        ("break a leg", "idiom", "C1")
    ]


@pytest.mark.asyncio
async def test_exceptions_propagate_to_the_caller():
    def boom():
        raise ValueError("model missing")

    with pytest.raises(ValueError, match="model missing"):
        await run_nlp(boom)


@pytest.mark.asyncio
async def test_a_failed_parse_does_not_poison_the_worker():
    def boom():
        raise RuntimeError("bad parse")

    with pytest.raises(RuntimeError):
        await run_nlp(boom)

    assert await run_nlp(lambda: "still alive") == "still alive"


# ---------------------------------------------------------------------------
# 5. The spaCy singleton survives being reached from a worker thread
# ---------------------------------------------------------------------------

def test_get_nlp_loads_the_model_only_once_under_concurrency(monkeypatch):
    """Now that parses run off-thread, several threads can reach the lazy
    loader at once; the ~1 GB model must still be built exactly once.

    The real `get_nlp` is exercised — only the `import spacy` it does is
    swapped, since spacy isn't installed in CI.
    """
    from src.services import lemmatization_service as svc

    loads = 0
    load_lock = threading.Lock()

    class _FakeModel:
        pass

    def fake_spacy_load(name, disable=None):
        nonlocal loads
        time.sleep(0.02)  # widen the race window
        with load_lock:
            loads += 1
        return _FakeModel()

    fake_spacy = types.ModuleType("spacy")
    fake_spacy.load = fake_spacy_load
    monkeypatch.setitem(sys.modules, "spacy", fake_spacy)
    monkeypatch.setattr(svc, "_nlp", None)

    results: list[object] = []
    threads = [
        threading.Thread(target=lambda: results.append(svc.get_nlp()))
        for _ in range(8)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert loads == 1, f"model loaded {loads} times — the lazy load is racy"
    assert len(results) == 8
    assert len({id(r) for r in results}) == 1  # everyone got the same singleton


# ---------------------------------------------------------------------------
# 6. No route calls the synchronous spaCy entry points
# ---------------------------------------------------------------------------

# Sync names that reach spaCy. `compute_difficulty_advanced` fans out to the
# syntactic/semantic/discourse analyzers, each of which parses the full script.
BLOCKING_NLP_CALLS = {
    "detect_phrasal_verbs_and_idioms",
    "lemmatize_script",
}

ROUTES_DIR = Path(__file__).resolve().parents[1] / "src" / "routes"


def _called_names(tree: ast.AST) -> set[str]:
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            fn = node.func
            if isinstance(fn, ast.Name):
                names.add(fn.id)
            elif isinstance(fn, ast.Attribute):
                names.add(fn.attr)
    return names


@pytest.mark.parametrize("route_file", sorted(ROUTES_DIR.glob("*.py")), ids=lambda p: p.name)
def test_routes_never_call_spacy_synchronously(route_file):
    tree = ast.parse(route_file.read_text())
    offenders = _called_names(tree) & BLOCKING_NLP_CALLS

    assert not offenders, (
        f"{route_file.name} calls {sorted(offenders)} directly. spaCy work in an "
        "async handler blocks the whole event loop (#117) — await the *_async "
        "wrapper instead."
    )


def test_compute_difficulty_is_offloaded_wherever_a_script_is_passed():
    """`compute_difficulty_advanced` only touches spaCy when `text=` is given
    (signals 13-17), so the sync version is fine for the text-free callers."""
    for route_file in sorted(ROUTES_DIR.glob("*.py")):
        tree = ast.parse(route_file.read_text())
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            name = getattr(node.func, "id", None) or getattr(node.func, "attr", None)
            if name != "compute_difficulty_advanced":
                continue
            passes_text = any(kw.arg == "text" for kw in node.keywords)
            assert not passes_text, (
                f"{route_file.name}:{node.lineno} passes text= to the sync "
                "compute_difficulty_advanced, which runs three full spaCy "
                "parses on the event loop (#117). Await "
                "compute_difficulty_advanced_async instead."
            )


def test_async_wrappers_are_coroutines():
    from src.services.cefr_classifier import detect_phrasal_verbs_and_idioms_async
    from src.services.difficulty_scorer import compute_difficulty_advanced_async
    from src.services.lemmatization_service import lemmatize_script_async

    for fn in (
        detect_phrasal_verbs_and_idioms_async,
        compute_difficulty_advanced_async,
        lemmatize_script_async,
    ):
        assert asyncio.iscoroutinefunction(fn), f"{fn.__name__} must be awaitable"


# ---------------------------------------------------------------------------
# 7. Queue cap — bounding the resource without needing to know the caller
# ---------------------------------------------------------------------------
#
# The per-caller throttle on /vocabulary/preview only bites when the caller can
# be identified, which behind the platform edge proxy is unreliable for
# anonymous traffic. The cap below needs no notion of who is calling: it
# bounds the one scarce thing, the single NLP worker.

def test_slot_admits_up_to_the_cap():
    from src.utils.nlp_executor import nlp_queue_depth, nlp_slot

    assert nlp_queue_depth() == 0
    with nlp_slot(2):
        assert nlp_queue_depth() == 1
        with nlp_slot(2):
            assert nlp_queue_depth() == 2
    assert nlp_queue_depth() == 0


def test_slot_sheds_past_the_cap():
    from src.utils.nlp_executor import NLPOverloaded, nlp_slot

    with nlp_slot(1):
        with pytest.raises(NLPOverloaded):
            with nlp_slot(1):
                pass


def test_slot_is_released_even_when_the_parse_raises():
    from src.utils.nlp_executor import nlp_queue_depth, nlp_slot

    with pytest.raises(ValueError):
        with nlp_slot(1):
            raise ValueError("parse blew up")

    assert nlp_queue_depth() == 0
    # The freed slot is immediately reusable.
    with nlp_slot(1):
        assert nlp_queue_depth() == 1


@pytest.mark.asyncio
async def test_cap_sheds_a_burst_instead_of_queueing_it():
    """The behaviour that matters: with a cap of 2, a burst of 6 gets 2 parses
    and 4 immediate rejections — rather than a sixth caller waiting out five
    parses ahead of it."""
    from src.utils.nlp_executor import NLPOverloaded, nlp_slot, run_nlp

    admitted = 0
    shed = 0

    async def one_request():
        nonlocal admitted, shed
        try:
            with nlp_slot(2):
                await run_nlp(time.sleep, 0.05)
                admitted += 1
        except NLPOverloaded:
            shed += 1

    await asyncio.gather(*(one_request() for _ in range(6)))

    assert admitted == 2
    assert shed == 4


def test_preview_route_caps_the_queue_and_degrades():
    """The cap must be wired into the public endpoint, and a shed parse must
    return the word list without idioms rather than failing the request."""
    import inspect

    from src.routes import movies

    assert movies.MAX_PENDING_PREVIEW_PARSES > 0
    src = inspect.getsource(movies.get_vocabulary_preview)
    assert "nlp_slot(MAX_PENDING_PREVIEW_PARSES)" in src
    assert "except NLPOverloaded" in src
    # Degrades rather than 503s: the DB-derived word list is still returned.
    assert "idioms_unavailable" in src
