"""
Tests for the two offload pools (issue #147).

`run_nlp` gave spaCy a way off the event loop (issue #117). Password hashing,
document extraction and heavy transforms need the same escape hatch, but not
the same pool — so `utils/offload.py` now owns both, and the separation is the
thing worth protecting.

What matters and is asserted here:
1. `run_cpu` executes off the event loop thread and keeps the loop serving.
2. `run_cpu` runs work in parallel, unlike the deliberately serialized NLP pool.
3. The pools are independent: a 173ms login must not queue behind a multi-second
   script parse. This is the reason there are two pools rather than one.
4. `cpu_slot` bounds the CPU pool with its own counter, sized to the pool and
   independent of the NLP cap.
5. Args, kwargs and exceptions behave as a direct call would, and a failure
   doesn't poison either pool.
6. `utils/nlp_executor` still re-exports the same objects, so the existing
   `run_nlp` call sites keep working and the counters aren't duplicated.
7. Nothing offloads per item inside a loop — a static guard, since that is the
   natural mistake to make with a helper like this.
"""
from __future__ import annotations

import ast
import asyncio
import threading
import time
from pathlib import Path

import pytest

from src.utils.offload import (
    CPU_POOL_SIZE,
    DEFAULT_CPU_MAX_PENDING,
    CPUOverloaded,
    NLPOverloaded,
    Overloaded,
    cpu_queue_depth,
    cpu_slot,
    nlp_queue_depth,
    nlp_slot,
    run_cpu,
    run_nlp,
)


# ---------------------------------------------------------------------------
# 1-2. run_cpu offloads, keeps the loop free, and runs in parallel
# ---------------------------------------------------------------------------

async def test_run_cpu_runs_off_the_event_loop_thread():
    main_thread = threading.current_thread().ident

    worker_thread = await run_cpu(lambda: threading.current_thread().ident)

    assert worker_thread != main_thread


async def test_event_loop_keeps_serving_during_cpu_work():
    """The same regression guard as #117, for the non-spaCy pool: an unrelated
    request must make progress while a blocking call is in flight."""
    ticks = 0

    async def unrelated_request():
        nonlocal ticks
        while True:
            ticks += 1
            await asyncio.sleep(0.005)

    ticker = asyncio.create_task(unrelated_request())
    try:
        # time.sleep stands in for bcrypt: blocking, and not awaitable.
        await run_cpu(time.sleep, 0.2)
    finally:
        ticker.cancel()

    assert ticks > 1


async def test_cpu_pool_is_wider_than_one_thread():
    """The NLP pool is serialized on purpose; this one must not be, or two
    simultaneous logins would still take 2x173ms."""
    assert CPU_POOL_SIZE >= 2

    concurrent = 0
    peak = 0
    lock = threading.Lock()

    def slow_hash():
        nonlocal concurrent, peak
        with lock:
            concurrent += 1
            peak = max(peak, concurrent)
        time.sleep(0.05)
        with lock:
            concurrent -= 1

    await asyncio.gather(*(run_cpu(slow_hash) for _ in range(CPU_POOL_SIZE)))

    assert peak > 1, "run_cpu serialized its work — it is sharing the NLP pool"


# ---------------------------------------------------------------------------
# 3. The pools are independent — the whole point of issue #147
# ---------------------------------------------------------------------------

async def test_cpu_work_does_not_queue_behind_a_long_nlp_parse():
    """A login (~173ms of bcrypt) landing behind a 9.5s script parse would be a
    ~10s wait if the two shared a worker. They must not."""
    parse = asyncio.create_task(run_nlp(time.sleep, 0.3))
    await asyncio.sleep(0.02)  # let the parse take the NLP thread

    started = time.perf_counter()
    await run_cpu(lambda: "hashed")
    elapsed = time.perf_counter() - started

    assert elapsed < 0.15, (
        f"CPU work waited {elapsed:.2f}s for an in-flight parse — the pools "
        "have been merged"
    )
    await parse


async def test_a_saturated_cpu_pool_does_not_delay_a_parse():
    """And the reverse: document extraction filling the CPU pool must not push
    spaCy work behind it."""
    busy = [asyncio.create_task(run_cpu(time.sleep, 0.3)) for _ in range(CPU_POOL_SIZE)]
    await asyncio.sleep(0.02)

    started = time.perf_counter()
    await run_nlp(lambda: "parsed")
    elapsed = time.perf_counter() - started

    assert elapsed < 0.15
    await asyncio.gather(*busy)


# ---------------------------------------------------------------------------
# 4. cpu_slot: its own bound, sized to its own pool
# ---------------------------------------------------------------------------

def test_cpu_cap_is_sized_to_the_pool_not_copied_from_nlp():
    assert DEFAULT_CPU_MAX_PENDING > CPU_POOL_SIZE


def test_cpu_slot_admits_up_to_the_cap_and_then_sheds():
    assert cpu_queue_depth() == 0
    with cpu_slot(2):
        assert cpu_queue_depth() == 1
        with cpu_slot(2):
            assert cpu_queue_depth() == 2
            with pytest.raises(CPUOverloaded):
                with cpu_slot(2):
                    pass
    assert cpu_queue_depth() == 0


def test_cpu_slot_defaults_to_the_pool_sized_cap():
    with cpu_slot():
        assert cpu_queue_depth() == 1
    assert cpu_queue_depth() == 0


def test_cpu_slot_is_released_even_when_the_work_raises():
    with pytest.raises(ValueError):
        with cpu_slot(1):
            raise ValueError("extraction blew up")

    assert cpu_queue_depth() == 0
    with cpu_slot(1):  # the freed slot is immediately reusable
        assert cpu_queue_depth() == 1


def test_the_two_queues_are_counted_separately():
    """A full NLP queue must not shed logins, and vice versa."""
    with nlp_slot(1):
        assert nlp_queue_depth() == 1
        assert cpu_queue_depth() == 0
        with cpu_slot(1):  # would raise if the counters were shared
            assert cpu_queue_depth() == 1
        with pytest.raises(NLPOverloaded):
            with nlp_slot(1):
                pass
    assert nlp_queue_depth() == 0


def test_both_overload_errors_can_be_caught_together():
    """Callers that don't care which pool shed them can catch the base class;
    `NLPOverloaded` stays a RuntimeError for the handlers that already exist."""
    assert issubclass(NLPOverloaded, Overloaded)
    assert issubclass(CPUOverloaded, Overloaded)
    assert issubclass(Overloaded, RuntimeError)


# ---------------------------------------------------------------------------
# 5. Call semantics match a direct call
# ---------------------------------------------------------------------------

async def test_passes_through_args_kwargs_and_return_value():
    def hash_password(raw, *, rounds=12):
        return f"{raw}:{rounds}"

    assert await run_cpu(hash_password, "hunter2", rounds=14) == "hunter2:14"


async def test_exceptions_propagate_and_do_not_poison_the_pool():
    def boom():
        raise ValueError("corrupt pdf")

    with pytest.raises(ValueError, match="corrupt pdf"):
        await run_cpu(boom)

    assert await run_cpu(lambda: "still alive") == "still alive"


# ---------------------------------------------------------------------------
# 6. The old import path still works
# ---------------------------------------------------------------------------

def test_nlp_executor_reexports_the_same_objects():
    """The shim exists so the existing `run_nlp` call sites didn't have to
    churn. If it ever became a *copy* rather than a re-export, there would be
    two worker threads and two queue counters."""
    from src.utils import nlp_executor, offload

    assert nlp_executor.run_nlp is offload.run_nlp
    assert nlp_executor.nlp_slot is offload.nlp_slot
    assert nlp_executor.nlp_queue_depth is offload.nlp_queue_depth
    assert nlp_executor.NLPOverloaded is offload.NLPOverloaded


# ---------------------------------------------------------------------------
# 7. Static guard: one hop per batch, never per item
# ---------------------------------------------------------------------------
#
# Each `run_in_executor` round-trip carries scheduling overhead and takes a
# queue entry, so offloading inside a loop is worse than blocking — issue #144
# is the concrete case (spaCy called once per word, in two separate loops).
#
# A loop that offloads *chunks* rather than items is legitimate. If you add
# one, name it here with the reason rather than deleting the test.
OFFLOAD_IN_LOOP_ALLOWED: set[str] = set()

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
OFFLOAD_HELPERS = {"run_nlp", "run_cpu"}


def _offloads_in_a_loop(tree: ast.AST) -> list[tuple[str, int]]:
    found = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.For, ast.AsyncFor, ast.While)):
            continue
        for inner in ast.walk(node):
            if not isinstance(inner, ast.Call):
                continue
            name = getattr(inner.func, "id", None) or getattr(inner.func, "attr", None)
            if name in OFFLOAD_HELPERS:
                found.append((name, inner.lineno))
    return found


@pytest.mark.parametrize(
    "src_file",
    sorted(p for p in SRC_DIR.rglob("*.py") if "__pycache__" not in p.parts),
    ids=lambda p: p.name,
)
def test_nothing_offloads_once_per_item(src_file):
    if src_file.name in OFFLOAD_IN_LOOP_ALLOWED:
        pytest.skip("documented chunked-batch offload")

    offenders = _offloads_in_a_loop(ast.parse(src_file.read_text()))

    assert not offenders, (
        f"{src_file.name} calls {offenders} inside a loop. Batch the work and "
        "offload once (#147): N hops cost N executor round-trips and N queue "
        "entries, which is worse than blocking."
    )
