"""
The one place blocking work goes when it must not stall the event loop.

The API runs as a single uvicorn process with a single replica on purpose
(each process holds ~1 GB of ML models, see docker/Dockerfile.backend). That
makes any synchronous, CPU-bound call inside an `async def` handler a
whole-service outage in miniature: it pins the only event loop, so *every*
concurrent request waits, not just the caller's. Measured in production
(issue #117), one `/movies/{id}/vocabulary/preview` pushed `/health` — an
endpoint that returns a hardcoded dict — from 0.16s to 7.86s.

The rule: if it isn't `await`ed I/O and could exceed ~10ms, it goes through a
helper here rather than being called inline.

Two pools, and the separation is the point
------------------------------------------
| helper    | pool             | for                                          |
|-----------|------------------|----------------------------------------------|
| `run_nlp` | `max_workers=1`  | spaCy, and only spaCy                        |
| `run_cpu` | `max_workers=N`  | bcrypt, PDF/EPUB extraction, heavy transforms|

`run_nlp` stays at one worker because the spaCy `Language` object is a
process-wide singleton whose tokenizer keeps a mutable cache, and because N
concurrent parses on a deliberately single-process box would just thrash one
CPU. Queuing is not a regression there: a script parse takes seconds, and the
callers of it are already slow endpoints.

Everything else needs the opposite property. Password hashing is ~173ms
(issue #141); if it shared the NLP thread, a login landing behind a 9.5s
script parse (issue #140) would turn a 173ms stall into a ~10s wait. Two kinds
of work that look alike — both "CPU-bound, can't be awaited" — with opposite
concurrency requirements. Do not merge the pools.

Batch first, then offload once
------------------------------
One hop per batch, never per item. A per-item loop through an executor is
worse than blocking: each `run_in_executor` round-trip carries scheduling
overhead, and N items means N queue entries competing with every other caller.
Collect the work, hand it over in a single call, unpack the result:

    # wrong: N hops, N queue entries
    for word in words:
        doc = await run_nlp(nlp, word)

    # right: one hop
    docs = await run_nlp(lambda: list(nlp.pipe(words)))

`tests/test_offload.py` enforces this statically for new call sites.

Backpressure
------------
Both pools are bounded by `nlp_slot` / `cpu_slot`, which shed work at the door
instead of letting a queue grow past the point where anyone waiting in it
would still care about the answer. Rate limiting by client identity can't
protect these queues on a platform where the caller's address isn't reliably
visible (see `rate_limit._client_ip`); bounding the scarce resource itself
needs no notion of who is calling.
"""
from __future__ import annotations

import asyncio
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import AbstractContextManager, contextmanager
from functools import partial
from typing import Any, Callable, Iterator, TypeVar

T = TypeVar("T")


def _cpu_pool_size() -> int:
    """Threads for the general CPU pool.

    Capped deliberately rather than trusting `os.cpu_count()`: inside a
    cgroup-limited container that reports the *host's* cores, which on a
    managed platform can be an order of magnitude more than this service is
    actually scheduled for. Oversizing a pool of CPU-bound threads doesn't add
    throughput, it just adds context switching and memory to a process that is
    already carrying ~1 GB of models.
    """
    return min(4, max(2, os.cpu_count() or 2))


CPU_POOL_SIZE = _cpu_pool_size()

# Module-level singletons, created eagerly so every caller shares one queue.
# ThreadPoolExecutor spawns its threads lazily on first submit, so this costs
# nothing at import time.
_nlp_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="nlp")
_cpu_executor = ThreadPoolExecutor(
    max_workers=CPU_POOL_SIZE, thread_name_prefix="cpu"
)


class Overloaded(RuntimeError):
    """A worker pool is at capacity — shed this call rather than queue it."""


class NLPOverloaded(Overloaded):
    """The NLP worker queue is already at capacity — shed this parse."""


class CPUOverloaded(Overloaded):
    """The CPU worker queue is already at capacity — shed this call."""


class _QueueGate:
    """Admission control for one pool: a counter, a cap, and a way to say no.

    Shared by both pools so the two bounds stay one implementation, but each
    pool gets its own instance — the counters must not be pooled any more than
    the threads are.
    """

    def __init__(self, overloaded: type[Overloaded], label: str) -> None:
        self._overloaded = overloaded
        self._label = label
        self._pending = 0
        self._lock = threading.Lock()

    @contextmanager
    def slot(self, max_pending: int) -> Iterator[None]:
        with self._lock:
            if self._pending >= max_pending:
                raise self._overloaded(
                    f"{self._label} queue at capacity "
                    f"({self._pending}/{max_pending})"
                )
            self._pending += 1
        try:
            yield
        finally:
            with self._lock:
                self._pending -= 1

    def depth(self) -> int:
        with self._lock:
            return self._pending


_nlp_gate = _QueueGate(NLPOverloaded, "NLP")
_cpu_gate = _QueueGate(CPUOverloaded, "CPU")

# One worker means the queue is the only thing that grows under load, and it
# grows at ~12s per entry — so the NLP cap is small and every caller passes the
# value that suits its endpoint.
#
# The CPU pool drains N-wide and its jobs are sub-second, so its default cap is
# sized to the pool rather than copied from the NLP one: enough depth to ride
# out a burst without making the last caller in line wait through several
# rounds of hashing.
DEFAULT_CPU_MAX_PENDING = CPU_POOL_SIZE * 8


def nlp_slot(max_pending: int) -> AbstractContextManager[None]:
    """Reserve a place in the NLP worker queue, or raise `NLPOverloaded`.

    Past `max_pending`, callers are shed immediately rather than joining a
    queue that already guarantees them a minute-long wait.
    """
    return _nlp_gate.slot(max_pending)


def nlp_queue_depth() -> int:
    """Parses currently queued or running. Exposed for tests and diagnostics."""
    return _nlp_gate.depth()


def cpu_slot(max_pending: int | None = None) -> AbstractContextManager[None]:
    """Reserve a place in the CPU worker queue, or raise `CPUOverloaded`.

    Defaults to `DEFAULT_CPU_MAX_PENDING`. Pass a smaller number for work that
    is expensive enough that a queue of it is itself the problem (a burst of
    PDF extractions), and remember the cap is shared by everything on this
    pool — an unauthenticated path that can fill it also delays logins.
    """
    return _cpu_gate.slot(
        DEFAULT_CPU_MAX_PENDING if max_pending is None else max_pending
    )


def cpu_queue_depth() -> int:
    """CPU jobs currently queued or running. For tests and diagnostics."""
    return _cpu_gate.depth()


async def run_nlp(fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    """
    Await a synchronous, CPU-bound NLP call on the shared NLP worker thread.

    Use this for anything that touches spaCy from inside an `async def`
    handler. Exceptions propagate to the caller exactly as if the function had
    been called directly.

    Batch before you offload — see the module docstring.
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_nlp_executor, partial(fn, *args, **kwargs))


async def run_cpu(fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    """
    Await any other synchronous, CPU-bound call on the general worker pool.

    For password hashing, document extraction, and heavy pure-Python
    transforms — anything that isn't spaCy. Exceptions propagate to the caller
    exactly as if the function had been called directly.

    Batch before you offload — see the module docstring.
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_cpu_executor, partial(fn, *args, **kwargs))
