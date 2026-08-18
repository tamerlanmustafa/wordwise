"""
Compatibility shim — the NLP worker now lives in `utils/offload.py`.

spaCy was the first thing that needed to get off the event loop (issue #117),
so the worker thread was built here. Password hashing, document extraction and
heavy transforms need the same escape hatch but *not* the same pool
(issue #147), so both helpers moved to `offload.py`, which owns the one-thread
NLP pool and a separate multi-thread CPU pool.

Nothing new should import from this module: `from ..utils.offload import
run_nlp`. These re-exports keep the existing call sites working, and they are
the same objects — the queue counters are not duplicated by importing them
from here.
"""
from __future__ import annotations

from .offload import (  # noqa: F401  (re-exported for existing call sites)
    NLPOverloaded,
    nlp_queue_depth,
    nlp_slot,
    run_nlp,
)

__all__ = ["NLPOverloaded", "nlp_queue_depth", "nlp_slot", "run_nlp"]
