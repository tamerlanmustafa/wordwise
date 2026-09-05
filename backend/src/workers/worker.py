"""
Worker process entrypoint.

Run multiple of these (one per CPU core is plenty — they spend most of
their time waiting on network I/O):

    python -m src.workers.worker

Each instance picks a random worker_id, opens its own asyncpg pool and
shared httpx client, and loops forever:

    1. claim a job (or sleep briefly if the queue is empty)
    2. process_job(...)
    3. mark_done / mark_failed
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import signal
import socket
import sys
import uuid

import httpx

from ..logging_config import configure_logging, request_id_ctx
from ..services.admin_alerts import ConsecutiveFailureAlerter
from . import queue as q
from .db import close_pool, get_pool
from .processor import PermanentError, TransientError, process_job
from .seed import seed_discover_until, seed_recent_releases

logger = logging.getLogger("wordwise.worker")

EMPTY_QUEUE_SLEEP = float(os.environ.get("WORKER_IDLE_SLEEP", "5"))

# How many fresh popular English films to auto-seed on worker start. Walks
# TMDB /discover sorted by vote_count.desc from a persistent page cursor
# (.seed_cursor.json) so each burst grows the catalog without re-fetching
# pages we've already drained.
#
# Defaults to 0 because the MVP runs "burst → tiny always-on" (see
# DEPLOYMENT.md → "Worker scaling mode"): the steady worker is a small
# instance that must NOT balloon to ~2 GB by seeding + classifying films on
# every restart/deploy. To grow the catalog, run a *burst*: set
# WORKER_SEED_ON_START=<N> (and give the instance ~2 GB) for one run, let the
# queue drain, then scale back down and clear the env var.
WORKER_SEED_ON_START = int(os.environ.get("WORKER_SEED_ON_START", "0"))

# How often to re-check TMDB for films released since the last look, in hours.
# 0 disables it.
#
# Separate from WORKER_SEED_ON_START because the two answer different
# questions. That one grows the *back* catalogue and is a burst you turn on
# deliberately, because classifying a few hundred films needs ~2 GB. This one
# is a small, standing window on new releases: three TMDB pages, deduped on
# tmdb_id, so a pass that finds nothing costs three requests and inserts
# nothing. Twelve hours because cinema does not move faster than that, and a
# film needs a few days to pick up the votes and the subtitles the pipeline
# wants anyway.
RECENT_SEED_INTERVAL_HOURS = float(os.environ.get("WORKER_RECENT_SEED_HOURS", "12"))
RECENT_SEED_MONTHS = int(os.environ.get("WORKER_RECENT_SEED_MONTHS", "6"))


async def run_worker() -> None:
    worker_id = f"{socket.gethostname()}-{os.getpid()}-{uuid.uuid4().hex[:6]}"
    logger.info("[worker] starting id=%s", worker_id)

    pool = await get_pool()
    stop = asyncio.Event()

    # Top up the queue before starting the claim loop so the worker always
    # has work to do on restart. Safe to run on every start — it's
    # idempotent (unique tmdb_id) and the page cursor prevents re-walks.
    if WORKER_SEED_ON_START > 0:
        try:
            n = await seed_discover_until(WORKER_SEED_ON_START)
            logger.info("[worker] auto-seeded %d new jobs", n)
        except Exception as exc:
            logger.warning("[worker] auto-seed failed (continuing anyway): %s", exc)

    async def _recent_seed_loop() -> None:
        """Keep an eye on new releases for as long as the worker runs.

        The catalogue walk only ran at startup, so "check for new films" meant
        "redeploy" — and since the cursor did not survive a deploy either, it
        did not even mean that. A film released this month has too few votes
        for the vote_count pass to ever see it.

        Failures are logged and slept off rather than raised: this loop must
        never be the reason the container exits, because the process that
        actually drains the queue is running beside it.
        """
        while not stop.is_set():
            try:
                n = await seed_recent_releases(months=RECENT_SEED_MONTHS)
                if n:
                    logger.info("[worker] recent-release seed queued %d new films", n)
            except Exception as exc:
                logger.warning("[worker] recent-release seed failed: %s", exc)
            try:
                await asyncio.wait_for(
                    stop.wait(), timeout=RECENT_SEED_INTERVAL_HOURS * 3600
                )
            except asyncio.TimeoutError:
                pass

    recent_task = (
        asyncio.create_task(_recent_seed_loop())
        if RECENT_SEED_INTERVAL_HOURS > 0
        else None
    )

    def _handle_signal(*_):
        logger.info("[worker] shutdown signal received")
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _handle_signal)
        except NotImplementedError:
            # Windows
            signal.signal(sig, _handle_signal)

    # Email admins when claims fail back-to-back (~1 min stuck at threshold
    # 12 × EMPTY_QUEUE_SLEEP): a claim-loop failure means no jobs are being
    # processed at all, which the queue stats alone don't reveal.
    alerter = ConsecutiveFailureAlerter("movie-job-worker", fetch_rows=pool.fetch, threshold=12)

    async with httpx.AsyncClient() as client:
        while not stop.is_set():
            try:
                job = await q.claim_one(pool, worker_id)
            except Exception as exc:
                logger.exception("[worker] claim failed: %s", exc)
                await alerter.record_failure(exc)
                await asyncio.sleep(EMPTY_QUEUE_SLEEP)
                continue

            await alerter.record_success()

            if job is None:
                # Race the stop event against the idle sleep so SIGTERM
                # is responsive even when the queue is empty.
                try:
                    await asyncio.wait_for(stop.wait(), timeout=EMPTY_QUEUE_SLEEP)
                except asyncio.TimeoutError:
                    pass
                continue

            # Tag every log line emitted while this job runs (here and deep in
            # process_job) with a correlation id, mirroring the API's per-request
            # id so a single job is traceable end to end.
            token = request_id_ctx.set(f"job-{job.id}")
            try:
                logger.info(
                    "[worker] claimed job_id=%s tmdb_id=%s title=%r priority=%s attempts=%s",
                    job.id,
                    job.tmdb_id,
                    job.title,
                    job.priority,
                    job.attempts,
                )

                try:
                    result = await process_job(pool, job, client)
                    await q.mark_done(
                        pool,
                        job.id,
                        movie_id=result.movie_id,
                        vocab_count=result.vocab_count,
                    )
                    logger.info("[worker] done job_id=%s", job.id)
                except PermanentError as exc:
                    logger.warning("[worker] permanent failure job_id=%s: %s", job.id, exc)
                    # Skip straight to dead by maxing attempts.
                    await q.mark_failed(pool, job.id, attempts_so_far=99, error=str(exc))
                except TransientError as exc:
                    logger.warning("[worker] transient failure job_id=%s: %s", job.id, exc)
                    await q.mark_failed(pool, job.id, attempts_so_far=job.attempts, error=str(exc))
                except Exception as exc:
                    logger.exception("[worker] unexpected error job_id=%s: %s", job.id, exc)
                    await q.mark_failed(pool, job.id, attempts_so_far=job.attempts, error=str(exc))
            finally:
                request_id_ctx.reset(token)

    if recent_task is not None:
        # `stop` is already set, so the loop is on its way out; cancel covers
        # the case where it is mid-sleep and would otherwise hold the process
        # open for up to RECENT_SEED_INTERVAL_HOURS.
        recent_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await recent_task

    await close_pool()
    logger.info("[worker] stopped id=%s", worker_id)


def main() -> None:
    configure_logging(
        level=os.environ.get("WORKER_LOG_LEVEL", "INFO"),
        service="worker",
    )
    try:
        asyncio.run(run_worker())
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
