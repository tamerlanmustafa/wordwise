"""
Hide internationalisms that are already stored in prod vocabulary (issue #89).

src/services/internationalism_filter.py stops new ones at classification time
(via the lemma guard), but everything ingested before that filter existed is
already sitting in `lemmas` and `word_classifications`. This script finds
those rows and adds them to `hidden_words`, which is the read-time filter
every SQL vocabulary path already honours:

  - src/routes/quiz.py            quiz candidate selection
  - src/routes/srs.py             SRS refills + the word feed
  - src/workers/sentence_worker.py  LLM sentence generation (also stops us
                                    paying Haiku to write example sentences
                                    for "pizza" and "kilometer")
  - src/services/vocab_coverage.py  the admin coverage view

It is additive and reversible: nothing is deleted, and an admin can unhide a
word by removing its `hidden_words` row.

This is a direct sibling of hide_profane_lemmas.py — same table, same shape,
different judgement — so the two can be run independently and in any order.

Run from backend/:
    python3.11 hide_international_lemmas.py              # dry run (default)
    python3.11 hide_international_lemmas.py --sample 40  # spot-check matches
    python3.11 hide_international_lemmas.py --apply      # actually hide
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import time
from typing import List, Tuple

from prisma import Prisma

from src.services.internationalism_filter import (
    is_internationalism,
    is_internationalism_entry,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("hide_international_lemmas")

BATCH = 500


async def fetch_candidates(db: Prisma) -> List[Tuple[str, str]]:
    """
    Every distinct vocabulary form in the DB, as (form, source) pairs.

    Both registries are scanned: the V2 `lemmas` table feeds quiz/SRS/the word
    feed, while `word_classifications` feeds the per-movie vocabulary lists.
    A form found in either place gets hidden once (hidden_words.word is
    unique and matched case-insensitively by the read paths).
    """
    lemma_rows = await db.query_raw("SELECT DISTINCT lemma FROM lemmas WHERE lemma IS NOT NULL")
    wc_rows = await db.query_raw(
        "SELECT DISTINCT word, lemma FROM word_classifications WHERE word IS NOT NULL"
    )

    found: dict[str, str] = {}
    for row in lemma_rows:
        lemma = (row["lemma"] or "").strip()
        if lemma and is_internationalism(lemma):
            found.setdefault(lemma.lower(), "lemmas")

    for row in wc_rows:
        word = (row["word"] or "").strip()
        lemma = (row["lemma"] or "").strip()
        if not word:
            continue
        if not is_internationalism_entry(word, lemma):
            continue
        # Hide whichever form actually matched, so the read-side comparison
        # (which checks word AND lemma against hidden_words) always lands.
        if is_internationalism(word):
            found.setdefault(word.lower(), "word_classifications")
        if lemma and is_internationalism(lemma):
            found.setdefault(lemma.lower(), "word_classifications")

    return sorted(found.items())


async def admin_user_id(db: Prisma) -> int:
    """First admin's id, for the hidden_words.hidden_by_id FK."""
    row = await db.query_first("SELECT id FROM users WHERE is_admin = TRUE ORDER BY id LIMIT 1")
    if not row:
        raise RuntimeError("No admin user found - cannot attribute hide entries.")
    return row["id"]


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true",
                        help="Write to hidden_words. Without this, dry run only.")
    parser.add_argument("--sample", type=int, default=0,
                        help="Print N matched forms for spot-checking.")
    args = parser.parse_args()

    db = Prisma()
    await db.connect()
    try:
        candidates = await fetch_candidates(db)

        existing = await db.query_raw("SELECT word FROM hidden_words")
        already_hidden = {r["word"].lower() for r in existing}

        to_hide = [(form, src) for form, src in candidates if form not in already_hidden]

        logger.info(
            f"Internationalisms found: {len(candidates)} "
            f"(new={len(to_hide)}, already hidden={len(candidates) - len(to_hide)})"
        )
        by_source: dict[str, int] = {}
        for _, src in to_hide:
            by_source[src] = by_source.get(src, 0) + 1
        for src, n in sorted(by_source.items(), key=lambda kv: -kv[1]):
            logger.info(f"  {src:25s} {n:>6}")

        if args.sample and to_hide:
            import random
            picks = random.sample(to_hide, min(args.sample, len(to_hide)))
            print("\n--- Sample of forms to hide ---")
            for form, src in sorted(picks):
                print(f"  {form!r:30s} ({src})")

        if not args.apply:
            logger.info("Dry run - no writes performed. Re-run with --apply to hide.")
            return

        if not to_hide:
            logger.info("Nothing new to hide.")
            return

        admin_id = await admin_user_id(db)
        t = time.perf_counter()
        inserted = 0
        for i in range(0, len(to_hide), BATCH):
            chunk = to_hide[i : i + BATCH]
            values_sql = ",".join(
                f"(${j*3+1}, ${j*3+2}, ${j*3+3})" for j in range(len(chunk))
            )
            params: list = []
            for form, _src in chunk:
                params.extend([form, admin_id, "auto: internationalism"])
            sql = (
                f"INSERT INTO hidden_words (word, hidden_by_id, reason) "
                f"VALUES {values_sql} ON CONFLICT (word) DO NOTHING"
            )
            inserted += await db.execute_raw(sql, *params)
        logger.info(
            f"Inserted {inserted} hidden_words rows in {time.perf_counter()-t:.1f}s"
        )

    finally:
        await db.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
