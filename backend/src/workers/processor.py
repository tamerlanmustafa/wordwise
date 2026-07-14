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
        # Prefer matching by tmdb_id (the only truly unique key). Fall back
        # to (title, year) for legacy rows created before tmdb_id was tracked,
        # and backfill tmdb_id on those so the next lookup is unambiguous.
        existing = await conn.fetchrow(
            "SELECT id FROM movies WHERE tmdb_id = $1 LIMIT 1",
            tmdb_id,
        )
        if existing:
            return existing["id"]

        existing = await conn.fetchrow(
            """
            SELECT id FROM movies
             WHERE tmdb_id IS NULL
               AND LOWER(title) = LOWER($1)
               AND year = $2
             LIMIT 1
            """,
            title,
            year,
        )
        if existing:
            await conn.execute(
                "UPDATE movies SET tmdb_id = $1, updated_at = now() WHERE id = $2",
                tmdb_id,
                existing["id"],
            )
            return existing["id"]

        row = await conn.fetchrow(
            """
            INSERT INTO movies (title, year, tmdb_id, created_at, updated_at)
            VALUES ($1, $2, $3, now(), now())
            RETURNING id
            """,
            title,
            year,
            tmdb_id,
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

    # Persist TMDB popularity / rating signals on the movie row so the admin
    # browser and ranking queries don't have to re-fetch from TMDB later.
    async with pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE movies
               SET tmdb_popularity   = $1,
                   tmdb_vote_average = $2,
                   tmdb_vote_count   = $3,
                   updated_at        = now()
             WHERE id = $4
            """,
            tmdb_meta.get("popularity"),
            tmdb_meta.get("vote_average"),
            tmdb_meta.get("vote_count"),
            movie_id,
        )

    # 3. Fetch the script. This used to POST to our own /api/scripts/fetch,
    #    but that endpoint now requires an authenticated user and the worker
    #    has no user to act as — so we call ScriptIngestionService directly,
    #    the same move step 4 made for classification. It still fans out to
    #    STANDS4/OpenSubtitles, so it keeps the token-bucket gate (a slow
    #    upstream naturally backpressures us) but does NOT record_event() —
    #    feeding ambiguous signals into AIMD lets a single bad movie collapse
    #    target_qps for the whole pool. TMDB direct calls (step 2) remain the
    #    clean backpressure signal.
    await rate.acquire_token(pool)
    from prisma import Prisma

    from src.services.script_ingestion_service import (
        ScriptIngestionService,
        ScriptNotFoundError,
    )

    fetch_db = Prisma()
    try:
        await fetch_db.connect()
        service = ScriptIngestionService(fetch_db)
        try:
            await service.get_or_fetch_script(
                movie_title=job.title,
                movie_id=movie_id,
                year=job.year,
                force_refresh=False,
            )
        finally:
            await service.close()
    except ScriptNotFoundError as exc:
        # The movie genuinely isn't in any source — park the job as dead, don't
        # retry on backoff. A transient outage raises a plain Exception instead
        # and falls through to the retryable branch below (mirrors the route's
        # 404-vs-500 split, now keyed on exception type not error strings).
        raise PermanentError(f"script not found: {exc}") from exc
    except Exception as exc:
        raise TransientError(f"script fetch failed: {exc}") from exc
    finally:
        if fetch_db.is_connected():
            await fetch_db.disconnect()

    # 4. Classify in-process. This used to POST to our own
    #    /api/cefr/classify-script, but that endpoint now requires an
    #    authenticated user and the worker has no user to act as. We call the
    #    classification service directly instead — no auth, no HTTP hop. It's
    #    local-only (no external APIs), so it does NOT consume a token; we
    #    still record latency for observability. Imported lazily to avoid
    #    pulling the API route module (and the classifier it loads) at import
    #    time and to sidestep any import cycle.
    from src.routes.cefr import (
        ScriptClassificationRequest,
        populate_sentence_bank_bg,
        run_script_classification,
    )

    t0 = time.monotonic()
    db = Prisma()
    try:
        await db.connect()
        result = await run_script_classification(
            db,
            ScriptClassificationRequest(
                movie_id=movie_id,
                save_to_db=True,
                genres=genres,
            ),
        )
    except Exception as exc:
        # Classification failures are local — typically a code/data bug, not
        # rate-limit pressure. Mark as transient so it retries with backoff,
        # but don't poison the AIMD signal: classification didn't fail
        # because of upstream rate limiting.
        raise TransientError(f"classify failed: {exc}") from exc
    finally:
        if db.is_connected():
            await db.disconnect()

    # Mirror the HTTP route's post-classify step: populate the SentenceBank.
    # The route fires this as a fire-and-forget BackgroundTask; the worker
    # awaits it so the job isn't marked done until it finishes. It owns its
    # own connection, is idempotent, and swallows its own errors.
    await populate_sentence_bank_bg(movie_id)

    vocab_count = sum((result.level_distribution or {}).values())
    logger.info(
        "[worker] movie_id=%s tmdb_id=%s classified vocab=%d",
        movie_id,
        job.tmdb_id,
        vocab_count,
    )

    return JobResult(movie_id=movie_id, vocab_count=vocab_count)
