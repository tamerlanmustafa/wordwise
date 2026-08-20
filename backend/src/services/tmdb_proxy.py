"""
Server-side TMDB proxy with caching (issue #125).

Before this, every device called TMDB directly with an API key compiled into
the app bundle, one request per movie per page. That was two problems at once:

1. **Fan-out.** A 20-movie page was 20 round trips from a phone on mobile
   data, each one to a third-party host. The data is identical for every user
   and was never cached anywhere.
2. **The key.** A client-side key is extractable from the bundle by anyone
   who downloads the app, and it can't be rotated without shipping a release.

Both go away if the server is the only thing that talks to TMDB. What's left
here is the caching layer that makes that affordable: one process-wide cache
per endpoint family, so the Nth device asking about a movie is answered from
memory rather than from TMDB.

Responses are **projected** onto a fixed field set (`_project_movie`) rather
than passed through raw. TMDB's movie payload carries production companies,
spoken languages, collection objects and more that no WordWise screen renders;
dropping them cuts the bytes a phone downloads and pins the contract between
this proxy and the app to something explicit.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional, Sequence

import httpx

from ..utils.tmdb_client import tmdb_get
from ..utils.ttl_cache import AsyncTTLCache

logger = logging.getLogger(__name__)


# ── TTLs ────────────────────────────────────────────────────────────────────
# Movie facts (title, poster, overview, release date) essentially never move,
# so a long TTL is safe and keeps TMDB traffic near zero for the catalog.
# Trending is recomputed by TMDB daily; searches change only as the catalog
# does. The stale window is what an outage falls back to.
_DETAILS_TTL = 24 * 3600.0
_DETAILS_STALE = 7 * 24 * 3600.0
_LIST_TTL = 3600.0
_LIST_STALE = 24 * 3600.0

_details_cache: AsyncTTLCache[Optional[Dict[str, Any]]] = AsyncTTLCache(
    ttl_seconds=_DETAILS_TTL,
    stale_seconds=_DETAILS_STALE,
    max_entries=8192,
    name="tmdb-details",
)
# Keyed by the full query (text + page / genres + page), so the key space is
# caller-supplied — hence the tighter entry ceiling and LRU eviction.
_list_cache: AsyncTTLCache[Dict[str, Any]] = AsyncTTLCache(
    ttl_seconds=_LIST_TTL,
    stale_seconds=_LIST_STALE,
    max_entries=1024,
    name="tmdb-lists",
)

# The single most requested list in the app (Home opens on it), so it gets its
# own entry rather than competing for space with search queries.
_TRENDING_KEY = "trending/day"

# Every field any WordWise screen reads off a TMDB movie. Anything not listed
# is dropped before the payload leaves this process.
_MOVIE_FIELDS = (
    "id",
    "title",
    "original_language",
    "overview",
    "poster_path",
    "backdrop_path",
    "release_date",
    "vote_average",
    "vote_count",
    "popularity",
)


def _project_movie(raw: Dict[str, Any]) -> Dict[str, Any]:
    """
    Trim a TMDB movie to the fields the app renders.

    Search/discover/trending rows carry `genre_ids: [int]`; the details
    endpoint carries `genres: [{id, name}]` instead. Both are normalised to
    `genre_ids` here so a card looks the same however it was fetched — before
    this, a movie opened from the CEFR list showed no genre chips because the
    details payload had no `genre_ids` for the app to read.
    """
    out: Dict[str, Any] = {field: raw.get(field) for field in _MOVIE_FIELDS}
    genre_ids = raw.get("genre_ids")
    if genre_ids is None:
        genre_ids = [g.get("id") for g in raw.get("genres") or [] if g.get("id") is not None]
    out["genre_ids"] = list(genre_ids or [])
    return out


def _project_list(raw: Dict[str, Any], *, limit: Optional[int] = None) -> Dict[str, Any]:
    """Trim a paged TMDB list response, keeping the paging fields."""
    results = [_project_movie(m) for m in raw.get("results") or [] if isinstance(m, dict)]
    if limit is not None:
        results = results[:limit]
    return {
        "page": raw.get("page", 1),
        "total_pages": raw.get("total_pages", 1),
        "total_results": raw.get("total_results", len(results)),
        "results": results,
    }


# ── movie details ───────────────────────────────────────────────────────────
async def get_movie(tmdb_id: int) -> Optional[Dict[str, Any]]:
    """
    One movie's metadata, cached. Returns None when TMDB has no such id.

    A 404 is cached as None on purpose: a movie id our catalog carries but
    TMDB has retired would otherwise be re-requested on every page render.
    """

    async def fetch() -> Optional[Dict[str, Any]]:
        try:
            return _project_movie(await tmdb_get(f"/movie/{tmdb_id}"))
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            raise

    return await _details_cache.get_or_fetch(str(tmdb_id), fetch)


async def get_movies(tmdb_ids: Sequence[int]) -> Dict[int, Dict[str, Any]]:
    """
    Metadata for a page of movies in one call from the caller's point of view.

    Ids already cached cost nothing. The rest are fetched concurrently on the
    shared connection pool — this is awaited network I/O, so the fan-out sits
    on the event loop without blocking anyone else's request. A single id that
    fails is dropped from the result rather than failing the page, matching
    what the app did per-movie before.
    """
    unique = list(dict.fromkeys(int(i) for i in tmdb_ids))
    if not unique:
        return {}

    settled = await asyncio.gather(
        *(get_movie(tmdb_id) for tmdb_id in unique), return_exceptions=True
    )

    out: Dict[int, Dict[str, Any]] = {}
    failures = 0
    for tmdb_id, result in zip(unique, settled):
        if isinstance(result, BaseException):
            failures += 1
            continue
        if result is not None:
            out[tmdb_id] = result
    if failures:
        logger.warning("[TMDB] %d of %d batch lookups failed", failures, len(unique))
    return out


# ── lists ───────────────────────────────────────────────────────────────────
async def trending(limit: int = 20) -> Dict[str, Any]:
    """Today's trending movies (TMDB recomputes this daily)."""
    raw = await _list_cache.get_or_fetch(
        _TRENDING_KEY, lambda: tmdb_get("/trending/movie/day")
    )
    return _project_list(raw, limit=limit)


async def search(query: str, page: int = 1) -> Dict[str, Any]:
    """Title search, one page."""
    key = f"search:{page}:{query.strip().casefold()}"
    raw = await _list_cache.get_or_fetch(
        key, lambda: tmdb_get("/search/movie", {"query": query, "page": page})
    )
    return _project_list(raw)


async def discover_by_genre(genres: str, page: int = 1) -> Dict[str, Any]:
    """
    Top-rated films in a genre, restricted the way the Quick Start grid needs:
    English originals with enough votes to be recognisable. WordWise can only
    process English subtitles today, so foreign titles would dead-end at
    script fetch.
    """
    key = f"discover:{page}:{genres}"

    def fetch():
        return tmdb_get(
            "/discover/movie",
            {
                "with_genres": genres,
                "with_original_language": "en",
                "sort_by": "vote_average.desc",
                "vote_count.gte": 5000,
                "include_adult": "false",
                "page": page,
            },
        )

    raw = await _list_cache.get_or_fetch(key, fetch)
    return _project_list(raw)


# ── introspection / tests ───────────────────────────────────────────────────
def cache_stats() -> List[Dict[str, object]]:
    return [_details_cache.stats(), _list_cache.stats()]


def clear_caches() -> None:
    _details_cache.clear()
    _list_cache.clear()
