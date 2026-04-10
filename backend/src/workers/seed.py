"""
Populate the movie_jobs queue from TMDB.

Usage:
    python -m src.workers.seed                  # default: top_rated, 13 pages (250)
    python -m src.workers.seed --pages 50       # bigger backlog
    python -m src.workers.seed --backlog        # popular discover, priority=1
    python -m src.workers.seed --discover --pages 50
                                                # /discover sorted by
                                                # vote_count.desc, English
                                                # originals only, priority=2

Top 250 are inserted with priority=0 so the worker pool burns through
the high-value catalog first. Backlog rows go in at priority=1, discover
expansion at priority=2.

Idempotent: if a (tmdb_id) already exists in movie_jobs we leave it alone.
You can re-run this safely after a crash, after adding more pages, etc.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from pathlib import Path
from typing import Iterable

import asyncpg
import httpx

from .db import close_pool, get_pool

# Persistent cursor for the discover walk. Lives alongside the backend so it
# survives restarts but is not checked into git. Each entry keeps the next
# page to fetch for a given (endpoint, filter) key — lets us grow the catalog
# incrementally across worker restarts without re-hitting pages we've already
# drained.
_CURSOR_PATH = Path(__file__).resolve().parent.parent.parent / ".seed_cursor.json"


def _load_cursor() -> dict:
    try:
        return json.loads(_CURSOR_PATH.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_cursor(cursor: dict) -> None:
    try:
        _CURSOR_PATH.write_text(json.dumps(cursor, indent=2))
    except OSError as exc:
        logger.warning("[seed] failed to persist cursor: %s", exc)

logger = logging.getLogger("wordwise.seed")

TMDB_API_KEY = os.environ.get("TMDB_API_KEY") or os.environ.get("VITE_TMDB_API_KEY")


async def _fetch_tmdb_page(client: httpx.AsyncClient, endpoint: str, page: int) -> list[dict]:
    if not TMDB_API_KEY:
        raise RuntimeError("TMDB_API_KEY not set")
    resp = await client.get(
        f"https://api.themoviedb.org/3/movie/{endpoint}",
        params={"api_key": TMDB_API_KEY, "language": "en-US", "page": page},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("results", [])


async def _fetch_discover_page(client: httpx.AsyncClient, page: int) -> list[dict]:
    """
    Discover endpoint sorted by vote_count.desc, English originals only.
    Use this to grow the catalog past the 250 top-rated films — it surfaces
    well-known popular titles that didn't make the all-time top list.
    """
    if not TMDB_API_KEY:
        raise RuntimeError("TMDB_API_KEY not set")
    resp = await client.get(
        "https://api.themoviedb.org/3/discover/movie",
        params={
            "api_key": TMDB_API_KEY,
            "language": "en-US",
            "sort_by": "vote_count.desc",
            "with_original_language": "en",
            "include_adult": "false",
            "vote_count.gte": 1000,
            "page": page,
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("results", [])


async def _insert_jobs(
    pool: asyncpg.Pool,
    movies: Iterable[dict],
    priority: int,
) -> int:
    inserted = 0
    async with pool.acquire() as conn:
        for m in movies:
            tmdb_id = m.get("id")
            title = m.get("title") or m.get("original_title")
            if not tmdb_id or not title:
                continue
            release = (m.get("release_date") or "").split("-")[0]
            year = int(release) if release.isdigit() else None

            result = await conn.execute(
                """
                INSERT INTO movie_jobs (tmdb_id, title, year, priority)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT DO NOTHING
                """,
                tmdb_id,
                title,
                year,
                priority,
            )
            # asyncpg returns 'INSERT 0 1' on success, 'INSERT 0 0' on conflict.
            # Note: there's no real ON CONFLICT target without a unique
            # constraint — we have an index but not a unique. Add one
            # before going to prod, or do an explicit existence check.
            if result.endswith("1"):
                inserted += 1
    return inserted


async def _ensure_unique_constraint(pool: asyncpg.Pool) -> None:
    """
    Idempotently add the UNIQUE (tmdb_id) constraint that makes our
    ON CONFLICT DO NOTHING meaningful. Split out so both the CLI seeder
    and the auto-seeder called from the worker can reuse it.
    """
    async with pool.acquire() as conn:
        await conn.execute(
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'movie_jobs_tmdb_id_key'
                ) THEN
                    ALTER TABLE movie_jobs
                        ADD CONSTRAINT movie_jobs_tmdb_id_key UNIQUE (tmdb_id);
                END IF;
            END$$;
            """
        )


async def seed_discover_until(
    target: int,
    *,
    priority: int = 2,
    max_pages: int = 500,
) -> int:
    """
    Walk the TMDB /discover endpoint (English originals, vote_count.desc)
    starting from the persistent page cursor and insert rows until `target`
    NEW jobs have been queued — or we've exhausted the available pages.

    Idempotent: conflicts on tmdb_id are silently skipped. The cursor advances
    only after a page completes, so a crash mid-walk simply re-reads that
    page next time (harmless, deduped).
    """
    if target <= 0:
        return 0

    pool = await get_pool()
    await _ensure_unique_constraint(pool)

    cursor = _load_cursor()
    key = "discover_en_vote_count_desc_gte1000"
    start_page = max(1, int(cursor.get(key, 1)))

    inserted = 0
    page = start_page
    pages_walked = 0
    async with httpx.AsyncClient() as client:
        while inserted < target and pages_walked < max_pages:
            try:
                movies = await _fetch_discover_page(client, page)
            except Exception as exc:
                logger.warning("[seed] discover page %d failed: %s", page, exc)
                page += 1
                pages_walked += 1
                continue

            if not movies:
                logger.info("[seed] discover exhausted at page %d", page)
                break

            n = await _insert_jobs(pool, movies, priority)
            inserted += n
            logger.info(
                "[seed] auto page=%d +%d (running total %d/%d)",
                page,
                n,
                inserted,
                target,
            )
            page += 1
            pages_walked += 1

            # Persist after each page so a crash doesn't redo the walk.
            cursor[key] = page
            _save_cursor(cursor)

    logger.info("[seed] auto-seed done. %d new jobs queued (target=%d).", inserted, target)
    return inserted


async def seed(
    *,
    endpoint: str,
    pages: int,
    priority: int,
    discover: bool = False,
) -> None:
    pool = await get_pool()
    await _ensure_unique_constraint(pool)

    total_inserted = 0
    async with httpx.AsyncClient() as client:
        for page in range(1, pages + 1):
            try:
                if discover:
                    movies = await _fetch_discover_page(client, page)
                else:
                    movies = await _fetch_tmdb_page(client, endpoint, page)
            except Exception as exc:
                logger.warning("[seed] page %d failed: %s", page, exc)
                continue
            n = await _insert_jobs(pool, movies, priority)
            total_inserted += n
            logger.info("[seed] page %d/%d: +%d jobs (priority=%d)", page, pages, n, priority)

    await close_pool()
    logger.info("[seed] done. %d new jobs queued.", total_inserted)


def main() -> None:
    logging.basicConfig(level="INFO", format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--pages",
        type=int,
        default=13,
        help="TMDB pages to fetch (20 movies/page; 13 ≈ 250).",
    )
    parser.add_argument(
        "--backlog",
        action="store_true",
        help="Pull from /movie/popular at priority=1 instead of /movie/top_rated at priority=0.",
    )
    parser.add_argument(
        "--discover",
        action="store_true",
        help="Pull from /discover/movie sorted by vote_count.desc, English "
             "originals only, at priority=2. Use this to grow the catalog "
             "past the top 250 (50 pages ≈ 1000 well-known films).",
    )
    args = parser.parse_args()

    if args.discover:
        endpoint = "discover"
        priority = 2
    elif args.backlog:
        endpoint = "popular"
        priority = 1
    else:
        endpoint = "top_rated"
        priority = 0

    try:
        asyncio.run(seed(
            endpoint=endpoint,
            pages=args.pages,
            priority=priority,
            discover=args.discover,
        ))
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
