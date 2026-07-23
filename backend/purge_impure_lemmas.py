"""
One-off cleanup for lemma impurity that predates the upstream lemma guard
(src/services/lemma_guard.py). Three phases:

  1. lemmas registry: DELETE rows the guard rejects (gibberish, typos, OCR
     artifacts, foreign words, tokenization debris like 's / mr. / -"he).
     movie_lemma_mappings and sentence_lemma_links rows cascade.
  2. lemmas registry: MERGE inflected duplicates into their base form
     ("wives" row folds into "wife": mappings/links are repointed, counts
     recomputed, the inflected row deleted).
  3. word_classifications: DELETE rows whose lemma the guard rejects, and
     REWRITE rows whose stored lemma is an inflected form of a valid base
     lemma so old data matches what the fixed classifier now produces.

Complements (does not replace) hide_garbage_lemmas.py, which patches the
read side via hidden_words. This script fixes the stored data itself.

DESTRUCTIVE when run with --apply. Default is a dry run that only reports
counts and samples. Run from backend/ with prod DATABASE_URL exported:

    python3.11 purge_impure_lemmas.py                # dry run, counts only
    python3.11 purge_impure_lemmas.py --sample 50    # + 50 random decisions
    python3.11 purge_impure_lemmas.py --apply        # actually write
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import time
from pathlib import Path

from prisma import Prisma

from src.services.cefr_classifier import (
    KIDS_SIMPLE_VOCAB,
    INFORMAL_SIMPLE_VOCAB,
    HybridCEFRClassifier,
)
from src.services.lemma_guard import evaluate_lemma

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("purge_impure_lemmas")

BATCH = 500


def build_classifier() -> HybridCEFRClassifier:
    data_dir = Path(__file__).parent / "data" / "cefr"
    logger.info("Loading CEFR wordlists (no embeddings)...")
    return HybridCEFRClassifier(data_dir=data_dir, use_embedding_classifier=False)


def make_wordlist_known(classifier: HybridCEFRClassifier):
    def _known(w: str) -> bool:
        return (
            w in classifier.cefr_wordlist
            or w in classifier.multi_word_expressions
            or w in KIDS_SIMPLE_VOCAB
            or w in INFORMAL_SIMPLE_VOCAB
        )

    return _known


# Frequency-based rejections may just mean the INFLECTED string is rare
# ("shucked", "lightbulbs"); orthographic rejections never recover.
_FREQ_REASONS = ("unknown_english", "not_in_dict_low_freq")
# Never merge into suspiciously short base forms ("gus" -> "gu").
_MIN_BASE_LEN = 3


def _valid_base(classifier, is_known, lemma: str) -> str | None:
    """The lemma's base form, when it differs and passes the guard itself."""
    base = classifier._get_lemma_fast(lemma)
    if (
        base != lemma
        and len(base) >= _MIN_BASE_LEN
        and evaluate_lemma(base, is_wordlist_known=is_known).keep
    ):
        return base
    return None


def _resolve_final(src: str, base_of: dict[str, str]) -> str | None:
    """
    Follow the base-of chain to a STABLE target — one that is not itself a
    merge source. Guards against cycles ("a" -> "b" -> "a"). Without this,
    a chain X->Y->Z can delete Y before X repoints to it (FK violation),
    since merges aren't processed in dependency order.
    """
    seen = {src}
    cur = base_of[src]
    while cur in base_of:
        if cur in seen:
            return None  # cycle — leave these rows untouched
        seen.add(cur)
        cur = base_of[cur]
    return cur


async def audit_lemmas(db: Prisma, classifier, is_known) -> tuple[list, list]:
    """Returns (delete_rows, merge_pairs) for the lemmas registry."""
    rows = await db.query_raw("SELECT id, lemma, is_multi_word FROM lemmas")
    logger.info(f"Auditing {len(rows)} lemmas registry rows...")

    lemma_to_id = {r["lemma"]: r["id"] for r in rows}
    to_delete: list[tuple[int, str, str]] = []  # (id, lemma, reason)

    # First pass: classify each row and record raw src->base merge intents.
    base_of: dict[str, str] = {}
    for r in rows:
        lemma = r["lemma"]
        if r["is_multi_word"] or " " in lemma:
            continue
        decision = evaluate_lemma(lemma, is_wordlist_known=is_known)
        base = _valid_base(classifier, is_known, lemma)

        if decision.keep or (decision.reason in _FREQ_REASONS and base):
            # Inflected duplicate: fold into the base form's registry row.
            # (A rare-inflection row with no base row is left alone.)
            if base and base in lemma_to_id:
                base_of[lemma] = base
            continue

        to_delete.append((r["id"], lemma, decision.reason))

    # Second pass: resolve each source to its ultimate stable base so every
    # chained inflection folds into a target that never gets deleted.
    to_merge: list[tuple[int, int, str, str]] = []  # (src_id, dst_id, src, dst)
    for src in base_of:
        final = _resolve_final(src, base_of)
        if final and final in lemma_to_id:
            to_merge.append((lemma_to_id[src], lemma_to_id[final], src, final))

    return to_delete, to_merge


async def apply_lemma_deletes(db: Prisma, to_delete: list) -> None:
    t = time.perf_counter()
    ids = [row_id for row_id, _, _ in to_delete]
    for i in range(0, len(ids), BATCH):
        chunk = ids[i : i + BATCH]
        placeholders = ",".join(f"${j + 1}" for j in range(len(chunk)))
        # movie_lemma_mappings / sentence_lemma_links cascade on delete
        await db.execute_raw(
            f"DELETE FROM lemmas WHERE id IN ({placeholders})", *chunk
        )
    logger.info(f"Deleted {len(ids)} lemmas rows in {time.perf_counter() - t:.1f}s")


async def apply_lemma_merges(db: Prisma, to_merge: list) -> None:
    t = time.perf_counter()
    skipped = 0
    for src_id, dst_id, _src, _dst in to_merge:
        # Defensive: never repoint onto a target that no longer exists
        # (would trip the FK constraint). Targets are resolved to stable
        # bases in audit, so this should stay at zero.
        exists = await db.query_first("SELECT 1 AS ok FROM lemmas WHERE id = $1", dst_id)
        if not exists:
            skipped += 1
            continue
        # Repoint dependents where the target doesn't already have the row,
        # drop the rest, then recompute the target's movie count.
        await db.execute_raw(
            """
            UPDATE movie_lemma_mappings m SET lemma_id = $2
             WHERE m.lemma_id = $1
               AND NOT EXISTS (SELECT 1 FROM movie_lemma_mappings t
                               WHERE t.movie_id = m.movie_id AND t.lemma_id = $2)
            """,
            src_id, dst_id,
        )
        await db.execute_raw(
            "DELETE FROM movie_lemma_mappings WHERE lemma_id = $1", src_id
        )
        await db.execute_raw(
            """
            UPDATE sentence_lemma_links s SET lemma_id = $2
             WHERE s.lemma_id = $1
               AND NOT EXISTS (SELECT 1 FROM sentence_lemma_links t
                               WHERE t.sentence_id = s.sentence_id AND t.lemma_id = $2)
            """,
            src_id, dst_id,
        )
        await db.execute_raw(
            "DELETE FROM sentence_lemma_links WHERE lemma_id = $1", src_id
        )
        await db.execute_raw(
            """
            UPDATE lemmas SET total_movie_count =
              (SELECT count(*) FROM movie_lemma_mappings WHERE lemma_id = $1)
             WHERE id = $1
            """,
            dst_id,
        )
        await db.execute_raw("DELETE FROM lemmas WHERE id = $1", src_id)
    logger.info(
        f"Merged {len(to_merge) - skipped} inflected lemmas "
        f"({skipped} skipped: target already gone) in {time.perf_counter() - t:.1f}s"
    )


async def audit_word_classifications(db: Prisma, classifier, is_known) -> tuple[list, list]:
    """Returns (delete_lemmas, rewrite_pairs) for word_classifications."""
    rows = await db.query_raw(
        "SELECT lemma, count(*) AS n FROM word_classifications GROUP BY lemma"
    )
    logger.info(f"Auditing {len(rows)} distinct word_classifications lemmas...")

    to_delete: list[tuple[str, int, str]] = []  # (lemma, row_count, reason)
    counts: dict[str, int] = {}
    base_of: dict[str, str] = {}

    for r in rows:
        lemma = r["lemma"]
        counts[lemma] = r["n"]
        if " " in lemma:
            continue
        decision = evaluate_lemma(lemma, is_wordlist_known=is_known)
        base = _valid_base(classifier, is_known, lemma)

        if decision.keep or (decision.reason in _FREQ_REASONS and base):
            # Rare inflected strings ("shucked") rewrite to their base form
            # instead of being deleted.
            if base:
                base_of[lemma] = base
            continue

        to_delete.append((lemma, r["n"], decision.reason))

    # Resolve chained rewrites so X->Y->Z lands every row on Z regardless of
    # apply order (no FK here, but keeps the rewrite order-independent).
    to_rewrite: list[tuple[str, str, int]] = []  # (old_lemma, new_lemma, row_count)
    for src in base_of:
        final = _resolve_final(src, base_of)
        if final:
            to_rewrite.append((src, final, counts[src]))

    return to_delete, to_rewrite


async def apply_wc_changes(db: Prisma, to_delete: list, to_rewrite: list) -> None:
    t = time.perf_counter()
    deleted = 0
    lemmas = [lemma for lemma, _, _ in to_delete]
    for i in range(0, len(lemmas), BATCH):
        chunk = lemmas[i : i + BATCH]
        placeholders = ",".join(f"${j + 1}" for j in range(len(chunk)))
        deleted += await db.execute_raw(
            f"DELETE FROM word_classifications WHERE lemma IN ({placeholders})", *chunk
        )
    logger.info(f"Deleted {deleted} word_classifications rows in {time.perf_counter() - t:.1f}s")

    t = time.perf_counter()
    for old, new, _n in to_rewrite:
        await db.execute_raw(
            "UPDATE word_classifications SET lemma = $2 WHERE lemma = $1", old, new
        )
    logger.info(f"Rewrote {len(to_rewrite)} inflected wc lemmas in {time.perf_counter() - t:.1f}s")


def report(title: str, decisions: list, key=lambda d: d[-1]) -> None:
    logger.info(f"{title}: {len(decisions)}")
    counts: dict[str, int] = {}
    for d in decisions:
        counts[key(d)] = counts.get(key(d), 0) + 1
    for reason, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        logger.info(f"  {reason:25s} {n:>7}")


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true",
                        help="Actually delete/merge/rewrite. Default is dry run.")
    parser.add_argument("--sample", type=int, default=0,
                        help="Print N random decisions for spot-checking.")
    args = parser.parse_args()

    classifier = build_classifier()
    is_known = make_wordlist_known(classifier)

    db = Prisma()
    await db.connect()
    try:
        lemma_deletes, lemma_merges = await audit_lemmas(db, classifier, is_known)
        wc_deletes, wc_rewrites = await audit_word_classifications(db, classifier, is_known)

        report("lemmas rows to DELETE", lemma_deletes)
        logger.info(f"lemmas rows to MERGE into base form: {len(lemma_merges)}")
        report("word_classifications lemmas to DELETE", wc_deletes)
        logger.info(
            f"  ({sum(n for _, n, _ in wc_deletes)} word_classifications rows affected)"
        )
        logger.info(
            f"word_classifications lemmas to REWRITE: {len(wc_rewrites)} "
            f"({sum(n for _, _, n in wc_rewrites)} rows affected)"
        )

        if args.sample:
            import random
            print("\n--- lemma delete sample ---")
            for _id, lemma, reason in random.sample(lemma_deletes, min(args.sample, len(lemma_deletes))):
                print(f"  {lemma!r:30s} -> DELETE ({reason})")
            print("--- lemma merge sample ---")
            for _s, _d, src, dst in random.sample(lemma_merges, min(args.sample, len(lemma_merges))):
                print(f"  {src!r:30s} -> MERGE into {dst!r}")
            print("--- wc rewrite sample ---")
            for old, new, n in random.sample(wc_rewrites, min(args.sample, len(wc_rewrites))):
                print(f"  {old!r:30s} -> {new!r} ({n} rows)")

        if not args.apply:
            logger.info("Dry run - no writes performed. Re-run with --apply to execute.")
            return

        await apply_lemma_deletes(db, lemma_deletes)
        await apply_lemma_merges(db, lemma_merges)
        await apply_wc_changes(db, wc_deletes, wc_rewrites)
        logger.info("Cleanup complete.")
    finally:
        await db.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
