"""
Bounded in-process TTL cache for values that are identical for every caller.

Three behaviours matter here, and a plain dict gives none of them:

* **TTL** — entries expire, so slow-moving upstream data is re-read
  occasionally instead of being pinned for the life of the process.
* **Single-flight** — N concurrent misses on the same key produce exactly ONE
  upstream call; every other caller awaits the same task. A cold grid of 20
  posters costs one round trip per distinct movie, not one per widget.
* **Stale-on-error** — when the refresh raises, an expired-but-recent entry is
  served instead of the error. An upstream outage degrades to slightly old
  data rather than to blank cards.

Event-loop-affine by design: every mutation happens on the loop thread between
awaits, so no lock is needed. (Contrast `utils/rate_limit.py`, which is
reachable from worker threads and therefore does lock.) Do not call these from
`run_cpu` / `run_nlp` worker threads.

Entries live in this process only. The API runs as a single replica, so that
is the whole cache; a second replica would simply keep its own copy.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import OrderedDict
from typing import Awaitable, Callable, Dict, Generic, Optional, Tuple, TypeVar, Union

logger = logging.getLogger(__name__)

T = TypeVar("T")


class _Miss:
    """Distinguishes "no entry" from "an entry whose value happens to be None".

    Needed because callers legitimately cache None — the TMDB proxy stores it
    for an id TMDB has retired, so a dead movie isn't re-requested on every
    page render. A plain `Optional` return would re-fetch it every time.
    """

    __slots__ = ()

    def __bool__(self) -> bool:
        return False


MISS = _Miss()


class AsyncTTLCache(Generic[T]):
    """A keyed cache around an async `fetch()` that may be slow or may fail."""

    def __init__(
        self,
        *,
        ttl_seconds: float,
        max_entries: int = 2048,
        stale_seconds: float = 0.0,
        name: str = "cache",
    ) -> None:
        """
        Args:
            ttl_seconds: how long a stored value counts as fresh.
            max_entries: hard ceiling; the least-recently-used entry is dropped
                past it, so a caller-supplied key space (search queries) can't
                grow without bound.
            stale_seconds: extra window past the TTL in which an entry may be
                served if the refresh fails. 0 disables stale-on-error.
            name: shows up in logs and in `stats()`.
        """
        self._ttl = ttl_seconds
        self._max = max_entries
        self._stale = stale_seconds
        self._name = name
        # key -> (value, stored_at). Ordered newest-touched-last for LRU.
        self._entries: "OrderedDict[str, Tuple[T, float]]" = OrderedDict()
        self._inflight: Dict[str, "asyncio.Future[T]"] = {}
        self._hits = 0
        self._misses = 0
        self._stale_serves = 0

    # ── reads ───────────────────────────────────────────────────────────
    def lookup(self, key: str) -> Union[T, _Miss]:
        """A *fresh* value without fetching, or `MISS`."""
        entry = self._entries.get(key)
        if entry is None:
            return MISS
        value, stored_at = entry
        if time.monotonic() - stored_at >= self._ttl:
            return MISS
        self._entries.move_to_end(key)
        return value

    def peek(self, key: str) -> Optional[T]:
        """Convenience for callers that never cache None."""
        found = self.lookup(key)
        return None if isinstance(found, _Miss) else found

    async def get_or_fetch(self, key: str, fetch: Callable[[], Awaitable[T]]) -> T:
        """
        Return the cached value for `key`, or await `fetch()` to produce it.

        Concurrent callers for the same key share one `fetch()`. If that fetch
        raises and a stale entry is still inside the stale window, the stale
        value is returned instead of propagating the error.
        """
        fresh = self.lookup(key)
        if not isinstance(fresh, _Miss):
            self._hits += 1
            return fresh
        self._misses += 1

        task = self._inflight.get(key)
        if task is None:
            task = asyncio.ensure_future(self._fetch_and_store(key, fetch))
            self._inflight[key] = task
            task.add_done_callback(lambda _t, k=key: self._inflight.pop(k, None))

        try:
            # shield(): if THIS caller is cancelled (client hung up), the
            # shared fetch keeps running for everyone else waiting on it.
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            raise
        except Exception:
            stale = self._lookup_stale(key)
            if not isinstance(stale, _Miss):
                self._stale_serves += 1
                logger.warning("[%s] refresh failed for %r; serving stale entry", self._name, key)
                return stale
            raise

    async def _fetch_and_store(self, key: str, fetch: Callable[[], Awaitable[T]]) -> T:
        value = await fetch()
        self.set(key, value)
        return value

    def _lookup_stale(self, key: str) -> Union[T, _Miss]:
        """A value past its TTL but still inside the stale-on-error window."""
        if self._stale <= 0:
            return MISS
        entry = self._entries.get(key)
        if entry is None:
            return MISS
        value, stored_at = entry
        if time.monotonic() - stored_at >= self._ttl + self._stale:
            return MISS
        return value

    # ── writes ──────────────────────────────────────────────────────────
    def set(self, key: str, value: T) -> None:
        self._entries[key] = (value, time.monotonic())
        self._entries.move_to_end(key)
        while len(self._entries) > self._max:
            self._entries.popitem(last=False)

    def invalidate(self, key: str) -> None:
        self._entries.pop(key, None)

    def clear(self) -> None:
        """Drop every entry. Used by tests; there is no cache-bust endpoint."""
        self._entries.clear()
        self._hits = self._misses = self._stale_serves = 0

    # ── introspection ───────────────────────────────────────────────────
    def stats(self) -> Dict[str, object]:
        total = self._hits + self._misses
        return {
            "name": self._name,
            "entries": len(self._entries),
            "max_entries": self._max,
            "ttl_seconds": self._ttl,
            "hits": self._hits,
            "misses": self._misses,
            "stale_serves": self._stale_serves,
            "hit_rate": round(self._hits / total, 4) if total else None,
        }
