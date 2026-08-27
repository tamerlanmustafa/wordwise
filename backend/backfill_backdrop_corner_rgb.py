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
an interrupted run resumes where it stopped and a completed run does nothing.
There is deliberately no "attempted" marker: a movie whose still is missing or
undecodable stays NULL and is retried by the next run. That is a handful of
wasted requests against the alternative — a second column whose only job is to
remember a failure — and it means a still TMDB adds later is picked up free.

One connection, one operation at a time
---------------------------------------
An asyncpg `Connection` is not a pool. It permits exactly one operation in
flight and raises `InterfaceError: another operation is in progress` if a
second starts, so N concurrent workers sharing one connection is an error, not
a queue. Every touch of `conn` therefore goes through `_db_lock`, and writes
are batched rather than issued per movie: the fetch is the slow part, so 4,572
individual UPDATEs would be round-trip tax for nothing (the same tax #145 and
#134-#138 had to undo elsewhere in this repo).

`FLUSH_EVERY` is the resumability dial. Larger means fewer round trips and more
work repeated if the run is interrupted; 100 bounds the loss to under a minute
of fetching.

Rate limiting
-------------
Two hosts, both paced by `--concurrency` (default 4) plus a small per-movie
delay: api.themoviedb.org for the details lookup and image.tmdb.org for the
still. Raise it only if you are willing to explain a 429 to TMDB.

Usage
-----
    export DATABASE_URL=...        # the *public* URL from Railway, not internal
    export TMDB_API_KEY=...
    python backfill_backdrop_corner_rgb.py [--limit N] [--concurrency N] [--dry-run]

`--dry-run` fetches and decodes but writes nothing. Note that it therefore does
*not* exercise the write path — it is a check on credentials and on the patch
maths, not a rehearsal of the whole run.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time
from typing import Awaitable, Callable, List, Optional, Sequence, Tuple

import asyncpg
import httpx

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from src.services.backdrop_ink import compute_corner_rgb, unpack_rgb  # noqa: E402

# Enough of a gap that a burst of workers cannot stack requests onto TMDB
# faster than it likes, without making the whole run an afternoon.
PER_MOVIE_DELAY = 0.05

# Rows buffered before an UPDATE batch is issued. See the module docstring.
FLUSH_EVERY = 100

_UPDATE_SQL = "UPDATE movies SET backdrop_corner_rgb = $1 WHERE id = $2"


async def load_pending(
    conn: asyncpg.Connection, limit: Optional[int] = None
) -> List[Tuple[int, int]]:
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


async def coverage(conn: asyncpg.Connection) -> Tuple[int, int, int]:
    row = await conn.fetchrow(
        "SELECT COUNT(*) AS total, "
        "       COUNT(tmdb_id) AS with_tmdb, "
        "       COUNT(backdrop_corner_rgb) AS with_rgb "
        "FROM movies"
    )
    return row["total"], row["with_tmdb"], row["with_rgb"]


async def run_backfill(
    conn,
    pending: Sequence[Tuple[int, int]],
    compute: Callable[[int], Awaitable[Optional[int]]],
    *,
    concurrency: int = 4,
    dry_run: bool = False,
    flush_every: int = FLUSH_EVERY,
    delay: float = PER_MOVIE_DELAY,
    on_progress: Optional[Callable[[int], None]] = None,
) -> Tuple[int, int]:
    """Compute and store the corner colour for `pending`.

    Returns `(coloured, no_usable_backdrop)`. `compute` is injected so this can
    be driven without a network, and `conn` is used only through `_db_lock`
    because one asyncpg connection serves one operation at a time.
    """
    gate = asyncio.Semaphore(max(1, concurrency))
    db_lock = asyncio.Lock()
    buffer: List[Tuple[int, int]] = []
    stored = 0
    missing = 0
    done = 0

    async def flush() -> None:
        nonlocal buffer
        # The swap is synchronous — no await between the emptiness check and
        # it — so two workers reaching the threshold together cannot both take
        # the same batch. The second finds the buffer empty and returns.
        if not buffer:
            return
        batch, buffer = buffer, []
        if dry_run:
            return
        async with db_lock:
            await conn.executemany(_UPDATE_SQL, batch)

    async def handle(movie_id: int, tmdb_id: int) -> None:
        nonlocal stored, missing, done
        async with gate:
            try:
                packed = await compute(tmdb_id)
            except Exception as exc:  # noqa: BLE001 - one movie, not the run
                print(f"  ! #{movie_id} tmdb={tmdb_id}: {exc}")
                packed = None

            if packed is None:
                missing += 1
            else:
                buffer.append((packed, movie_id))
                stored += 1

            done += 1
            if len(buffer) >= flush_every:
                await flush()
            if on_progress and done % 100 == 0:
                on_progress(done)
            if delay:
                await asyncio.sleep(delay)

    await asyncio.gather(*(handle(mid, tid) for mid, tid in pending))
    await flush()
    return stored, missing


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
        total, with_tmdb, with_rgb = await coverage(conn)
        pending = await load_pending(conn, args.limit)
        print(
            f"Catalogue: {total} movies, {with_tmdb} with a tmdb_id, "
            f"{with_rgb} already coloured."
        )
        print(f"To do this run: {len(pending)}"
              f"{' (dry run — nothing will be written)' if args.dry_run else ''}")
        if not pending:
            return

        started = time.monotonic()

        def progress(done: int) -> None:
            rate = done / max(0.001, time.monotonic() - started)
            print(f"  …{done}/{len(pending)}  ({rate:.1f}/s)")

        # One connection pool for every still, rather than a TLS handshake per
        # movie. Keepalives are sized to the worker count so the pool is not
        # tearing connections down between batches.
        limits = httpx.Limits(
            max_keepalive_connections=args.concurrency,
            max_connections=args.concurrency * 2,
        )
        async with httpx.AsyncClient(limits=limits, follow_redirects=True) as client:
            stored, missing = await run_backfill(
                conn,
                pending,
                lambda tmdb_id: compute_corner_rgb(tmdb_id, client=client),
                concurrency=args.concurrency,
                dry_run=args.dry_run,
                on_progress=progress,
            )

        elapsed = time.monotonic() - started
        print(f"Done in {elapsed:.0f}s. coloured={stored} no_usable_backdrop={missing}")
        if not args.dry_run:
            _, _, now_with_rgb = await coverage(conn)
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
