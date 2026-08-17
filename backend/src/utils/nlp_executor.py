"""
Dedicated worker thread for CPU-bound NLP (spaCy) work.

spaCy dependency parsing is Cython that only releases the GIL intermittently,
so calling it straight from an `async def` handler pins the event loop and
stalls *every* other in-flight request. Measured in production (issue #117):
one `/movies/{id}/vocabulary/preview` request pushed `/health` — an endpoint
that returns a hardcoded dict — from 0.16s to 7.86s. The API runs as a single
uvicorn process with a single replica on purpose (each process holds ~1 GB of
ML models, see docker/Dockerfile.backend), so there is no second worker to
absorb the stall.

Anything routed through `run_nlp` runs on a worker thread instead, leaving the
event loop free to answer unrelated requests while the parse is in flight.

Why `max_workers=1`:
- The spaCy `Language` object is a process-wide singleton whose tokenizer keeps
  a mutable cache; serializing parses avoids sharing it across threads.
- The box is deliberately single-process, so N concurrent parses would just
  thrash one CPU. Queuing is not a regression here — before this, concurrent
  parses were serialized *and* took the whole event loop down with them.

This does not make script analysis fast. It stops script analysis making
everything else slow. Precomputing at ingestion is the real fix (issue #106).
"""
from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from typing import Any, Callable, TypeVar

T = TypeVar("T")

# Module-level singleton: one thread for the whole process, created eagerly so
# every caller shares the same queue.
_nlp_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="nlp")


async def run_nlp(fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    """
    Await a synchronous, CPU-bound NLP call on the shared NLP worker thread.

    Use this for anything that touches spaCy from inside an `async def`
    handler. Exceptions propagate to the caller exactly as if the function had
    been called directly.
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_nlp_executor, partial(fn, *args, **kwargs))
