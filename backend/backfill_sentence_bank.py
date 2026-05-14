"""
One-shot: populate SentenceBank + SentenceLemmaLink for every movie that has
classifications but no indexed sentences yet.

Translation-free (pure spaCy + DB writes). Idempotent — re-running only
processes movies still missing data.

Run from the backend/ directory with the interpreter that has Prisma installed
(typically python3.11 on this machine — `python3` resolves to Apple's 3.9):

    cd backend
    python3.11 backfill_sentence_bank.py            # all missing movies
    python3.11 backfill_sentence_bank.py --limit 50 # cap for a smoke run
    python3.11 backfill_sentence_bank.py --movie 123  # single movie

Cost per movie: a few seconds of spaCy + ~hundreds of small DB writes. No
LLM calls.
"""
import argparse
import asyncio
import logging
import time
from typing import List

from prisma import Prisma

from src.services.sentence_bank_service import (
    populate_movie_sentence_bank,
    fill_movie_sentence_bank_gaps,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("backfill_sentence_bank")


async def fetch_target_movie_ids(
    db: Prisma,
    single: int | None,
    limit: int | None,
    *,
    fill_gaps: bool = False,
) -> List[int]:
    """
    Default mode: movies with classifications but no SentenceBank entries.
    fill_gaps mode: movies with both classifications AND existing SentenceBank
    rows (i.e., already-indexed movies that may have coverage gaps to fill).
    """
    if single is not None:
        return [single]

    if fill_gaps:
        sql = """
            SELECT DISTINCT ms.movie_id
            FROM movie_scripts ms
            JOIN word_classifications wc ON wc.script_id = ms.id
            WHERE EXISTS (
              SELECT 1 FROM sentence_bank sb WHERE sb.movie_id = ms.movie_id
            )
            ORDER BY ms.movie_id
        """
    else:
        sql = """
            SELECT DISTINCT ms.movie_id
            FROM movie_scripts ms
            JOIN word_classifications wc ON wc.script_id = ms.id
            WHERE NOT EXISTS (
              SELECT 1 FROM sentence_bank sb WHERE sb.movie_id = ms.movie_id
            )
            ORDER BY ms.movie_id
        """
    rows = await db.query_raw(sql + (f" LIMIT {int(limit)}" if limit else ""))
    return [int(r["movie_id"]) for r in rows]


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="Cap movies processed this run")
    parser.add_argument("--movie", type=int, default=None, help="Process a single movie id")
    parser.add_argument(
        "--fill-gaps",
        action="store_true",
        help="Run gap-filler on already-indexed movies instead of indexing new ones. Adds links for classified words that didn't get one from the spaCy pass; does not re-index sentences.",
    )
    args = parser.parse_args()

    db = Prisma()
    await db.connect()
    try:
        movie_ids = await fetch_target_movie_ids(
            db, args.movie, args.limit, fill_gaps=args.fill_gaps,
        )
        mode = "fill-gaps" if args.fill_gaps else "populate"
        logger.info(f"Processing {len(movie_ids)} movie(s) in {mode} mode")

        ok = 0
        skipped = 0
        failed = 0
        t_start = time.perf_counter()

        for i, movie_id in enumerate(movie_ids, 1):
            t0 = time.perf_counter()
            try:
                if args.fill_gaps:
                    stats = await fill_movie_sentence_bank_gaps(db, movie_id)
                else:
                    stats = await populate_movie_sentence_bank(db, movie_id)
                elapsed = (time.perf_counter() - t0) * 1000
                status = stats.get("status")
                if status in ("populated", "filled"):
                    ok += 1
                    if status == "populated":
                        logger.info(
                            f"[{i}/{len(movie_ids)}] movie={movie_id} ok in {elapsed:.0f}ms — "
                            f"lemmas={stats.get('lemmas_resolved')} "
                            f"with_sentences={stats.get('lemmas_with_sentences')} "
                            f"sentences={stats.get('sentences_created')} "
                            f"links={stats.get('links_created')}"
                        )
                    else:
                        logger.info(
                            f"[{i}/{len(movie_ids)}] movie={movie_id} filled in {elapsed:.0f}ms — "
                            f"new_sentences={stats.get('sentences_created')} "
                            f"reused_sentences={stats.get('sentences_reused')} "
                            f"new_links={stats.get('links_created')}"
                        )
                else:
                    skipped += 1
                    logger.info(f"[{i}/{len(movie_ids)}] movie={movie_id} skipped ({status}) in {elapsed:.0f}ms")
            except Exception as e:
                failed += 1
                logger.error(f"[{i}/{len(movie_ids)}] movie={movie_id} FAILED: {e}", exc_info=True)

        total = time.perf_counter() - t_start
        logger.info(
            f"Done in {total:.1f}s — populated={ok} skipped={skipped} failed={failed}"
        )
    finally:
        await db.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
