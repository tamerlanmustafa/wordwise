"""
One-shot: precompute movie_scripts.idioms for scripts ingested before the
column existed (issue #106).

Without this, the first request for each of the ~4.3k already-ingested scripts
still pays the parse (2.4s for a small script, 21s for the 414 KB tail) and
holds the single NLP worker thread while it runs. Running this offline moves
that cost off the request path entirely, one movie at a time, at a moment
nobody is waiting.

Idempotent: only scripts with `idioms IS NULL` are processed, so a re-run picks
up where an interrupted run stopped. A script whose parse produces nothing is
stored as `[]`, not left NULL, so it is not retried forever.

Run from the backend/ directory with the interpreter that has Prisma installed
(typically python3.11 on this machine — `python3` resolves to Apple's 3.9):

    cd backend
    python3.11 backfill_script_idioms.py --dry-run       # count the work
    python3.11 backfill_script_idioms.py --limit 20      # smoke run
    python3.11 backfill_script_idioms.py                 # everything

Cost: spaCy only, no LLM calls and no external APIs. Expect a few seconds per
script and longer for the large tail.
"""
import argparse
import asyncio
import logging
import time
from typing import List

from prisma import Prisma

from src.services.script_idioms import compute_idioms, spacy_available, store_script_idioms

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("backfill_script_idioms")

# Prisma talks to its query engine over HTTP, so httpx logs two INFO lines per
# script. Across a full run that is ~8.6k lines of noise around the 4.3k lines
# of progress anyone monitoring the run actually needs.
logging.getLogger("httpx").setLevel(logging.WARNING)

# Smallest scripts first: they are the cheapest to parse, so an interrupted run
# still leaves the most movies fixed.
PENDING_SQL = """
    SELECT id, movie_id, COALESCE(LENGTH(cleaned_script_text), 0) AS chars
    FROM movie_scripts
    WHERE idioms IS NULL
      AND cleaned_script_text IS NOT NULL
      AND cleaned_script_text <> ''
    ORDER BY chars ASC
"""


async def fetch_pending(db: Prisma, single: int | None, limit: int | None) -> List[dict]:
    if single is not None:
        rows = await db.query_raw(
            "SELECT id, movie_id, COALESCE(LENGTH(cleaned_script_text), 0) AS chars "
            "FROM movie_scripts WHERE movie_id = $1",
            single,
        )
        return [dict(r) for r in rows]

    sql = PENDING_SQL + (f" LIMIT {int(limit)}" if limit else "")
    return [dict(r) for r in await db.query_raw(sql)]


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="Cap scripts processed this run")
    parser.add_argument("--movie", type=int, default=None, help="Process a single movie id")
    parser.add_argument("--dry-run", action="store_true", help="Report what would be parsed, write nothing")
    args = parser.parse_args()

    # Refuse to run without the model. `detect_phrasal_verbs_and_idioms` falls
    # back to substring matching when spaCy is missing — a quieter, worse
    # answer ("her makeup" → "make up") that this script would then write into
    # every row it touches. The lean CI/test env has no spacy, so this is a
    # realistic way to poison the corpus, not a theoretical one.
    if not args.dry_run and not await spacy_available():
        raise SystemExit(
            "spaCy is not available in this interpreter. Backfilling now would store "
            "substring-only matches permanently. Install spacy + en_core_web_sm first."
        )

    db = Prisma()
    await db.connect()
    try:
        pending = await fetch_pending(db, args.movie, args.limit)
        total_chars = sum(int(r["chars"]) for r in pending)
        logger.info(
            f"{len(pending)} script(s) pending, {total_chars:,} characters total"
        )

        if args.dry_run:
            for r in pending[:20]:
                logger.info(f"  would parse script={r['id']} movie={r['movie_id']} chars={r['chars']:,}")
            if len(pending) > 20:
                logger.info(f"  ... and {len(pending) - 20} more")
            logger.info("Dry run — nothing written. Re-run without --dry-run to apply.")
            return

        ok = 0
        failed = 0
        found = 0
        t_start = time.perf_counter()

        for i, row in enumerate(pending, 1):
            script_id = int(row["id"])
            t0 = time.perf_counter()
            try:
                script = await db.moviescript.find_unique(where={"id": script_id})
                if not script or not script.cleanedScriptText:
                    logger.info(f"[{i}/{len(pending)}] script={script_id} skipped (no text)")
                    continue

                idioms = await compute_idioms(script.cleanedScriptText)
                await store_script_idioms(db, script_id, idioms)

                ok += 1
                found += len(idioms)
                elapsed = (time.perf_counter() - t0) * 1000
                logger.info(
                    f"[{i}/{len(pending)}] script={script_id} movie={row['movie_id']} "
                    f"chars={row['chars']:,} idioms={len(idioms)} in {elapsed:.0f}ms"
                )
            except Exception as e:
                failed += 1
                logger.error(f"[{i}/{len(pending)}] script={script_id} FAILED: {e}", exc_info=True)

        total = time.perf_counter() - t_start
        logger.info(
            f"Done in {total:.1f}s — scripts={ok} idioms={found} failed={failed}"
        )
    finally:
        await db.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
