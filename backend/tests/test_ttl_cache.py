"""
AsyncTTLCache: the three behaviours a plain dict does not give us.

Written for the TMDB proxy (issue #125), where the same movie is requested by
every device that renders the same page. Single-flight is the property that
actually matters there: without it, twenty simultaneous cold misses on one
movie are twenty calls to TMDB.
"""
from __future__ import annotations

import asyncio

import pytest

from src.utils.ttl_cache import AsyncTTLCache


async def test_second_read_is_served_from_the_cache():
    calls = 0

    async def fetch():
        nonlocal calls
        calls += 1
        return {"v": calls}

    cache: AsyncTTLCache[dict] = AsyncTTLCache(ttl_seconds=60.0)
    assert await cache.get_or_fetch("k", fetch) == {"v": 1}
    assert await cache.get_or_fetch("k", fetch) == {"v": 1}
    assert calls == 1


async def test_expired_entry_is_refetched():
    calls = 0

    async def fetch():
        nonlocal calls
        calls += 1
        return calls

    cache: AsyncTTLCache[int] = AsyncTTLCache(ttl_seconds=0.01)
    assert await cache.get_or_fetch("k", fetch) == 1
    await asyncio.sleep(0.02)
    assert await cache.get_or_fetch("k", fetch) == 2
    assert calls == 2


async def test_concurrent_misses_share_one_fetch():
    """Twenty phones, one movie, one upstream call."""
    calls = 0
    started = asyncio.Event()
    release = asyncio.Event()

    async def fetch():
        nonlocal calls
        calls += 1
        started.set()
        await release.wait()
        return "poster"

    cache: AsyncTTLCache[str] = AsyncTTLCache(ttl_seconds=60.0)
    waiters = [asyncio.create_task(cache.get_or_fetch("550", fetch)) for _ in range(20)]
    await started.wait()
    release.set()

    assert await asyncio.gather(*waiters) == ["poster"] * 20
    assert calls == 1


async def test_a_cancelled_waiter_does_not_cancel_the_shared_fetch():
    """A phone that backgrounds mid-request must not strand the other 19."""
    calls = 0
    started = asyncio.Event()
    release = asyncio.Event()

    async def fetch():
        nonlocal calls
        calls += 1
        started.set()
        await release.wait()
        return "poster"

    cache: AsyncTTLCache[str] = AsyncTTLCache(ttl_seconds=60.0)
    first = asyncio.create_task(cache.get_or_fetch("550", fetch))
    second = asyncio.create_task(cache.get_or_fetch("550", fetch))
    await started.wait()

    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first

    release.set()
    assert await second == "poster"
    assert calls == 1


async def test_stale_value_is_served_when_the_refresh_fails():
    state = {"fail": False}

    async def fetch():
        if state["fail"]:
            raise RuntimeError("TMDB down")
        return "fresh"

    cache: AsyncTTLCache[str] = AsyncTTLCache(ttl_seconds=0.01, stale_seconds=60.0)
    assert await cache.get_or_fetch("k", fetch) == "fresh"

    await asyncio.sleep(0.02)
    state["fail"] = True
    assert await cache.get_or_fetch("k", fetch) == "fresh"
    assert cache.stats()["stale_serves"] == 1


async def test_failure_propagates_when_there_is_nothing_stale_to_serve():
    async def fetch():
        raise RuntimeError("TMDB down")

    cache: AsyncTTLCache[str] = AsyncTTLCache(ttl_seconds=60.0, stale_seconds=60.0)
    with pytest.raises(RuntimeError):
        await cache.get_or_fetch("k", fetch)


async def test_stale_window_eventually_closes():
    state = {"fail": False}

    async def fetch():
        if state["fail"]:
            raise RuntimeError("TMDB down")
        return "fresh"

    cache: AsyncTTLCache[str] = AsyncTTLCache(ttl_seconds=0.01, stale_seconds=0.01)
    await cache.get_or_fetch("k", fetch)
    await asyncio.sleep(0.05)
    state["fail"] = True
    with pytest.raises(RuntimeError):
        await cache.get_or_fetch("k", fetch)


async def test_lru_eviction_bounds_a_caller_supplied_key_space():
    """Search queries come from users, so the cache must not grow forever."""

    async def fetch():
        return "x"

    cache: AsyncTTLCache[str] = AsyncTTLCache(ttl_seconds=60.0, max_entries=3)
    for key in ("a", "b", "c"):
        await cache.get_or_fetch(key, fetch)
    # Touch "a" so "b" becomes the least-recently-used entry.
    await cache.get_or_fetch("a", fetch)
    await cache.get_or_fetch("d", fetch)

    assert cache.peek("b") is None
    assert cache.peek("a") == "x"
    assert cache.stats()["entries"] == 3


async def test_a_cached_none_is_a_hit_not_a_miss():
    """
    None is a legitimate cached value — the TMDB proxy stores it for an id
    TMDB has retired. If "cached None" read as "not cached", every page render
    would re-ask TMDB about the same dead movie.
    """
    calls = 0

    async def fetch():
        nonlocal calls
        calls += 1
        return None

    cache: AsyncTTLCache[object] = AsyncTTLCache(ttl_seconds=60.0)
    assert await cache.get_or_fetch("gone", fetch) is None
    assert await cache.get_or_fetch("gone", fetch) is None
    assert calls == 1


async def test_a_failed_fetch_is_not_cached():
    calls = 0

    async def fetch():
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("transient")
        return "ok"

    cache: AsyncTTLCache[str] = AsyncTTLCache(ttl_seconds=60.0)
    with pytest.raises(RuntimeError):
        await cache.get_or_fetch("k", fetch)
    assert await cache.get_or_fetch("k", fetch) == "ok"
