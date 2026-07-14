"""
One-off: revive 'dead' movie_jobs so the worker retries them.

Run this during a *burst* (see DEPLOYMENT.md → "Worker scaling mode") after a
fix that resolves whatever parked the jobs — e.g. the 2026-07 incident, where
571 transiently-failed jobs were misclassified as permanent 'dead'. It only
touches rows still in 'dead' and is safe to re-run.

    python -m src.workers.requeue_dead                    # revive every dead job
    python -m src.workers.requeue_dead --like '%sources%' # only outage deaths
    python -m src.workers.requeue_dead --limit 100        # pace a big backlog
    python -m src.workers.requeue_dead --dry-run          # count, change nothing
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from typing import Optional

from . import queue as q
from .db import close_pool, get_pool

logger = logging.getLogger("wordwise.requeue_dead")


async def requeue_dead(
    *,
    limit: Optional[int],
    like: Optional[str],
    dry_run: bool,
) -> int:
    pool = await get_pool()
    try:
        n = await q.requeue_dead(pool, limit=limit, like=like, dry_run=dry_run)
    finally:
        await close_pool()

    verb = "would revive" if dry_run else "revived"
    logger.info("[requeue_dead] %s %d dead job(s)%s.", verb, n, " (dry run)" if dry_run else "")
    return n


def main() -> None:
    logging.basicConfig(level="INFO", format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Revive 'dead' movie_jobs for retry.")
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Cap how many dead jobs to revive in this run (default: all).",
    )
    parser.add_argument(
        "--like",
        type=str,
        default=None,
        help="Only revive jobs whose last_error ILIKE this pattern, "
             "e.g. '%%sources%%' for the transient-outage deaths.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report how many jobs would be revived without changing anything.",
    )
    args = parser.parse_args()

    try:
        asyncio.run(requeue_dead(limit=args.limit, like=args.like, dry_run=args.dry_run))
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
