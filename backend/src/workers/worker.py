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
import logging
import os
import signal
import socket
import sys
import uuid

import httpx

from . import queue as q
from .db import close_pool, get_pool
from .processor import PermanentError, TransientError, process_job

logger = logging.getLogger("wordwise.worker")

EMPTY_QUEUE_SLEEP = float(os.environ.get("WORKER_IDLE_SLEEP", "5"))


async def run_worker() -> None:
    worker_id = f"{socket.gethostname()}-{os.getpid()}-{uuid.uuid4().hex[:6]}"
    logger.info("[worker] starting id=%s", worker_id)

    pool = await get_pool()
    stop = asyncio.Event()

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

    async with httpx.AsyncClient() as client:
        while not stop.is_set():
            try:
                job = await q.claim_one(pool, worker_id)
            except Exception as exc:
                logger.exception("[worker] claim failed: %s", exc)
                await asyncio.sleep(EMPTY_QUEUE_SLEEP)
                continue

            if job is None:
                # Race the stop event against the idle sleep so SIGTERM
                # is responsive even when the queue is empty.
                try:
                    await asyncio.wait_for(stop.wait(), timeout=EMPTY_QUEUE_SLEEP)
                except asyncio.TimeoutError:
                    pass
                continue

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

    await close_pool()
    logger.info("[worker] stopped id=%s", worker_id)


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("WORKER_LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    try:
        asyncio.run(run_worker())
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
