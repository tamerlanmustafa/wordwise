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
from datetime import datetime, timedelta, timezone
import json
import logging
import os
import sys
from typing import Iterable

import asyncpg
import httpx

from .db import close_pool, get_pool

# The walk's position now lives in `seed_cursor` (see _load_page). It was a
# file here, which a container throws away on every deploy.


async def _load_page(pool, key: str) -> int:
    """Where this walk got to, from the database.

    It used to be a JSON file next to the code. The worker container has no
    volume, so every deploy — several a day, since the Worker redeploys on
    each push to main — reset the walk to page 1, whose films have all been
    queued for months. The insert deduped them to nothing and prod logged
    "auto-seeded 0 new jobs" for ever; the catalogue could not grow.
    """
    try:
        row = await pool.fetchrow(
            "SELECT next_page FROM seed_cursor WHERE key = $1", key
        )
        return max(1, int(row["next_page"])) if row else 1
    except Exception as exc:
        # A missing cursor costs a re-walk of already-queued pages, which is
        # wasted TMDB calls and nothing worse. Never a reason to stop seeding.
        logger.warning("[seed] could not read cursor %s: %s", key, exc)
        return 1


async def _save_page(pool, key: str, next_page: int) -> None:
    try:
        await pool.execute(
            """
            INSERT INTO seed_cursor (key, next_page, updated_at)
            VALUES ($1, $2, now())
            ON CONFLICT (key) DO UPDATE
               SET next_page = EXCLUDED.next_page, updated_at = now()
            """,
            key,
            int(next_page),
        )
    except Exception as exc:
        logger.warning("[seed] failed to persist cursor %s: %s", key, exc)

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


async def _fetch_recent_page(client: httpx.AsyncClient, page: int, months: int) -> list[dict]:
    """
    Recently released English films, most popular first.

    The reason this exists as a second walk rather than a tweak to the first:
    `vote_count.desc` with `vote_count.gte=1000` is a *lifetime* popularity
    order, and a film released last month has almost no votes yet. A new
    blockbuster is the case it misses hardest — enormous future popularity,
    single-digit votes today — so it stays invisible to the pipeline for the
    months it takes to cross the threshold, which is exactly the window when
    people are searching for it.

    So: order by `popularity.desc` (TMDB's own trending signal, which reacts
    in days rather than years) and bound it by release date instead of votes.
    A small `vote_count.gte` still keeps out films with no audience at all —
    dropping it entirely would queue every unreleased festival entry with a
    TMDB page and no subtitles to fetch.
    """
    if not TMDB_API_KEY:
        raise RuntimeError("TMDB_API_KEY not set")
    since = (datetime.now(timezone.utc) - timedelta(days=30 * months)).date().isoformat()
    resp = await client.get(
        "https://api.themoviedb.org/3/discover/movie",
        params={
            "api_key": TMDB_API_KEY,
            "language": "en-US",
            "sort_by": "popularity.desc",
            "with_original_language": "en",
            "include_adult": "false",
            "primary_release_date.gte": since,
            "primary_release_date.lte": datetime.now(timezone.utc).date().isoformat(),
            "vote_count.gte": 25,
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

    key = "discover_en_vote_count_desc_gte1000"
    start_page = await _load_page(pool, key)

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
            await _save_page(pool, key, page)

    logger.info("[seed] auto-seed done. %d new jobs queued (target=%d).", inserted, target)
    return inserted


async def seed_recent_releases(
    *,
    months: int = 6,
    max_pages: int = 3,
    priority: int = 1,
) -> int:
    """
    Queue films released in the last `months`, most popular first.

    Deliberately NOT cursor-walked, unlike the vote_count catalogue pass. That
    one walks forward through a fixed historical ordering and must remember
    where it stopped. This one is a *window on the present*: the first page of
    "popular films from the last six months" is different today than it was
    last week, so the interesting rows are always at the front and a cursor
    would walk away from them. Re-reading page 1 every time is the point.

    Cheap to repeat because `_insert_jobs` dedupes on tmdb_id — a pass that
    finds nothing new inserts nothing and costs three TMDB calls.

    Priority 1, above the discover backlog (2) and below the curated top 250
    (0): a film people are searching for right now is worth processing before
    the long tail of the catalogue, but not before the canon.
    """
    pool = await get_pool()
    await _ensure_unique_constraint(pool)

    inserted = 0
    async with httpx.AsyncClient() as client:
        for page in range(1, max_pages + 1):
            try:
                movies = await _fetch_recent_page(client, page, months)
            except Exception as exc:
                logger.warning("[seed] recent page %d failed: %s", page, exc)
                continue
            if not movies:
                break
            n = await _insert_jobs(pool, movies, priority)
            inserted += n
            logger.info("[seed] recent page=%d +%d new", page, n)

    logger.info("[seed] recent-release pass done. %d new jobs queued.", inserted)
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
