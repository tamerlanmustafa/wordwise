"""
Word pronunciation audio — synthesis kept off the event loop, and cached.

`GET /premium/pronounce/{word}` had never played a sound in production. Two
independent faults stacked: the mobile client sent no bearer token, so every
request 401'd (fixed in #163), and behind that the deployed image had no
speech library at all — `gtts` was imported inside the handler but declared in
no requirements file, so the route answered 501 to every caller that got past
auth. Prod log, 2026-09-01: `GET /premium/pronounce/gasoline → 501`.

Fixing the dependency alone would have shipped a worse bug than the one it
cured. `gTTS.write_to_fp` performs a **synchronous** HTTP round trip to
Google, and this API is one uvicorn process with one replica: a synchronous
call inside an `async def` pins the only event loop, so every concurrent
request waits on it — measured at 7.86s for `/health` behind one spaCy parse
(#117). Speech synthesis is not CPU-bound, but that distinction does not
matter to the loop; "not awaited, and can exceed ~10ms" is the rule, so it
goes through `run_cpu` like any other blocking call.

Two consequences shape the rest of this module:

* **A small `cpu_slot` cap.** A blocking network call holds its pool thread
  for the whole round trip, unlike bcrypt which holds it for ~173ms of actual
  work. That pool also hashes passwords, so an unbounded burst of taps would
  delay logins. Past the cap callers are shed immediately (`CPUOverloaded`)
  rather than queued behind a Google round trip they no longer care about.
* **A cache with single-flight.** A word's pronunciation never changes, and a
  deck is browsed word by word with re-taps, so the hit rate is high and each
  miss is a ~0.3–1s round trip. `AsyncTTLCache.get_or_fetch` additionally
  collapses N concurrent taps on one word into ONE upstream call, which is
  what a double-tap or a stuck finger actually produces.

Cached values are the raw MP3 **bytes**, never a `BytesIO`. A stream is
consumed by the response that sends it, so caching the buffer would serve
every request after the first an empty body — a fault that looks exactly like
the silent failure this endpoint already had.
"""

from __future__ import annotations

import io
import logging
from typing import Optional

from ..utils.offload import cpu_slot, run_cpu
from ..utils.ttl_cache import AsyncTTLCache

logger = logging.getLogger(__name__)


class TTSUnavailable(RuntimeError):
    """No speech backend in this image — `gtts` is not importable.

    Separate from a synthesis failure on purpose: this one is a deployment
    fact that no retry will change, and the route turns it into a 501 rather
    than a 500.
    """


#: Longest word we will synthesize. Matches the route's own clamp; a word is a
#: word, and the cache key space stays small.
MAX_WORD_LEN = 60

#: How many pronunciation jobs may be queued or running on the shared CPU pool
#: at once. Deliberately far below `DEFAULT_CPU_MAX_PENDING`: each one holds a
#: thread across a network round trip, and the same pool serves login hashing.
MAX_PENDING_SYNTHESES = 4

#: A word's audio is immutable, so this TTL is about bounding memory and
#: picking up a voice change after a deploy, not about freshness. In-process
#: only: a deploy empties it, which is fine — the first tap per word refills.
CACHE_TTL_SECONDS = 24 * 60 * 60

#: ~10–20 KB per clip, so this bounds the cache at roughly 10 MB. LRU past it.
CACHE_MAX_ENTRIES = 512

_clips: AsyncTTLCache[bytes] = AsyncTTLCache(
    ttl_seconds=CACHE_TTL_SECONDS,
    max_entries=CACHE_MAX_ENTRIES,
    name="pronunciation",
)


def cache_key(word: str, *, lang: str = "en") -> str:
    """Key a clip by what actually determines its audio.

    Case-folded because "Gasoline" and "gasoline" synthesize identically, and
    the deck sends whichever form the card displays — without this the cache
    would miss on capitalisation alone.
    """
    return f"{lang}:{word.strip().lower()}"


def _synthesize_blocking(word: str, lang: str) -> bytes:
    """Run gTTS to completion and return the MP3 bytes.

    BLOCKING — a synchronous HTTP request to Google lives inside this call.
    Never call it from an `async def`; go through `synthesize` below.
    """
    try:
        from gtts import gTTS
    except ImportError as exc:
        raise TTSUnavailable("gtts is not installed") from exc

    buf = io.BytesIO()
    gTTS(text=word, lang=lang, slow=False).write_to_fp(buf)
    return buf.getvalue()


async def synthesize(word: str, *, lang: str = "en") -> bytes:
    """MP3 bytes for `word`, from cache when we have them.

    Raises `TTSUnavailable` when the image has no speech backend, and
    `CPUOverloaded` when too many syntheses are already in flight. Every other
    failure propagates from gTTS unchanged so the route can log it.
    """
    clean = word.strip()[:MAX_WORD_LEN]
    if not clean:
        raise ValueError("empty word")

    async def fetch() -> bytes:
        # The slot is taken around the offload, not inside the worker: the
        # point is to refuse the job before it occupies a thread.
        with cpu_slot(MAX_PENDING_SYNTHESES):
            audio = await run_cpu(_synthesize_blocking, clean, lang)
        if not audio:
            # gTTS returning nothing is not a cacheable answer.
            raise RuntimeError("tts produced no audio")
        return audio

    return await _clips.get_or_fetch(cache_key(clean, lang=lang), fetch)


def cache_stats() -> dict:
    """Hit/miss counters, for the admin health surfaces."""
    return dict(_clips.stats())


def reset_cache() -> None:
    """Drop every cached clip. For tests, and for an admin cache flush."""
    _clips.clear()


def peek_cached(word: str, *, lang: str = "en") -> Optional[bytes]:
    """Cached clip without synthesizing, or None. For tests and diagnostics."""
    return _clips.peek(cache_key(word, lang=lang))
