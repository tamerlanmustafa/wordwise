"""
Per-job work: turn a TMDB id into a fully classified movie row.

This module is the only piece of the worker subsystem that knows what a
"job" actually means. The queue, rate limiter, and controller are all
domain-agnostic — they just push opaque jobs through a token bucket.

Strategy: don't reimplement the existing ingestion / classification
pipeline. Instead, call the local FastAPI server over httpx. The server
already knows how to:
  - find a Movie row by title (or create one)
  - hit STANDS4 / OpenSubtitles in priority order with caching
  - tokenize, lemmatize, classify against the wordlists, store everything
  - dual-write the V2 lemma registry

The worker is responsible only for orchestration, retries, and rate.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from typing import Optional

import asyncpg
import httpx

from . import rate
from .queue import Job

logger = logging.getLogger(__name__)


API_BASE_URL = os.environ.get("WORKER_API_BASE_URL", "http://localhost:8000")
TMDB_API_KEY = os.environ.get("TMDB_API_KEY") or os.environ.get("VITE_TMDB_API_KEY")


class TransientError(Exception):
    """Retryable. The controller treats these as backpressure signals."""


class PermanentError(Exception):
    """Don't retry. The job is parked as 'dead' once attempts are exhausted
    on the next failure, but a permanent error short-circuits us straight
    to that state."""


@dataclass
class JobResult:
    movie_id: Optional[int]
    vocab_count: Optional[int]


def _classify_http_error(exc: Exception) -> tuple[str, bool]:
    """Return (error_kind, is_transient)."""
    if isinstance(exc, httpx.TimeoutException):
        return "timeout", True
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        if code == 429:
            return "rate_limited", True
        if 500 <= code < 600:
            return "http_5xx", True
        if code == 404:
            return "not_found", False
        return f"http_{code}", False
    return "other", True


async def _ensure_movie_row(
    pool: asyncpg.Pool,
    tmdb_id: int,
    title: str,
    year: Optional[int],
) -> int:
    """
    The Movie table is owned by the Prisma schema, but we touch it directly
    here for one specific reason: we need an integer movie_id to hand to the
    classify-script endpoint, and the create_movie endpoint requires auth.
    Worker → DB direct write avoids inventing a service token just to call
    our own API.
    """
    async with pool.acquire() as conn:
        # Match by (title, year). The TMDB id isn't on the Movie table yet,
        # so this is the closest unique signal we have.
        existing = await conn.fetchrow(
            """
            SELECT id FROM movies
             WHERE LOWER(title) = LOWER($1)
               AND year = $2
             LIMIT 1
            """,
            title,
            year,
        )
        if existing:
            return existing["id"]

        row = await conn.fetchrow(
            """
            INSERT INTO movies (title, year, created_at, updated_at)
            VALUES ($1, $2, now(), now())
            RETURNING id
            """,
            title,
            year,
        )
        return row["id"]


async def _fetch_tmdb_metadata(
    client: httpx.AsyncClient,
    tmdb_id: int,
) -> dict:
    """Fetch TMDB title/year/genres/poster. Counted against the token bucket."""
    if not TMDB_API_KEY:
        raise PermanentError("TMDB_API_KEY not set")
    url = f"https://api.themoviedb.org/3/movie/{tmdb_id}"
    resp = await client.get(url, params={"api_key": TMDB_API_KEY, "language": "en-US"})
    resp.raise_for_status()
    return resp.json()


async def process_job(
    pool: asyncpg.Pool,
    job: Job,
    client: httpx.AsyncClient,
) -> JobResult:
    """
    Walk one job through the full pipeline.

    Each outbound network call sits behind acquire_token(), and each call's
    outcome is recorded via record_event() so the controller has data to
    react to. Internal DB writes don't consume tokens — only external APIs.
    """
    # 1. Make sure we have an integer movie_id. Cheap, local DB only.
    movie_id = job.movie_id
    if movie_id is None:
        movie_id = await _ensure_movie_row(pool, job.tmdb_id, job.title, job.year)

    # 2. Pull TMDB metadata so we can pass genres into classification.
    #    Counts against the token bucket — TMDB is a real upstream API.
    await rate.acquire_token(pool)
    t0 = time.monotonic()
    try:
        tmdb_meta = await _fetch_tmdb_metadata(client, job.tmdb_id)
        await rate.record_event(
            pool,
            success=True,
            status_code=200,
            latency_ms=int((time.monotonic() - t0) * 1000),
        )
    except Exception as exc:
        kind, transient = _classify_http_error(exc)
        await rate.record_event(
            pool,
            success=False,
            status_code=getattr(getattr(exc, "response", None), "status_code", None),
            latency_ms=int((time.monotonic() - t0) * 1000),
            error_kind=kind,
        )
        if transient:
            raise TransientError(f"tmdb fetch failed: {exc}") from exc
        raise PermanentError(f"tmdb fetch failed: {exc}") from exc

    genres = [g["name"] for g in tmdb_meta.get("genres") or []]

    # 3. Fetch the script. The /scripts/fetch endpoint is a LOCAL hop
    #    that internally fans out to STANDS4/OpenSubtitles. Its 500s could
    #    mean upstream is angry OR our route hit a code/data bug — we
    #    can't tell from here. We still gate it with the token bucket
    #    (so a slow upstream naturally backpressures us) but we DO NOT
    #    record_event() — feeding ambiguous signals into AIMD lets a
    #    single bad movie collapse target_qps for the whole pool.
    #    TMDB direct calls (step 2) remain the clean backpressure signal.
    await rate.acquire_token(pool)
    try:
        resp = await client.post(
            f"{API_BASE_URL}/api/scripts/fetch",
            json={
                "movie_title": job.title,
                "movie_id": movie_id,
                "year": job.year,
                "force_refresh": False,
            },
            timeout=120.0,
        )
        resp.raise_for_status()
    except Exception as exc:
        _, transient = _classify_http_error(exc)
        if transient:
            raise TransientError(f"script fetch failed: {exc}") from exc
        raise PermanentError(f"script fetch failed: {exc}") from exc

    # 4. Classify. This call is local-only — no external APIs — so it does
    #    NOT consume a token, but we still record latency for observability.
    t0 = time.monotonic()
    try:
        resp = await client.post(
            f"{API_BASE_URL}/api/cefr/classify-script",
            json={
                "movie_id": movie_id,
                "save_to_db": True,
                "genres": genres,
            },
            timeout=600.0,  # cold-cache classification of a feature film is slow
        )
        resp.raise_for_status()
        payload = resp.json()
    except Exception as exc:
        # Classification failures are local — typically a code bug, not
        # rate-limit pressure. Mark as transient so it retries with backoff,
        # but don't poison the AIMD signal: classification didn't fail
        # because of upstream rate limiting.
        raise TransientError(f"classify failed: {exc}") from exc

    vocab_count = sum((payload.get("level_distribution") or {}).values())
    logger.info(
        "[worker] movie_id=%s tmdb_id=%s classified vocab=%d",
        movie_id,
        job.tmdb_id,
        vocab_count,
    )

    return JobResult(movie_id=movie_id, vocab_count=vocab_count)
