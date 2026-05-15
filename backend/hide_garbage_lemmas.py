"""
Audit "missing" lemmas (those without an LLM sentence) and hide the ones
that look like tokenization artifacts, proper nouns, foreign words, or
non-English fragments. Real rare English vocabulary is kept.

The OpenSubtitles → spaCy pipeline emits a lot of garbage tokens that the
downstream CEFR classifier defaults to "A2" because it doesn't recognize
them. Those leak into For You feeds. We don't want to generate LLM
sentences for them (waste of money) and we don't want them displayed to
users (bad UX), so we surface them in the `hidden_words` table.

Detection signals:
  - ASCII + length sanity (≥3 chars).
  - Frequency in English (wordfreq).
  - Foreign-language dominance: same lemma >5× more frequent in any of
    {es, fr, de, pt, it, ru, ja} than in English.
  - Dictionary membership (NLTK words corpus, ~234k entries).

A lemma is kept (i.e. real English word) iff it passes the basic checks
AND is in the dictionary OR is reasonably frequent in English (>=1e-5).
This biases toward MARKING garbage (saves $$); a real word with very low
frequency and not in the dictionary may be incorrectly hidden. Admin can
unhide individual words manually if needed.

Run from backend/:
    python3.11 hide_garbage_lemmas.py --dry-run   # report counts only
    python3.11 hide_garbage_lemmas.py             # actually hide
    python3.11 hide_garbage_lemmas.py --sample 50 # show 50 random
                                                  # decisions to spot check
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import time
from typing import List

from prisma import Prisma
from wordfreq import word_frequency

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("hide_garbage_lemmas")

FOREIGN_LANGS = ("es", "fr", "de", "pt", "it", "ru")
MIN_LEN = 3
NLTK_OK = True
ENGLISH_WORDS: set = set()

try:
    import nltk
    nltk.download("words", quiet=True)
    from nltk.corpus import words as nltk_words
    ENGLISH_WORDS = set(w.lower() for w in nltk_words.words())
except Exception as e:  # noqa: BLE001
    logger.warning(f"NLTK words unavailable ({e}); falling back to freq-only.")
    NLTK_OK = False


def classify(lemma: str) -> tuple[bool, str]:
    """
    Returns (is_real_english_word, reason_if_hidden).
    """
    w = lemma.lower().strip()
    if len(w) < MIN_LEN:
        return False, f"len<{MIN_LEN}"

    en_freq = word_frequency(w, "en")
    if en_freq == 0:
        return False, "zero_en_freq"

    # Foreign-language leak: same token dramatically more common abroad.
    max_other = 0.0
    top_lang = "en"
    for lang in FOREIGN_LANGS:
        f = word_frequency(w, lang)
        if f > max_other:
            max_other = f
            top_lang = lang
    if max_other > en_freq * 5:
        return False, f"foreign_{top_lang}"

    if NLTK_OK and w in ENGLISH_WORDS:
        return True, ""

    # Not in dictionary — only accept if reasonably common modern English
    # (catches "covid", "instagram" etc. that NLTK predates).
    if en_freq >= 1e-5:
        return True, ""

    return False, "not_in_dict_low_freq"


async def fetch_missing_lemmas(db: Prisma) -> List[dict]:
    """All lemmas that have a subtitle-sourced sentence but no LLM sentence."""
    sql = """
        SELECT l.id AS lemma_id, l.lemma AS lemma
        FROM lemmas l
        WHERE l.id IN (
            SELECT DISTINCT sll.lemma_id FROM sentence_lemma_links sll
            JOIN sentence_bank sb ON sb.id = sll.sentence_id
            WHERE sb.source = 'subtitle'
        )
        AND l.id NOT IN (
            SELECT DISTINCT sll.lemma_id FROM sentence_lemma_links sll
            JOIN sentence_bank sb ON sb.id = sll.sentence_id
            WHERE sb.source = 'llm' AND sb.movie_id IS NULL
        )
    """
    return await db.query_raw(sql)


async def admin_user_id(db: Prisma) -> int:
    """First admin's id, for the hidden_words.hidden_by_id FK."""
    row = await db.query_first("SELECT id FROM users WHERE is_admin = TRUE ORDER BY id LIMIT 1")
    if not row:
        raise RuntimeError("No admin user found — cannot attribute hide entries.")
    return row["id"]


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true",
                        help="Compute stats but don't write to hidden_words.")
    parser.add_argument("--sample", type=int, default=0,
                        help="Print N random decisions for spot-checking.")
    parser.add_argument("--limit", type=int, default=0,
                        help="Process only N rows (for testing).")
    args = parser.parse_args()

    db = Prisma()
    await db.connect()
    try:
        lemmas = await fetch_missing_lemmas(db)
        if args.limit:
            lemmas = lemmas[: args.limit]

        admin_id = await admin_user_id(db)
        logger.info(f"Auditing {len(lemmas)} missing lemmas (admin_id={admin_id})")

        # Cache existing hides so we don't re-insert.
        existing = await db.query_raw("SELECT word FROM hidden_words")
        already_hidden = {r["word"].lower() for r in existing}

        decisions = []
        n_real = n_hide = n_already = 0
        reason_counts: dict[str, int] = {}

        for row in lemmas:
            lemma = row["lemma"]
            is_real, reason = classify(lemma)
            if is_real:
                n_real += 1
                decisions.append((lemma, True, ""))
            else:
                if lemma.lower() in already_hidden:
                    n_already += 1
                else:
                    n_hide += 1
                    reason_counts[reason] = reason_counts.get(reason, 0) + 1
                decisions.append((lemma, False, reason))

        logger.info(
            f"Audit results: keep={n_real} hide_new={n_hide} already_hidden={n_already}"
        )
        logger.info("Hide reasons:")
        for reason, n in sorted(reason_counts.items(), key=lambda kv: -kv[1]):
            logger.info(f"  {reason:25s} {n:>6}")

        if args.sample:
            import random
            picks = random.sample(decisions, min(args.sample, len(decisions)))
            print("\n─── Random decision sample ───")
            for lemma, is_real, reason in picks:
                tag = "KEEP" if is_real else f"HIDE ({reason})"
                print(f"  {lemma!r:30s} → {tag}")

        if args.dry_run:
            logger.info("Dry run — no writes performed.")
            return

        # Bulk insert hides. Use raw SQL with ON CONFLICT for speed.
        t = time.perf_counter()
        to_hide = [(lemma, reason) for lemma, real, reason in decisions
                   if not real and lemma.lower() not in already_hidden]
        BATCH = 500
        inserted = 0
        for i in range(0, len(to_hide), BATCH):
            chunk = to_hide[i : i + BATCH]
            # Build a single multi-row INSERT for efficiency.
            values_sql = ",".join(
                f"(${j*3+1}, ${j*3+2}, ${j*3+3})"
                for j in range(len(chunk))
            )
            params = []
            for lemma, reason in chunk:
                params.extend([lemma.lower(), admin_id, f"auto: {reason}"])
            sql = (
                f"INSERT INTO hidden_words (word, hidden_by_id, reason) "
                f"VALUES {values_sql} ON CONFLICT (word) DO NOTHING"
            )
            inserted += await db.execute_raw(sql, *params)
        logger.info(
            f"Inserted {inserted} new hidden_words rows in {time.perf_counter()-t:.1f}s"
        )

    finally:
        await db.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
