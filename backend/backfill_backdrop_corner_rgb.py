"""
Issue #115 — fill `movies.backdrop_corner_rgb` for the existing catalogue.

The home card's add-to-list glyph picks its ink by contrast against the colour
behind it (`cardVisuals.pickPlusInk`, shipped). This script computes that
colour for every movie that does not have one: TMDB details -> `backdrop_path`
-> the w300 still -> the average of its top 26% x trailing 20% patch, packed
into one integer by `src/services/backdrop_ink.py`.

Idempotent and resumable
------------------------
The work list is `WHERE backdrop_corner_rgb IS NULL`, re-read on every run, so
an interrupted run resumes exactly where it stopped and a completed run does
nothing. There is deliberately no "attempted" marker: a movie whose still is
missing or undecodable stays NULL forever and is retried by the next run. That
is a handful of wasted requests against the alternative — a second column whose
only job is to remember a failure — and it means a still TMDB adds later gets
picked up for free.

Rate limiting
-------------
Two hosts, both paced by `--concurrency` (default 4) plus a small per-movie
delay: api.themoviedb.org for the details lookup and image.tmdb.org for the
still. 4,569 movies at the default settings is roughly 10 minutes. Raise it
only if you are willing to explain a 429 to TMDB.

Usage
-----
    export DATABASE_URL=...        # the *public* URL from Railway, not internal
    export TMDB_API_KEY=...
    python backfill_backdrop_corner_rgb.py [--limit N] [--concurrency N] [--dry-run]

`--dry-run` computes and reports but writes nothing, which is the cheap way to
confirm the credentials and the patch maths before touching 4,585 rows.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time
from typing import List, Optional, Tuple

import asyncpg
import httpx

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from src.services.backdrop_ink import compute_corner_rgb, unpack_rgb  # noqa: E402

# Enough of a gap that a burst of workers cannot stack requests onto TMDB
# faster than it likes, without making the whole run an afternoon.
PER_MOVIE_DELAY = 0.05


async def _load_pending(conn: asyncpg.Connection, limit: Optional[int]) -> List[Tuple[int, int]]:
    """Movies still missing a corner colour, oldest id first.

    Only two columns are selected. `movies` carries description text, and
    pulling whole rows into Python to filter them is the exact shape #145 had
    to undo elsewhere in this repo.
    """
    sql = (
        "SELECT id, tmdb_id FROM movies "
        "WHERE tmdb_id IS NOT NULL AND backdrop_corner_rgb IS NULL "
        "ORDER BY id"
    )
    if limit:
        sql += f" LIMIT {int(limit)}"
    rows = await conn.fetch(sql)
    return [(r["id"], r["tmdb_id"]) for r in rows]


async def _coverage(conn: asyncpg.Connection) -> Tuple[int, int, int]:
    row = await conn.fetchrow(
        "SELECT COUNT(*) AS total, "
        "       COUNT(tmdb_id) AS with_tmdb, "
        "       COUNT(backdrop_corner_rgb) AS with_rgb "
        "FROM movies"
    )
    return row["total"], row["with_tmdb"], row["with_rgb"]


async def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill movies.backdrop_corner_rgb (#115)")
    parser.add_argument("--limit", type=int, default=None, help="stop after N movies")
    parser.add_argument("--concurrency", type=int, default=4, help="movies in flight at once")
    parser.add_argument("--dry-run", action="store_true", help="compute but do not write")
    args = parser.parse_args()

    db_url = os.environ.get(
        "DATABASE_URL",
        "postgresql://wordwise_user:wordwise_password@localhost:5432/wordwise_db",
    ).replace("postgres://", "postgresql://", 1)

    conn = await asyncpg.connect(db_url)
    try:
        total, with_tmdb, with_rgb = await _coverage(conn)
        pending = await _load_pending(conn, args.limit)
        print(
            f"Catalogue: {total} movies, {with_tmdb} with a tmdb_id, "
            f"{with_rgb} already coloured."
        )
        print(f"To do this run: {len(pending)}"
              f"{' (dry run — nothing will be written)' if args.dry_run else ''}")
        if not pending:
            return

        stored = 0
        no_backdrop = 0
        gate = asyncio.Semaphore(max(1, args.concurrency))
        done = 0
        started = time.monotonic()

        # One connection pool for every still, rather than a TLS handshake per
        # movie. Keepalives are sized to the worker count so the pool is not
        # tearing connections down between batches.
        limits = httpx.Limits(
            max_keepalive_connections=args.concurrency,
            max_connections=args.concurrency * 2,
        )
        async with httpx.AsyncClient(limits=limits, follow_redirects=True) as client:

            async def handle(movie_id: int, tmdb_id: int) -> None:
                nonlocal stored, no_backdrop, done
                async with gate:
                    try:
                        packed = await compute_corner_rgb(tmdb_id, client=client)
                    except Exception as exc:  # noqa: BLE001 - one movie, not the run
                        print(f"  ! #{movie_id} tmdb={tmdb_id}: {exc}")
                        packed = None
                    if packed is None:
                        no_backdrop += 1
                    else:
                        if not args.dry_run:
                            await conn.execute(
                                "UPDATE movies SET backdrop_corner_rgb = $1 WHERE id = $2",
                                packed,
                                movie_id,
                            )
                        stored += 1
                    done += 1
                    if done % 100 == 0:
                        rate = done / max(0.001, time.monotonic() - started)
                        print(f"  …{done}/{len(pending)}  ({rate:.1f}/s)")
                    await asyncio.sleep(PER_MOVIE_DELAY)

            await asyncio.gather(*(handle(mid, tid) for mid, tid in pending))

        elapsed = time.monotonic() - started
        print(
            f"Done in {elapsed:.0f}s. coloured={stored} no_usable_backdrop={no_backdrop}"
        )
        if not args.dry_run:
            _, _, now_with_rgb = await _coverage(conn)
            pct = 100.0 * now_with_rgb / total if total else 0.0
            print(f"Coverage: {now_with_rgb}/{total} ({pct:.1f}%)")
            sample = await conn.fetchval(
                "SELECT backdrop_corner_rgb FROM movies "
                "WHERE backdrop_corner_rgb IS NOT NULL ORDER BY id LIMIT 1"
            )
            print(f"Sample stored value: {sample} -> {unpack_rgb(sample)}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
