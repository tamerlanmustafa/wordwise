"""
Subtitle fetching keeps subliminal off the event loop (issue #148).

`SUBTITLE_SRT` is where 4,255 of the 4,409 scripts in production came from, and
it is the *first* source `get_or_fetch_script` tries, so this is the hot half of
script ingestion — not a fallback. Every step of it blocks: `scan_video` touches
the filesystem, `download_best_subtitles` makes provider HTTP calls with its own
synchronous client, `save_subtitles` writes the .srt, and the result is read
back with `open`. Run inline in an `async def` on a single-process API, that
whole sequence stalls every concurrent request for as long as OpenSubtitles
takes to answer — issue #117's failure mode, where one slow call pushed
`/health` from 0.16s to 7.86s.

Ruff's ASYNC family only ever saw the two `open` calls at the end. The rest is
ordinary function calls it has no way to recognise, which is exactly why the
`ASYNC` gate in `ruff.toml` is documented as a backstop rather than coverage.

What is protected here:

1. The whole synchronous block runs on the CPU worker pool, and the event loop
   keeps serving while it does.
2. It sheds once the pool is busy, rather than pinning threads that logins
   share (a bcrypt hash is ~173ms; one of these is seconds).
3. **A shed is transient, not a miss.** This is the load-bearing one. Returning
   `None` from the subtitle source means "no provider had this movie", and if
   every other source also misses, the worker parks the film as permanently
   dead — the 2026-07 dead-jobs incident (#78). A full CPU pool must never be
   able to cause that.
4. The extraction didn't change what a successful fetch returns.

subliminal isn't installed in the CI test env, so it is faked. These tests are
about *where* the work runs and *how failures are classified*, not about
subtitle quality.
"""
from __future__ import annotations

import asyncio
import contextlib
import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from src.services.script_ingestion_service import (
    ScriptIngestionService,
    ScriptNotFoundError,
)
from src.utils.offload import CPUOverloaded, cpu_slot
from src.utils.subtitle_api_client import (
    MAX_PENDING_SUBTITLE_FETCHES,
    SubtitleAPIClient,
    SubtitleAPIError,
)

SRT = (
    "1\n00:00:01,000 --> 00:00:03,000\nThe captain aborted the mission.\n\n"
    "2\n00:00:04,000 --> 00:00:06,000\nNobody argued.\n"
)


# ---------------------------------------------------------------------------
# Fakes: enough of subliminal/babelfish for the blocking body to run through
# ---------------------------------------------------------------------------

class _FakeLanguage:
    """`download_best_subtitles` is handed a *set* of these, so it must hash."""

    def __init__(self, code: str):
        self.code = code

    def __hash__(self):
        return hash(self.code)

    def __eq__(self, other):
        return isinstance(other, _FakeLanguage) and other.code == self.code


class _FakeVideo:
    """Keyed by path — the real one is hashable and used as a dict key."""

    def __init__(self, name: str):
        self.name = name

    def __hash__(self):
        return hash(self.name)

    def __eq__(self, other):
        return isinstance(other, _FakeVideo) and other.name == self.name


def _install_fake_subliminal(
    monkeypatch,
    *,
    found: bool = True,
    content: str = SRT,
    before=None,
) -> list[int]:
    """Fake the library and report which thread the download ran on.

    `before` runs inside the download, standing in for network latency.
    """
    threads: list[int] = []

    def scan_video(path: str):
        return _FakeVideo(path)

    def download_best_subtitles(videos, languages, providers=None):
        threads.append(threading.current_thread().ident)
        if before is not None:
            before()
        if not found:
            return {}
        return {videos[0]: [SimpleNamespace(provider_name="opensubtitles")]}

    def save_subtitles(video, subtitles):
        Path(video.name).with_suffix(".srt").write_text(content, encoding="utf-8")

    subliminal = SimpleNamespace(
        scan_video=scan_video,
        download_best_subtitles=download_best_subtitles,
        save_subtitles=save_subtitles,
        region=SimpleNamespace(configure=lambda *a, **k: None),
    )
    monkeypatch.setitem(sys.modules, "subliminal", subliminal)
    monkeypatch.setitem(sys.modules, "babelfish", SimpleNamespace(Language=_FakeLanguage))
    return threads


@contextlib.contextmanager
def _cpu_pool_full():
    """Hold every slot a subtitle fetch is allowed to claim."""
    with contextlib.ExitStack() as stack:
        for _ in range(MAX_PENDING_SUBTITLE_FETCHES):
            stack.enter_context(cpu_slot(MAX_PENDING_SUBTITLE_FETCHES))
        yield


# ---------------------------------------------------------------------------
# 1. The blocking block runs off the event loop
# ---------------------------------------------------------------------------

async def test_download_runs_on_a_worker_thread(monkeypatch):
    threads = _install_fake_subliminal(monkeypatch)
    client = SubtitleAPIClient()

    result = await client.fetch_subtitle_subliminal("Arrival", 2016)

    assert result is not None
    assert threads and threads[0] != threading.current_thread().ident


async def test_event_loop_keeps_serving_during_a_download(monkeypatch):
    """The #148 regression guard, same shape as #143's. Before the fix an
    unrelated request waited out the whole OpenSubtitles round trip; here it
    only has to make progress."""
    _install_fake_subliminal(monkeypatch, before=lambda: time.sleep(0.2))
    client = SubtitleAPIClient()
    ticks = 0

    async def unrelated_request():
        nonlocal ticks
        while True:
            ticks += 1
            await asyncio.sleep(0.005)

    ticker = asyncio.create_task(unrelated_request())
    try:
        await client.fetch_subtitle_subliminal("Arrival", 2016)
    finally:
        ticker.cancel()

    assert ticks > 1


async def test_one_hop_per_fetch(monkeypatch):
    """Batch first, then offload once — a fetch must not walk the executor."""
    threads = _install_fake_subliminal(monkeypatch)
    client = SubtitleAPIClient()

    await client.fetch_subtitle_subliminal("Arrival", 2016)

    assert len(threads) == 1


# ---------------------------------------------------------------------------
# 2. Backpressure: shed at the door rather than pin the pool logins share
# ---------------------------------------------------------------------------

async def test_full_cpu_pool_sheds_the_fetch(monkeypatch):
    _install_fake_subliminal(monkeypatch)
    client = SubtitleAPIClient()

    with _cpu_pool_full():
        with pytest.raises(CPUOverloaded):
            await client.fetch_subtitle_subliminal("Arrival", 2016)


async def test_shed_is_not_swallowed_as_a_failed_fetch(monkeypatch):
    """`fetch_subtitle` turns every error into `SubtitleAPIError`, which the
    ingestion chain reads as a clean miss. A shed must escape that funnel."""
    _install_fake_subliminal(monkeypatch)
    client = SubtitleAPIClient()

    with _cpu_pool_full():
        with pytest.raises(CPUOverloaded):
            await client.fetch_subtitle("Arrival", 2016)


# ---------------------------------------------------------------------------
# 3. A shed must never park a retrievable film as dead (#78)
# ---------------------------------------------------------------------------

def _service_with_cache_miss(monkeypatch) -> ScriptIngestionService:
    async def _no_cache(*args, **kwargs):
        return None

    async def _no_match(*args, **kwargs):
        return None

    svc = ScriptIngestionService(db=None)
    monkeypatch.setattr(svc, "_get_from_database", _no_cache)
    # STANDS4 cleanly has nothing, so the subtitle source alone decides whether
    # the overall outcome is permanent or transient.
    monkeypatch.setattr(svc, "_fetch_from_stands4_pdf", _no_match)
    monkeypatch.setattr(svc, "_fetch_from_stands4_api", _no_match)
    return svc


async def test_shed_subtitle_fetch_is_transient(monkeypatch):
    svc = _service_with_cache_miss(monkeypatch)

    async def _shed(*args, **kwargs):
        raise CPUOverloaded("CPU queue at capacity (2/2)")

    monkeypatch.setattr(svc.subtitle_api_client, "fetch_subtitle", _shed)

    with pytest.raises(Exception) as excinfo:
        await svc.get_or_fetch_script(movie_title="Retrievable Film", year=2001)

    # Plain Exception → the worker retries on backoff. ScriptNotFoundError here
    # would mean a busy pool could permanently kill a film that has subtitles.
    assert not isinstance(excinfo.value, ScriptNotFoundError)


async def test_real_subtitle_miss_is_still_permanent(monkeypatch):
    """The other half of the pair: without it, the test above would pass just
    as well if `_fetch_from_subtitle_api` re-raised everything."""
    svc = _service_with_cache_miss(monkeypatch)

    async def _miss(*args, **kwargs):
        raise SubtitleAPIError("Subliminal failed to find subtitles")

    monkeypatch.setattr(svc.subtitle_api_client, "fetch_subtitle", _miss)

    with pytest.raises(ScriptNotFoundError):
        await svc.get_or_fetch_script(movie_title="Film With Truly No Script", year=1900)


# ---------------------------------------------------------------------------
# 4. Behaviour is unchanged by the extraction
# ---------------------------------------------------------------------------

async def test_successful_fetch_returns_the_same_payload(monkeypatch):
    _install_fake_subliminal(monkeypatch)
    client = SubtitleAPIClient()

    result = await client.fetch_subtitle_subliminal("Arrival", 2016, language="es")

    assert result["subtitle_content"] == SRT
    assert result["format"] == "srt"
    assert result["source"] == "subliminal"
    assert result["metadata"] == {
        "provider": "opensubtitles",
        "language": "es",
        "title": "Arrival",
        "year": 2016,
    }


async def test_no_provider_had_it_returns_none(monkeypatch):
    _install_fake_subliminal(monkeypatch, found=False)
    client = SubtitleAPIClient()

    assert await client.fetch_subtitle_subliminal("Unknown Film", 1900) is None


async def test_missing_library_is_a_clean_miss(monkeypatch):
    """An absent subliminal must stay a `None`, not an exception — otherwise a
    deploy without the dependency would look like a permanent outage."""
    monkeypatch.setitem(sys.modules, "subliminal", None)
    client = SubtitleAPIClient()

    assert await client.fetch_subtitle_subliminal("Arrival", 2016) is None
