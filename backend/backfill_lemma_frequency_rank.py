"""
One-shot: populate `lemmas.frequency_rank` for rows that never got one (#137).

Three queries sort the words they hand a learner by this column:

    srs.py     ORDER BY mlm.frequency_in_movie DESC, l.frequency_rank ASC NULLS LAST
    srs.py     ORDER BY l.frequency_rank ASC NULLS LAST      -- the new-words deck
    quiz.py    ORDER BY mlm.frequency_in_movie DESC, l.frequency_rank ASC NULLS LAST

`NULLS LAST` means every unranked lemma lands in one undifferentiated tail in
whatever order Postgres returns it. As of 2026-08-21 that tail is 61.3% of the
23,034 lemmas the new-words deck can draw from — so "teach the common words
first" is doing nothing for most of the registry.

The rank is a pure function of the lemma string (`wordfreq`'s Zipf score, see
`src/utils/word_frequency.py`), so this is deterministic and re-runnable.

Idempotent: only rows with `frequency_rank IS NULL` are read, and the UPDATE
sets nothing else, so an interrupted run resumes and a second full run is a
no-op. Nothing here touches `cefr_level`, `source` or `confidence` — the
columns #91/#119 re-graded.

Run from the backend/ directory with the interpreter that has Prisma installed
(typically python3.11 on this machine — `python3` resolves to Apple's 3.9):

    cd backend
    python3.11 backfill_lemma_frequency_rank.py --dry-run    # count + sample
    python3.11 backfill_lemma_frequency_rank.py --limit 500  # smoke run
    python3.11 backfill_lemma_frequency_rank.py              # everything

Cost: wordfreq only. No LLM calls, no external APIs, ~0.005ms of CPU per lemma.
"""
import argparse
import asyncio
import json
import logging
import time
from typing import Any, Dict, List

from prisma import Prisma

from src.utils.word_frequency import frequency_rank, wordfreq_available

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("backfill_lemma_frequency_rank")

# Prisma talks to its query engine over HTTP; without this every chunk logs two
# INFO lines of its own around the one line of progress anyone is watching.
logging.getLogger("httpx").setLevel(logging.WARNING)

PENDING_SQL = """
    SELECT id, lemma
    FROM lemmas
    WHERE frequency_rank IS NULL
    ORDER BY id
"""

#: One UPDATE per chunk, joined against a values list rather than issued row by
#: row. 42k lemmas at this size is ~43 statements instead of 42,000 round trips
#: — the same shape as the lemma upsert in #145.
UPDATE_SQL = """
    UPDATE lemmas AS l
    SET frequency_rank = r.rank
    FROM JSONB_TO_RECORDSET($1::jsonb) AS r(id int, rank int)
    WHERE l.id = r.id
      AND l.frequency_rank IS NULL
"""

CHUNK = 1000


def _rank_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, int]]:
    """Attach a rank to each pending lemma, dropping the ones wordfreq can't score.

    A lemma wordfreq has never seen still gets `UNKNOWN_WORD_RANK` rather than
    being skipped — that is a real answer ("vanishingly rare"), and leaving it
    NULL would put it back in the unsorted tail this script exists to empty.
    Only a lookup that *errors* yields None, and those rows are left for a
    later run.
    """
    out: List[Dict[str, int]] = []
    for row in rows:
        lemma = (row.get("lemma") or "").strip()
        if not lemma:
            continue
        rank = frequency_rank(lemma.lower())
        if rank is None:
            continue
        out.append({"id": int(row["id"]), "rank": int(rank)})
    return out


async def fetch_pending(db: Prisma, limit: int | None) -> List[Dict[str, Any]]:
    sql = PENDING_SQL + (f" LIMIT {int(limit)}" if limit else "")
    return [dict(r) for r in await db.query_raw(sql)]


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="count the work, write nothing")
    parser.add_argument("--limit", type=int, default=None, help="process at most N lemmas")
    args = parser.parse_args()

    if not wordfreq_available():
        raise SystemExit("wordfreq is not importable in this interpreter — nothing to do")

    db = Prisma()
    await db.connect()
    try:
        pending = await fetch_pending(db, args.limit)
        logger.info("%d lemmas with no frequency_rank", len(pending))
        if not pending:
            return

        ranked = _rank_rows(pending)
        unscored = len(pending) - len(ranked)
        if unscored:
            logger.warning("%d lemmas could not be scored and were skipped", unscored)

        if args.dry_run:
            # Keyed by id, not by position: `_rank_rows` drops blank and
            # unscoreable lemmas, so a positional zip would print one lemma's
            # name beside another lemma's rank.
            names = {int(r["id"]): r["lemma"] for r in pending}
            for sample in ranked[:10]:
                logger.info("  %-24s -> %d", names[sample["id"]], sample["rank"])
            logger.info("DRY RUN: would update %d rows", len(ranked))
            return

        started = time.perf_counter()
        written = 0

        for i in range(0, len(ranked), CHUNK):
            chunk = ranked[i:i + CHUNK]
            written += await db.execute_raw(UPDATE_SQL, json.dumps(chunk))
            logger.info("updated %d/%d", written, len(ranked))

        logger.info(
            "done: %d rows in %.1fs", written, time.perf_counter() - started
        )
    finally:
        await db.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
