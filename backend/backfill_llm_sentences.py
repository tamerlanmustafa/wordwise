"""
One-shot: generate global LLM example sentences for every lemma that
doesn't already have one. Sentences live in sentence_bank with
movie_id IS NULL and source='llm', linked to lemmas via
sentence_lemma_links. They're shared across every movie that contains
the lemma — paid once, reused forever.

Idempotent: only generates for lemmas with no existing global LLM row.
Legacy per-movie rows (subtitle + movie-tied LLM) are left untouched
and continue to serve their original movies via the read path.

Run from the backend/ directory:

    cd backend
    python3.11 backfill_llm_sentences.py                 # all uncovered lemmas
    python3.11 backfill_llm_sentences.py --limit 200     # cap how many lemmas
    python3.11 backfill_llm_sentences.py --batch-size 15 # words per LLM call

Spend is capped by LLM_COST_CAP_USD — the script stops cleanly when the
cap is reached. Requires ANTHROPIC_API_KEY set in the environment.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import time
from typing import Dict, List

from prisma import Prisma

from src.services.llm_sentence_service import (
    CostCapExceeded,
    LLMSentenceService,
    WordRequest,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("backfill_llm_sentences")


async def fetch_uncovered_lemmas(db: Prisma, limit: int | None) -> List[dict]:
    """
    Lemmas that don't have a global (movie_id IS NULL, source='llm') row yet.
    Only considers lemmas that actually appear in some movie's vocabulary,
    so we don't generate for words no user will ever see.
    """
    sql = """
        WITH covered AS (
            SELECT DISTINCT sll.lemma_id
            FROM sentence_lemma_links sll
            JOIN sentence_bank sb ON sb.id = sll.sentence_id
            WHERE sb.movie_id IS NULL AND sb.source = 'llm'
        ),
        used AS (
            SELECT DISTINCT lemma_id
            FROM sentence_lemma_links
        )
        SELECT
            l.id         AS lemma_id,
            l.lemma      AS lemma,
            l.cefr_level AS cefr_level
        FROM lemmas l
        JOIN used u ON u.lemma_id = l.id
        WHERE l.id NOT IN (SELECT lemma_id FROM covered)
        ORDER BY l.id
    """
    if limit is not None:
        sql += f"\nLIMIT {int(limit)}"
    return await db.query_raw(sql)


async def process_chunk(
    db: Prisma,
    llm: LLMSentenceService,
    chunk: List[dict],
) -> int:
    """Generate global LLM sentences for a chunk of lemmas. Returns stored count."""
    lemma_id_map: Dict[str, int] = {
        r["lemma"].lower(): r["lemma_id"] for r in chunk
    }
    word_reqs = [
        WordRequest(
            word=row["lemma"],
            lemma=row["lemma"],
            cefr=(str(row.get("cefr_level")) if row.get("cefr_level") else None),
        )
        for row in chunk
    ]
    results = await llm.generate_and_store(
        db,
        words=word_reqs,
        lemma_id_map=lemma_id_map,
        context="backfill",
    )
    return len(results)


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, help="Max lemmas to process")
    parser.add_argument(
        "--batch-size",
        type=int,
        default=15,
        help="Lemmas per LLM call (default 15)",
    )
    args = parser.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        logger.error("ANTHROPIC_API_KEY is not set; aborting.")
        raise SystemExit(2)

    db = Prisma()
    await db.connect()
    try:
        llm = LLMSentenceService()
        rows = await fetch_uncovered_lemmas(db, args.limit)
        logger.info(f"Targeting {len(rows)} uncovered lemmas")
        t_start = time.perf_counter()
        total_stored = 0
        for i in range(0, len(rows), args.batch_size):
            chunk = rows[i : i + args.batch_size]
            try:
                stored = await process_chunk(db, llm, chunk)
                total_stored += stored
                logger.info(
                    f"chunk {i // args.batch_size + 1}: "
                    f"asked={len(chunk)} stored={stored} cumulative={total_stored}"
                )
            except CostCapExceeded as cap_err:
                logger.warning(f"Stopping: {cap_err}")
                break
            except Exception as e:
                logger.warning(
                    f"chunk {i // args.batch_size + 1} failed: {e}", exc_info=True
                )
        elapsed = time.perf_counter() - t_start
        logger.info(
            f"Done: lemmas_stored={total_stored}/{len(rows)} elapsed={elapsed:.1f}s"
        )
    finally:
        await db.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
