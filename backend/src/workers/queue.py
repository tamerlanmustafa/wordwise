"""
Postgres-backed job queue primitives.

There is intentionally no in-memory queue, no Redis, no Celery. The whole
job table fits comfortably in Postgres and `FOR UPDATE SKIP LOCKED` gives us
exactly-once-per-claim semantics across as many worker processes as we want
to run, with zero coordination outside the database.

Backoff schedule (seconds): 30 → 120 → 480 → 1800 → 3600 (cap), each with
±20% jitter so concurrent failures don't synchronize their retries.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Optional

import asyncpg

# Indexed by attempts-already-made (so attempts=0 → first retry waits 30s).
_BACKOFF_SECONDS = [30, 120, 480, 1800, 3600]
_MAX_ATTEMPTS = 6  # after this many failures the job is parked as 'dead'


def backoff_seconds(attempts: int) -> int:
    base = _BACKOFF_SECONDS[min(attempts, len(_BACKOFF_SECONDS) - 1)]
    jitter = random.uniform(0.8, 1.2)
    return int(base * jitter)


@dataclass
class Job:
    id: int
    tmdb_id: int
    title: str
    year: Optional[int]
    priority: int
    attempts: int
    movie_id: Optional[int]


async def claim_one(pool: asyncpg.Pool, worker_id: str) -> Optional[Job]:
    """
    Atomically claim the highest-priority due job.

    Uses SKIP LOCKED so concurrent workers never see the same row, and never
    block each other waiting on the queue head. The transaction is held only
    for the duration of the UPDATE — microseconds.
    """
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                SELECT id, tmdb_id, title, year, priority, attempts, movie_id
                  FROM movie_jobs
                 WHERE status = 'pending'
                   AND run_after <= now()
                 ORDER BY priority ASC, run_after ASC, id ASC
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED
                """
            )
            if row is None:
                return None
            await conn.execute(
                """
                UPDATE movie_jobs
                   SET status = 'running',
                       claimed_by = $2,
                       claimed_at = now(),
                       updated_at = now()
                 WHERE id = $1
                """,
                row["id"],
                worker_id,
            )
            return Job(
                id=row["id"],
                tmdb_id=row["tmdb_id"],
                title=row["title"],
                year=row["year"],
                priority=row["priority"],
                attempts=row["attempts"],
                movie_id=row["movie_id"],
            )


async def mark_done(
    pool: asyncpg.Pool,
    job_id: int,
    *,
    movie_id: Optional[int],
    vocab_count: Optional[int],
) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE movie_jobs
               SET status = 'done',
                   finished_at = now(),
                   updated_at = now(),
                   movie_id = COALESCE($2, movie_id),
                   vocab_count = $3,
                   last_error = NULL
             WHERE id = $1
            """,
            job_id,
            movie_id,
            vocab_count,
        )


async def mark_failed(
    pool: asyncpg.Pool,
    job_id: int,
    attempts_so_far: int,
    error: str,
) -> None:
    """
    Either schedules a retry (status -> pending, run_after in the future)
    or parks the job as 'dead' once we've exhausted attempts.
    """
    new_attempts = attempts_so_far + 1
    truncated_error = (error or "")[:1000]

    if new_attempts >= _MAX_ATTEMPTS:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE movie_jobs
                   SET status = 'dead',
                       attempts = $2,
                       finished_at = now(),
                       updated_at = now(),
                       last_error = $3
                 WHERE id = $1
                """,
                job_id,
                new_attempts,
                truncated_error,
            )
        return

    delay = backoff_seconds(new_attempts - 1)
    async with pool.acquire() as conn:
        await conn.execute(
            f"""
            UPDATE movie_jobs
               SET status = 'pending',
                   attempts = $2,
                   run_after = now() + interval '{delay} seconds',
                   claimed_by = NULL,
                   claimed_at = NULL,
                   updated_at = now(),
                   last_error = $3
             WHERE id = $1
            """,
            job_id,
            new_attempts,
            truncated_error,
        )


async def reap_stuck_jobs(pool: asyncpg.Pool, stale_after_seconds: int = 1800) -> int:
    """
    A worker that crashed mid-job leaves its row in 'running' forever.
    The controller calls this periodically to put orphans back on the queue.
    """
    async with pool.acquire() as conn:
        result = await conn.execute(
            f"""
            UPDATE movie_jobs
               SET status = 'pending',
                   claimed_by = NULL,
                   claimed_at = NULL,
                   updated_at = now()
             WHERE status = 'running'
               AND claimed_at < now() - interval '{stale_after_seconds} seconds'
            """
        )
        # asyncpg returns 'UPDATE n'
        try:
            return int(result.split()[-1])
        except Exception:
            return 0


async def queue_stats(pool: asyncpg.Pool) -> dict:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT status, COUNT(*)::int AS n FROM movie_jobs GROUP BY status"
        )
        return {r["status"]: r["n"] for r in rows}
