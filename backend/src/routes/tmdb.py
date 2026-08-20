"""
TMDB proxy routes (issue #125).

Every one of these used to be a direct call from the device to
api.themoviedb.org, signed with an API key compiled into the app bundle.
Routing them through here removes the key from the client and puts one cache
in front of data that is identical for every user.

All of them stay **public but throttled**, matching what they replaced: the
Home feed, onboarding's film picker and the web search bar all render before
there is a session to authenticate. Public also means the responses carry a
plain `Cache-Control`, so the CDN in front of the API can serve repeats
without touching this process at all.
"""

from contextlib import contextmanager
from typing import Any, Dict, Iterator, List

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response

from ..services import tmdb_proxy
from ..utils.rate_limit import rate_limit
from ..utils.tmdb_client import TMDBClient
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tmdb", tags=["tmdb"])

# Stays public (the web search bar autocompletes before login), but every
# call burns TMDB quota — throttle per user/IP so it can't be farmed.
_autocomplete_throttle = rate_limit(30, 60.0, scope="tmdb-autocomplete")

# Metadata reads are cache-served almost always, so the ceiling is about abuse
# rather than about TMDB quota. One app session opening Home, scrolling a
# level feed and running a few searches sits far below this.
_metadata_throttle = rate_limit(120, 60.0, scope="tmdb-metadata")

# How long a client (and any CDN in front of us) may reuse a response. Matches
# the server-side TTLs in `services/tmdb_proxy`.
_DETAILS_CACHE_CONTROL = "public, max-age=86400"
_LIST_CACHE_CONTROL = "public, max-age=3600"

# Ceiling on one batch request. A movie page is 20 rows; double that leaves
# room for a bigger page without letting a caller ask for the catalog.
MAX_BATCH_IDS = 40


@contextmanager
def _upstream(what: str) -> Iterator[None]:
    """
    Turn a TMDB failure into an honest 502 instead of a 500.

    `tmdb_proxy` already serves a stale entry when it has one, so reaching
    this means TMDB is unreachable *and* nothing recent is cached. A 502 tells
    the client (and the logs) that the failure is upstream, not ours.
    """
    try:
        yield
    except HTTPException:
        raise
    except RuntimeError as e:  # key not configured
        logger.error("[TMDB] %s unavailable: %s", what, e)
        raise HTTPException(status_code=503, detail="TMDB proxy is not configured")
    except httpx.HTTPError as e:
        logger.warning("[TMDB] %s failed upstream: %s", what, e)
        raise HTTPException(status_code=502, detail="TMDB is temporarily unavailable")


def _parse_ids(ids: str) -> List[int]:
    """`?ids=550,680,13` → [550, 680, 13]. Rejects anything non-numeric."""
    raw = [part.strip() for part in ids.split(",") if part.strip()]
    if not raw:
        raise HTTPException(status_code=400, detail="ids must contain at least one TMDB id")
    if len(raw) > MAX_BATCH_IDS:
        raise HTTPException(
            status_code=400, detail=f"at most {MAX_BATCH_IDS} ids per request"
        )
    try:
        return [int(part) for part in raw]
    except ValueError:
        raise HTTPException(status_code=400, detail="ids must be comma-separated integers")


@router.get("/autocomplete")
async def autocomplete_movies(
    q: str = Query(..., min_length=1, description="Search query"),
    limit: int = Query(5, ge=1, le=10, description="Max results"),
    _: None = Depends(_autocomplete_throttle),
) -> List[Dict[str, Any]]:
    client = TMDBClient()
    try:
        return await client.autocomplete(q, limit)
    finally:
        await client.close()


@router.get("/movies")
async def batch_movie_metadata(
    response: Response,
    ids: str = Query(..., description="Comma-separated TMDB movie ids, max 40"),
    _: None = Depends(_metadata_throttle),
) -> Dict[str, Any]:
    """
    Metadata for a whole page of movies in one request.

    This is the endpoint that collapses the old per-movie fan-out: a 20-row
    CEFR page was 20 requests from the phone, and is now one. Ids TMDB doesn't
    recognise are simply absent from `movies` — the caller keeps whatever it
    already had for that row.
    """
    tmdb_ids = _parse_ids(ids)
    with _upstream("batch metadata"):
        found = await tmdb_proxy.get_movies(tmdb_ids)
    response.headers["Cache-Control"] = _DETAILS_CACHE_CONTROL
    return {"movies": {str(k): v for k, v in found.items()}}


@router.get("/movie/{tmdb_id}")
async def movie_metadata(
    tmdb_id: int,
    response: Response,
    _: None = Depends(_metadata_throttle),
) -> Dict[str, Any]:
    """One movie's metadata. Prefer `/movies?ids=` when fetching several."""
    with _upstream("movie metadata"):
        movie = await tmdb_proxy.get_movie(tmdb_id)
    if movie is None:
        raise HTTPException(status_code=404, detail="Movie not found on TMDB")
    response.headers["Cache-Control"] = _DETAILS_CACHE_CONTROL
    return movie


@router.get("/trending")
async def trending_movies(
    response: Response,
    limit: int = Query(20, ge=1, le=20),
    _: None = Depends(_metadata_throttle),
) -> Dict[str, Any]:
    """Today's trending movies — the Home screen's opening feed."""
    with _upstream("trending"):
        payload = await tmdb_proxy.trending(limit=limit)
    response.headers["Cache-Control"] = _LIST_CACHE_CONTROL
    return payload


@router.get("/search")
async def search_movies(
    response: Response,
    q: str = Query(..., min_length=1, description="Title search"),
    page: int = Query(1, ge=1, le=500),
    _: None = Depends(_metadata_throttle),
) -> Dict[str, Any]:
    with _upstream("search"):
        payload = await tmdb_proxy.search(q, page)
    response.headers["Cache-Control"] = _LIST_CACHE_CONTROL
    return payload


@router.get("/discover")
async def discover_movies(
    response: Response,
    genres: str = Query(..., description="TMDB genre ids, '|'-separated for OR"),
    page: int = Query(1, ge=1, le=500),
    _: None = Depends(_metadata_throttle),
) -> Dict[str, Any]:
    """Genre quick-start: top-rated, widely-rated, English-original films."""
    if not all(part.strip().isdigit() for part in genres.split("|") if part.strip()):
        raise HTTPException(status_code=400, detail="genres must be '|'-separated integers")
    with _upstream("discover"):
        payload = await tmdb_proxy.discover_by_genre(genres, page)
    response.headers["Cache-Control"] = _LIST_CACHE_CONTROL
    return payload
