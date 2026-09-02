"""
Word pronunciation: synthesis off the event loop, cached, and the route's
failure modes.

The endpoint had never produced a sound in production — the client sent no
bearer token (#163) and, behind that, `gtts` was in no requirements file, so
the deployed image answered `501` to everything that got past auth (prod log,
2026-09-01: `GET /premium/pronounce/gasoline → 501`).

`gtts` is a production dependency and requirements-dev.txt is a deliberate
SUBSET, so it is NOT installed under pytest. Every test here therefore stubs
the module — which is also the honest way to test this, since the real thing
is a network call to Google.
"""
from __future__ import annotations

import asyncio
import sys
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from src.routes import premium as premium_routes
from src.services import tts_service
from src.services.tts_service import (
    MAX_WORD_LEN,
    MAX_PENDING_SYNTHESES,
    TTSUnavailable,
    cache_key,
    peek_cached,
    reset_cache,
    synthesize,
)
from src.utils.offload import CPUOverloaded, cpu_queue_depth


@pytest.fixture(autouse=True)
def _clean_cache():
    # The cache is module-level, so one test's clip would otherwise satisfy
    # the next test's miss.
    reset_cache()
    yield
    reset_cache()


class _FakeGTTS:
    """Stands in for `gtts.gTTS`. Records every synthesis and writes bytes
    that identify the word, so a cache hit is distinguishable from a re-fetch."""

    calls: list = []
    fail_with: BaseException | None = None
    payload_for = staticmethod(lambda text: f"MP3<{text}>".encode())

    def __init__(self, *, text, lang, slow):
        type(self).calls.append((text, lang, slow))
        if type(self).fail_with is not None:
            raise type(self).fail_with
        self._text = text

    def write_to_fp(self, fp):
        fp.write(type(self).payload_for(self._text))


@pytest.fixture
def gtts(monkeypatch):
    """Install a fake `gtts` module for the duration of one test."""
    _FakeGTTS.calls = []
    _FakeGTTS.fail_with = None
    monkeypatch.setitem(sys.modules, "gtts", SimpleNamespace(gTTS=_FakeGTTS))
    return _FakeGTTS


@pytest.fixture
def no_gtts(monkeypatch):
    """Simulate the image that shipped for months: no speech backend."""
    monkeypatch.setitem(sys.modules, "gtts", None)  # `from None import gTTS` raises
    return None


# ---------------------------------------------------------------------------
# 1. The bug that was actually in production
# ---------------------------------------------------------------------------

async def test_a_missing_speech_backend_raises_tts_unavailable(no_gtts):
    # Distinct from a synthesis failure: no retry fixes a missing dependency,
    # and the route turns this one into a 501 rather than a 500.
    with pytest.raises(TTSUnavailable):
        await synthesize("gasoline")


async def test_the_route_answers_501_when_there_is_no_backend(no_gtts):
    with pytest.raises(HTTPException) as exc:
        await premium_routes.pronounce_word(
            word="gasoline", current_user=_premium_user(), db=None,
        )
    assert exc.value.status_code == 501


async def test_a_word_now_synthesizes_end_to_end(gtts):
    audio = await synthesize("gasoline")

    assert audio == b"MP3<gasoline>"
    assert gtts.calls == [("gasoline", "en", False)]


# ---------------------------------------------------------------------------
# 2. Never on the event loop
# ---------------------------------------------------------------------------

async def test_synthesis_runs_off_the_event_loop(gtts, monkeypatch):
    """The whole reason this module exists. gTTS makes a SYNCHRONOUS HTTP
    round trip; called inline it pins the single process's only loop and every
    concurrent request waits on it (#117, measured at 7.86s for /health)."""
    seen: list = []
    real_run_cpu = tts_service.run_cpu

    async def watching_run_cpu(fn, *args, **kwargs):
        seen.append(fn)
        return await real_run_cpu(fn, *args, **kwargs)

    monkeypatch.setattr(tts_service, "run_cpu", watching_run_cpu)

    await synthesize("gasoline")

    assert seen == [tts_service._synthesize_blocking], "must go through run_cpu"


async def test_the_loop_keeps_serving_while_a_word_synthesizes(gtts, monkeypatch):
    """Behavioural counterpart to the test above: a slow synthesis must not
    stop another coroutine from making progress."""
    started = asyncio.Event()
    release = asyncio.Event()
    loop = asyncio.get_running_loop()

    def slow_synthesis(word, lang):
        loop.call_soon_threadsafe(started.set)
        # Block the WORKER thread, not the loop.
        asyncio.run_coroutine_threadsafe(_wait(release), loop).result(timeout=5)
        return b"MP3<slow>"

    async def _wait(ev):
        await ev.wait()

    monkeypatch.setattr(tts_service, "_synthesize_blocking", slow_synthesis)

    task = asyncio.create_task(synthesize("slow"))
    await asyncio.wait_for(started.wait(), timeout=5)

    # The loop is alive: this coroutine runs while the synthesis is in flight.
    ticks = 0
    for _ in range(3):
        await asyncio.sleep(0)
        ticks += 1
    assert ticks == 3

    release.set()
    assert await asyncio.wait_for(task, timeout=5) == b"MP3<slow>"


async def test_a_burst_is_shed_rather_than_queued(gtts, monkeypatch):
    """Past the slot cap the caller is refused immediately. A blocking network
    call holds its pool thread for a whole round trip, and that pool also
    hashes passwords — an unbounded burst of taps would delay logins."""
    def always_full(_max_pending=None):
        raise CPUOverloaded("CPU queue at capacity")

    monkeypatch.setattr(tts_service, "cpu_slot", always_full)

    with pytest.raises(CPUOverloaded):
        await synthesize("gasoline")
    assert gtts.calls == [], "shed before occupying a thread"


async def test_the_route_turns_a_shed_call_into_503(gtts, monkeypatch):
    def always_full(_max_pending=None):
        raise CPUOverloaded("CPU queue at capacity")

    monkeypatch.setattr(tts_service, "cpu_slot", always_full)

    with pytest.raises(HTTPException) as exc:
        await premium_routes.pronounce_word(
            word="gasoline", current_user=_premium_user(), db=None,
        )
    assert exc.value.status_code == 503
    assert exc.value.headers == {"Retry-After": "1"}


async def test_the_slot_is_released_when_synthesis_fails(gtts):
    gtts.fail_with = RuntimeError("google said no")
    depth_before = cpu_queue_depth()

    with pytest.raises(RuntimeError):
        await synthesize("gasoline")

    assert cpu_queue_depth() == depth_before, "a failure must not leak a slot"


# ---------------------------------------------------------------------------
# 3. Caching — and the trap the old code would have hit
# ---------------------------------------------------------------------------

async def test_a_second_request_is_served_from_cache(gtts):
    first = await synthesize("gasoline")
    second = await synthesize("gasoline")

    assert first == second
    assert len(gtts.calls) == 1, "a word's audio never changes"


async def test_the_cache_ignores_capitalisation(gtts):
    await synthesize("Gasoline")
    await synthesize("gasoline")

    assert len(gtts.calls) == 1
    assert cache_key("Gasoline") == cache_key("gasoline ")


async def test_concurrent_taps_on_one_word_synthesize_once(gtts, monkeypatch):
    """Single-flight. A double tap, or a scene where the same word is on two
    cards, must not buy two Google round trips."""
    gate = asyncio.Event()
    loop = asyncio.get_running_loop()
    calls: list = []

    def slow(word, lang):
        calls.append(word)
        asyncio.run_coroutine_threadsafe(gate.wait(), loop).result(timeout=5)
        return b"MP3<gasoline>"

    monkeypatch.setattr(tts_service, "_synthesize_blocking", slow)

    tasks = [asyncio.create_task(synthesize("gasoline")) for _ in range(5)]
    await asyncio.sleep(0.05)
    gate.set()
    results = await asyncio.wait_for(asyncio.gather(*tasks), timeout=5)

    assert results == [b"MP3<gasoline>"] * 5
    assert len(calls) == 1


async def test_a_failed_synthesis_is_not_cached(gtts):
    gtts.fail_with = RuntimeError("google said no")
    with pytest.raises(RuntimeError):
        await synthesize("gasoline")

    assert peek_cached("gasoline") is None
    gtts.fail_with = None
    assert await synthesize("gasoline") == b"MP3<gasoline>"


async def test_empty_audio_is_not_cached(gtts, monkeypatch):
    monkeypatch.setattr(tts_service, "_synthesize_blocking", lambda w, l: b"")

    with pytest.raises(RuntimeError):
        await synthesize("gasoline")
    assert peek_cached("gasoline") is None


async def test_the_cache_holds_bytes_so_every_response_has_a_body(gtts):
    """The trap: a `BytesIO` is CONSUMED by the response that sends it, so
    caching the buffer would give every request after the first an empty body
    — which looks exactly like the silent failure this endpoint already had."""
    user = _premium_user()

    first: StreamingResponse = await premium_routes.pronounce_word(
        word="gasoline", current_user=user, db=None,
    )
    second: StreamingResponse = await premium_routes.pronounce_word(
        word="gasoline", current_user=user, db=None,
    )

    assert await _body(first) == b"MP3<gasoline>"
    assert await _body(second) == b"MP3<gasoline>", "second response was empty"
    assert isinstance(peek_cached("gasoline"), bytes)


# ---------------------------------------------------------------------------
# 4. Input handling
# ---------------------------------------------------------------------------

async def test_a_long_word_is_clamped(gtts):
    await synthesize("x" * (MAX_WORD_LEN + 40))
    text, _lang, _slow = gtts.calls[0]
    assert len(text) == MAX_WORD_LEN


async def test_an_empty_word_never_reaches_the_synthesizer(gtts):
    with pytest.raises(ValueError):
        await synthesize("   ")
    assert gtts.calls == []


async def test_the_route_rejects_an_empty_word_with_400(gtts):
    with pytest.raises(HTTPException) as exc:
        await premium_routes.pronounce_word(
            word="   ", current_user=_premium_user(), db=None,
        )
    assert exc.value.status_code == 400


async def test_a_free_user_is_paywalled_before_any_synthesis(gtts):
    free = SimpleNamespace(id=1, isAdmin=False)

    with pytest.raises(HTTPException) as exc:
        await premium_routes.pronounce_word(word="gasoline", current_user=free, db=None)

    assert exc.value.status_code == 402
    assert gtts.calls == [], "the paywall must come before the spend"


def test_the_pending_cap_is_well_below_the_shared_default():
    # This work holds a pool thread across a network round trip, unlike the
    # bcrypt hashing the same pool serves. See DEFAULT_CPU_MAX_PENDING.
    from src.utils.offload import DEFAULT_CPU_MAX_PENDING

    assert 0 < MAX_PENDING_SYNTHESES < DEFAULT_CPU_MAX_PENDING


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _premium_user():
    # Admin ⇒ premium, so these tests are about the audio path and nothing else.
    return SimpleNamespace(id=1, isAdmin=True)


async def _body(response: StreamingResponse) -> bytes:
    chunks = []
    async for chunk in response.body_iterator:
        chunks.append(chunk if isinstance(chunk, bytes) else chunk.encode())
    return b"".join(chunks)
