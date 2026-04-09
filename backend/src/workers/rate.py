"""
Token bucket + AIMD rate limiter shared across all workers via Postgres.

The token bucket lives in a single row of `rate_state`. Workers acquire one
token per outbound API call by atomically refilling and decrementing inside
a SELECT ... FOR UPDATE transaction. The controller separately observes
api_events and tunes `target_qps` (the bucket's refill rate) up or down.

Why a Postgres row instead of Redis or in-process state?
  - We already have Postgres. One fewer moving piece.
  - The transaction gives us atomic refill+decrement for free.
  - The contention is trivial: ~1 short row lock per outbound API call.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Optional

import asyncpg


@dataclass
class RateState:
    target_qps: float
    tokens: float
    max_qps: float
    min_qps: float


async def get_rate_state(pool: asyncpg.Pool) -> RateState:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT target_qps, tokens, max_qps, min_qps FROM rate_state WHERE id = 1"
        )
        if row is None:
            raise RuntimeError("rate_state row missing — did you run schema.sql?")
        return RateState(
            target_qps=row["target_qps"],
            tokens=row["tokens"],
            max_qps=row["max_qps"],
            min_qps=row["min_qps"],
        )


async def acquire_token(pool: asyncpg.Pool) -> None:
    """
    Block until a token is available, then consume one.

    The wait is computed from the current target_qps each iteration, so a
    controller-driven slowdown takes effect immediately for any worker that
    happens to be sleeping.
    """
    while True:
        async with pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    """
                    SELECT target_qps, tokens, max_qps, last_refill
                      FROM rate_state
                     WHERE id = 1
                     FOR UPDATE
                    """
                )
                target_qps = float(row["target_qps"])
                tokens = float(row["tokens"])
                max_qps = float(row["max_qps"])

                # Refill: tokens accrue at target_qps per second since last touch.
                # Bucket capacity caps at max(1, target_qps) so a brief idle
                # window doesn't let one worker burst the entire backlog.
                elapsed = await conn.fetchval(
                    "SELECT EXTRACT(EPOCH FROM (now() - $1))::float", row["last_refill"]
                )
                bucket_capacity = max(1.0, target_qps)
                tokens = min(bucket_capacity, tokens + elapsed * target_qps)

                if tokens >= 1.0:
                    tokens -= 1.0
                    await conn.execute(
                        """
                        UPDATE rate_state
                           SET tokens = $1,
                               last_refill = now(),
                               updated_at = now()
                         WHERE id = 1
                        """,
                        tokens,
                    )
                    return

                # Not enough — write back the partial refill so the next
                # caller doesn't double-count time, then sleep until the
                # next token is mathematically due.
                await conn.execute(
                    """
                    UPDATE rate_state
                       SET tokens = $1,
                           last_refill = now(),
                           updated_at = now()
                     WHERE id = 1
                    """,
                    tokens,
                )
                deficit = 1.0 - tokens
                # Guard against target_qps == 0 (paused worker pool).
                qps_floor = max(target_qps, 1e-3)
                wait = deficit / qps_floor

        await asyncio.sleep(min(wait, 5.0))


async def set_target_qps(pool: asyncpg.Pool, new_target: float) -> RateState:
    """Clamp to [min_qps, max_qps] and persist. Used by the controller."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE rate_state
               SET target_qps = LEAST(max_qps, GREATEST(min_qps, $1)),
                   updated_at = now()
             WHERE id = 1
            RETURNING target_qps, tokens, max_qps, min_qps
            """,
            new_target,
        )
        return RateState(
            target_qps=row["target_qps"],
            tokens=row["tokens"],
            max_qps=row["max_qps"],
            min_qps=row["min_qps"],
        )


async def record_event(
    pool: asyncpg.Pool,
    *,
    success: bool,
    status_code: Optional[int],
    latency_ms: Optional[int],
    error_kind: Optional[str] = None,
) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO api_events (success, status_code, latency_ms, error_kind)
            VALUES ($1, $2, $3, $4)
            """,
            success,
            status_code,
            latency_ms,
            error_kind,
        )
