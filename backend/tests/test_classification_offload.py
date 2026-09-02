"""
CEFR classification keeps spaCy off the event loop (endpoint audit, 2026-09-02).

`classify_text` is the heaviest synchronous call in the app: spaCy over a whole
document plus several regex passes, measured at 1.6–2.9s for a film script and
worse for an uploaded book. Five call sites ran it *inline* inside `async def`
handlers, so for the length of every classification the single-process API
served nobody — issue #117's failure mode, where one blocking call pushed
`/health` from 0.16s to 7.86s, reintroduced on five paths that #117 never
touched:

    POST /api/cefr/classify-script      any authenticated user
    POST /api/upload/file               any authenticated user, 10MB document
    POST /api/books/analyze/{id}        any authenticated user, a whole book
    POST /admin/reprocess-script/{id}   admin
    POST /admin/reprocess-all-scripts   admin, every script in the database

`POST /api/upload/file` was the worst of them, because it blocked *twice*: the
document extraction and then the classification. Its `_extract_from_pdf` was
declared `async def` with no `await` anywhere in the body, which is the trap
worth naming — the keyword made the call site read as though it yielded while
pdfplumber parsed every page on the loop.

What is protected here:

1. Extraction and classification each run off the event loop, and the loop
   keeps serving while they do.
2. `_extract_from_pdf` stays synchronous, so nothing can call it and believe
   the `async` keyword bought concurrency.
3. The two kinds of work stay on their own pools — a queue of uploads must not
   be able to delay a login, which shares the CPU pool with extraction.
4. User-facing paths shed under load rather than queueing behind work the
   caller has given up on; admin reprocessing does not shed, because a batch
   that aborts halfway is worse than one that waits.

spaCy is not installed in the CI test env, so the classifier is faked. These
tests are about *where* the work runs, not about classification quality.
"""
from __future__ import annotations

import asyncio
import inspect
import threading
import time

import pytest

from src.routes import upload as upload_route
from src.utils.offload import (
    CPU_POOL_SIZE,
    CPUOverloaded,
    NLPOverloaded,
    cpu_slot,
    nlp_slot,
    run_cpu,
    run_nlp,
)


# ---------------------------------------------------------------------------
# 1. The work leaves the event loop
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_extraction_runs_off_the_event_loop():
    """`_extract_text` must hand the extractor to a worker thread."""
    main_thread = threading.current_thread().name
    seen: dict[str, str] = {}

    def fake_txt(content: bytes, filename: str) -> dict:
        seen["thread"] = threading.current_thread().name
        return {"raw_text": "x", "cleaned_text": "x", "word_count": 1, "metadata": {}}

    original = upload_route._extract_from_txt
    upload_route._extract_from_txt = fake_txt
    try:
        await upload_route._extract_text(b"hello", ".txt", "a.txt")
    finally:
        upload_route._extract_from_txt = original

    assert seen["thread"] != main_thread
    assert seen["thread"].startswith("cpu"), (
        f"extraction ran on {seen['thread']}; it belongs on the CPU pool, not "
        "the NLP thread that whole-script parses queue on"
    )


@pytest.mark.asyncio
async def test_event_loop_keeps_serving_during_a_classification():
    """The #117 regression guard, for the classification paths.

    A 200ms blocking classification must not stop an unrelated request from
    making progress — inline, `ticks` stays at 1.
    """
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

    assert ticks > 1, "the event loop was pinned for the whole classification"


# ---------------------------------------------------------------------------
# 2. The `async def` that wasn't
# ---------------------------------------------------------------------------

def test_pdf_extractor_is_not_a_coroutine_function():
    """`_extract_from_pdf` must stay a plain function.

    It was `async def` with no `await` in the body: every caller read as if it
    yielded to the loop, and none of them did. Declaring it sync is what makes
    the blocking visible at the call site, so `_extract_text` has to decide
    where to run it.
    """
    assert not inspect.iscoroutinefunction(upload_route._extract_from_pdf)


def test_every_extractor_is_synchronous():
    """All four extractors are sync, so `_extract_text` is the only place that
    decides which pool they run on."""
    for name in (
        "_extract_from_pdf",
        "_extract_from_epub",
        "_extract_from_txt",
        "_extract_from_subtitle",
    ):
        fn = getattr(upload_route, name)
        assert not inspect.iscoroutinefunction(fn), f"{name} should not be async"


# ---------------------------------------------------------------------------
# 3. The pools stay separate
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_a_saturated_cpu_pool_still_lets_a_classification_through():
    """Uploads must not be able to starve classification, or vice versa.

    Extraction is on the CPU pool with bcrypt; classification is on the NLP
    thread. If a burst of uploads could block classification, the two caps
    would be one cap.
    """
    release = threading.Event()
    hogs = [asyncio.create_task(run_cpu(release.wait)) for _ in range(CPU_POOL_SIZE)]
    await asyncio.sleep(0.05)  # let them claim every CPU thread

    try:
        started = time.perf_counter()
        await run_nlp(lambda: "classified")
        elapsed = time.perf_counter() - started
        assert elapsed < 0.15, (
            "a classification queued behind a full CPU pool — the pools are "
            "sharing threads"
        )
    finally:
        release.set()
        await asyncio.gather(*hogs)


# ---------------------------------------------------------------------------
# 4. Backpressure: shed where a caller is waiting, queue where a batch is
# ---------------------------------------------------------------------------

def test_upload_caps_are_lower_than_the_shared_cpu_default():
    """A burst of uploads must not be able to fill the pool that logins share.

    `DEFAULT_CPU_MAX_PENDING` is sized for ~173ms hashes; a PDF extraction is
    seconds, so the upload path takes a deliberately smaller share.
    """
    from src.utils.offload import DEFAULT_CPU_MAX_PENDING

    assert upload_route.MAX_PENDING_EXTRACTIONS < DEFAULT_CPU_MAX_PENDING
    assert upload_route.MAX_PENDING_EXTRACTIONS >= 1


def test_extraction_sheds_once_its_cap_is_reached():
    """Past the cap, `cpu_slot` refuses rather than growing a queue of
    multi-second document parses."""
    cap = upload_route.MAX_PENDING_EXTRACTIONS
    held = []
    try:
        for _ in range(cap):
            slot = cpu_slot(cap)
            slot.__enter__()
            held.append(slot)
        with pytest.raises(CPUOverloaded):
            with cpu_slot(cap):
                pass
    finally:
        for slot in reversed(held):
            slot.__exit__(None, None, None)


def test_classification_sheds_once_its_cap_is_reached():
    cap = upload_route.MAX_PENDING_CLASSIFICATIONS
    held = []
    try:
        for _ in range(cap):
            slot = nlp_slot(cap)
            slot.__enter__()
            held.append(slot)
        with pytest.raises(NLPOverloaded):
            with nlp_slot(cap):
                pass
    finally:
        for slot in reversed(held):
            slot.__exit__(None, None, None)


def test_admin_reprocessing_takes_no_slot():
    """Admin batches offload but must not shed.

    A user-facing classification that is shed costs one retry. A bulk reprocess
    that is shed aborts partway through the corpus, leaving half the scripts
    reclassified — so it queues behind live traffic instead.
    """
    import ast
    from pathlib import Path

    src = Path(__file__).resolve().parents[1] / "src" / "routes" / "admin.py"
    tree = ast.parse(src.read_text())
    slots = [
        node.func.id
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id in {"nlp_slot", "cpu_slot"}
    ]
    assert not slots, (
        "admin reprocessing acquired a queue slot; a shed mid-batch leaves the "
        "corpus half-reclassified"
    )
