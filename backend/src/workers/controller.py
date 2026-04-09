"""
Adaptive rate controller (AIMD).

Runs as a single long-lived process alongside the worker pool:

    python -m src.workers.controller

Every CONTROL_INTERVAL seconds it scans the last WINDOW seconds of
api_events and decides whether to nudge target_qps up or down.

  - Steady state (low error rate, healthy latency)
        target_qps += ADDITIVE_STEP   (additive increase)
  - Distress (timeouts, 429s, 5xx, latency spike)
        target_qps *= MULTIPLICATIVE_DECREASE  (multiplicative decrease)

This is the same shape as TCP congestion control: small careful steps up,
big immediate steps down. The whole point is that we don't pick a "right"
QPS — we let the upstream APIs tell us, indirectly, by how often they fail.

The controller also reaps stuck jobs (workers that crashed mid-run) and
prunes old api_events so the table doesn't grow forever.
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys
from dataclasses import dataclass
from typing import Optional

import asyncpg

from . import queue as q
from . import rate
from .db import close_pool, get_pool

logger = logging.getLogger("wordwise.controller")

# How often to wake up and decide.
CONTROL_INTERVAL = float(os.environ.get("CONTROLLER_INTERVAL", "5"))
# Sliding window we look at to make a decision.
WINDOW_SECONDS = float(os.environ.get("CONTROLLER_WINDOW", "30"))

# AIMD knobs. Conservative defaults — tune via env, not code edits.
ADDITIVE_STEP_QPS = float(os.environ.get("CONTROLLER_AI_STEP", "0.05"))
MULTIPLICATIVE_DECREASE = float(os.environ.get("CONTROLLER_MD_FACTOR", "0.5"))

# Distress thresholds. Any one of these triggers a multiplicative decrease.
ERROR_RATE_DECREASE = float(os.environ.get("CONTROLLER_ERR_RATE", "0.10"))   # 10% errors
P95_LATENCY_DECREASE_MS = int(os.environ.get("CONTROLLER_P95_MS", "8000"))  # 8s p95

# Don't increase faster than this when the bucket is healthy but underused.
# (If nothing is calling APIs, AIMD has no signal — keep target steady.)
MIN_SAMPLES_FOR_INCREASE = int(os.environ.get("CONTROLLER_MIN_SAMPLES", "5"))


@dataclass
class WindowStats:
    total: int
    successes: int
    errors: int
    rate_limited: int
    timeouts: int
    p95_latency_ms: Optional[int]

    @property
    def error_rate(self) -> float:
        if self.total == 0:
            return 0.0
        return self.errors / self.total


async def collect_window(pool: asyncpg.Pool) -> WindowStats:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"""
            SELECT
                COUNT(*)::int                                                  AS total,
                COUNT(*) FILTER (WHERE success)::int                            AS successes,
                COUNT(*) FILTER (WHERE NOT success)::int                        AS errors,
                COUNT(*) FILTER (WHERE error_kind = 'rate_limited')::int        AS rate_limited,
                COUNT(*) FILTER (WHERE error_kind = 'timeout')::int             AS timeouts,
                PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::int  AS p95
              FROM api_events
             WHERE occurred_at > now() - interval '{WINDOW_SECONDS} seconds'
            """
        )
        return WindowStats(
            total=row["total"] or 0,
            successes=row["successes"] or 0,
            errors=row["errors"] or 0,
            rate_limited=row["rate_limited"] or 0,
            timeouts=row["timeouts"] or 0,
            p95_latency_ms=row["p95"],
        )


def decide_next_qps(current: float, stats: WindowStats) -> tuple[float, str]:
    """
    Pure function of the current QPS and the window stats.

    Distress beats everything. If we see *any* 429s in the window we cut
    immediately — TMDB and OpenSubtitles are stingy and you only get one
    chance to back off before they start blocking.
    """
    if stats.rate_limited > 0:
        return current * MULTIPLICATIVE_DECREASE, "rate_limited"
    if stats.error_rate >= ERROR_RATE_DECREASE and stats.total >= MIN_SAMPLES_FOR_INCREASE:
        return current * MULTIPLICATIVE_DECREASE, f"err_rate={stats.error_rate:.2f}"
    if stats.p95_latency_ms and stats.p95_latency_ms > P95_LATENCY_DECREASE_MS:
        return current * MULTIPLICATIVE_DECREASE, f"p95={stats.p95_latency_ms}ms"

    if stats.total >= MIN_SAMPLES_FOR_INCREASE and stats.errors == 0:
        return current + ADDITIVE_STEP_QPS, "ai"

    return current, "hold"


async def prune_old_events(pool: asyncpg.Pool) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM api_events WHERE occurred_at < now() - interval '1 hour'"
        )


async def run_controller() -> None:
    logger.info("[controller] starting interval=%ss window=%ss", CONTROL_INTERVAL, WINDOW_SECONDS)
    pool = await get_pool()

    stop = asyncio.Event()

    def _handle_signal(*_):
        logger.info("[controller] shutdown signal received")
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _handle_signal)
        except NotImplementedError:
            signal.signal(sig, _handle_signal)

    tick = 0
    while not stop.is_set():
        try:
            stats = await collect_window(pool)
            current = (await rate.get_rate_state(pool)).target_qps
            new_qps, reason = decide_next_qps(current, stats)

            if abs(new_qps - current) > 1e-9:
                applied = await rate.set_target_qps(pool, new_qps)
                logger.info(
                    "[controller] qps %.3f -> %.3f (%s) | total=%d ok=%d err=%d 429=%d to=%d p95=%sms",
                    current,
                    applied.target_qps,
                    reason,
                    stats.total,
                    stats.successes,
                    stats.errors,
                    stats.rate_limited,
                    stats.timeouts,
                    stats.p95_latency_ms,
                )
            else:
                logger.debug(
                    "[controller] qps=%.3f hold | total=%d err=%d",
                    current,
                    stats.total,
                    stats.errors,
                )

            # Periodic housekeeping (every ~minute).
            tick += 1
            if tick % max(1, int(60 / CONTROL_INTERVAL)) == 0:
                reaped = await q.reap_stuck_jobs(pool)
                if reaped:
                    logger.warning("[controller] reaped %d stuck jobs", reaped)
                await prune_old_events(pool)
                qstats = await q.queue_stats(pool)
                logger.info("[controller] queue=%s", qstats)

        except Exception as exc:
            logger.exception("[controller] tick failed: %s", exc)

        try:
            await asyncio.wait_for(stop.wait(), timeout=CONTROL_INTERVAL)
        except asyncio.TimeoutError:
            pass

    await close_pool()
    logger.info("[controller] stopped")


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("WORKER_LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    try:
        asyncio.run(run_controller())
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
