"""
Drain the registry's UNKNOWN bucket using the grades prod already recorded
(issue #131).

WHAT WENT WRONG

`lemmas.cefr_level = 'UNKNOWN'` is the "classifier could not place this"
holding pen introduced by #91. It grew to 14,819 rows, 34.8% of the registry,
and nothing in it is ever taught: the Explore feed skips it, the sentence
worker filters it out (`AND l.cefr_level <> 'UNKNOWN'`), and should_keep_word
drops it at read time.

It is not, however, 14,819 unplaceable words. 14,447 of them (97.5%) carry
confidence 0.9, which is the signature of exactly one branch — the proper-noun
check in classify_word, whose rule 1 is `word[0].isupper()`. Two separate
defects fed it:

  1. classify_text kept the FIRST surface form it saw for each word, so one
     line-initial "Baby, I'm home." made the whole script classify "Baby".
  2. _upsert_lemmas resolved conflicts with max(confidence), and the
     proper-noun branch returns 0.9 while a real wordlist grade returns 0.85
     or less. So one capitalized script overwrote the level every other
     script agreed on, permanently: no frequency-based re-classification can
     ever climb back past 0.9.

Both are fixed upstream (src/services/cefr_classifier.py, _case_rank; and
src/services/lemmatization_service.py, _level_wins). This script repairs the
rows already stored.

THE EVIDENCE IT USES

Nothing new is computed. `word_classifications` holds the classifier's verdict
per script, and for these lemmas it already disagrees with the registry:

    angry     B1 in 1,259 scripts, UNKNOWN in     3   -> registry says UNKNOWN
    baby      A2 in 2,596 scripts, UNKNOWN in   668   -> registry says UNKNOWN
    study     A2 in 1,344 scripts, UNKNOWN in    49   -> registry says UNKNOWN
    jesus                          UNKNOWN in 2,492   -> registry says UNKNOWN
    york                           UNKNOWN in 1,277   -> registry says UNKNOWN

So the proposal for each lemma is a vote over its own recorded per-script
grades. A real proper noun is capitalized in every script it appears in, and
therefore has no votes at all — "jesus" and "york" have zero and stay put.

THE GATE, AND WHY IT IS WHERE IT IS

Two independent signals were measured across all 14,819 rows, and they agree:
of the 9,156 lemmas with at least one real grade, only 4 are never written in
lowercase anywhere in the corpus. Capitalization is what put them here, so
capitalization is what gets them out.

MIN_GRADED_SHARE = 0.75 was chosen by sweeping the threshold and reading both
sides of each cut. At 0.75 the rejected side is every name and interjection —
john (0.01), mary (0.00), george (0.00), london (0.02), christ (0.02),
america (0.21), jack (0.32), whoa (0.00), yep (0.00), whoo (0.02), nah (0.05)
— and the accepted side is vocabulary: baby (0.80), cowboy (0.81),
intercept (0.80), casino (0.84), unleash (0.83), puppet (0.85). A random
sample of 40 accepted rows contained 38 teachable words (licorice, trespass,
coolant, larceny, assassinate, pneumatic, stifle, janitor, diorama) and 2
misses (`minos`, `bono` — the latter already hidden). Loosening to 0.5 pulls
in `mister`/`bob`/`jeez`; tightening to 0.9 halves the yield for nothing the
sample shows is wrong.

MIN_WINNER_SHARE guards the level rather than the promotion: a lemma whose
grades are split three ways has no plurality worth trusting.

Every survivor is then put through `evaluate_lemma` — the SAME guard
classify_text runs, with the SAME curated wordlists — because these rows were
written before #96 recalibrated it. That is what keeps internationalisms
(motel, selfie, tsunami, podcast, saxophone) and a slur out of the promotion
set even though their grades are perfectly good. Words already in
hidden_words are skipped: they are invisible either way, and rewriting them
would only churn rows.

WHAT IT DOES NOT TOUCH

`priority_score` is left alone, matching fix_overstripped_lemmas.py and
purge_impure_lemmas.py. The score's frequency term is a rank WITHIN one movie,
so there is no global value to recompute it to; and the stored number is a
max() taken across every movie, which for these rows already includes
contributions computed under real levels — prod's average priority for
UNKNOWN is 0.199, sitting between B1 (0.160) and B2 (0.211) rather than at
the UNKNOWN weight of 0. Shifting it by the CEFR delta would double-count.

`word_classifications` is not rewritten either. Those rows are already right;
the registry was the only thing that disagreed with them.

DESTRUCTIVE when run with --apply. Default is a dry run. Run from backend/
with the prod DATABASE_URL exported:

    python3.11 backfill_unknown_bucket.py            # dry run, full report
    python3.11 backfill_unknown_bucket.py --apply    # actually write
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import time
from collections import Counter
from datetime import timedelta

from prisma import Json, Prisma

from src.services.cefr_classifier import is_curated_vocabulary
from src.services.hidden_words import hidden_word_exclusion_sql
from src.services.lemma_guard import evaluate_lemma
from src.services.lemmatization_service import UNKNOWN_LEVEL

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("backfill_unknown_bucket")

#: Share of a lemma's recorded scripts that must have given it a REAL level
#: before it may leave the bucket. This is the proper-noun test: a name is
#: capitalized everywhere, so it never clears this. See the module docstring
#: for the sweep either side of the cut.
MIN_GRADED_SHARE = 0.75

#: Share of the REAL grades that must agree on the winning level. Guards the
#: level chosen, not the decision to promote.
MIN_WINNER_SHARE = 0.5

#: Films a lemma must appear in before its grade is worth acting on.
#:
#: Below this the promotion set stops being vocabulary and starts being
#: transliterated names out of subtitles for foreign films — the 1-2 movie
#: band is roughly two thirds `aku`, `hui`, `lak`, `noy`, `rik`, `rix`,
#: `saka`, `yana`, `zan`, `benet`, `minos`; the 3-4 band about a fifth; from
#: 5 up a 28-row sample is clean (acidity, borscht, cummerbund, emeritus,
#: proletarian, thimble, trellis). lemma_guard keeps them all because they
#: are in Webster's 2nd and its foreign-language check covers es/fr/de/pt/
#: it/ru, not transliterated CJK.
#:
#: Neither length nor frequency_rank separates the two groups — `ego`, `gal`,
#: `foe`, `emu` are three letters and real, and `photocopier` ranks 72,443
#: against `goy` at 51,286 and `rix` at 53,703. Corpus reach does.
#:
#: The cost is real words in one to four films (astrophysics, bicarbonate,
#: cathode, imperialism) staying put. That is issue #131's third option —
#: keep unreachable, explicitly — and it is nearly free: a word in 2 of
#: 4,400 films is one no learner meets, and the holding pen keeps it stored
#: and countable rather than deleting it.
MIN_MOVIES = 5

#: Rows written per UPDATE ... FROM statement. The promotion set is a few
#: thousand rows, so this is two or three round trips rather than one per
#: lemma — the #145 lesson (aggregate and write in SQL, never loop).
CHUNK = 1000

#: Per-chunk transaction budget. Generous for the same reason
#: fix_overstripped_lemmas.py is: this runs from a laptop over the public
#: database URL, so every statement pays a round trip the deployed service
#: would not, and Prisma's interactive transactions default to 5 seconds.
TX_TIMEOUT = timedelta(minutes=5)

#: One aggregate over word_classifications, not one query per lemma. Returns
#: at most seven rows per UNKNOWN lemma (one per level seen), so the whole
#: 4.83M-row table collapses to tens of thousands of rows before it reaches
#: Python. `mode()` picks the dominant classifier source for each level so the
#: promoted row records where its grade actually came from.
_VOTES_SQL = f"""
    SELECT l.id,
           l.lemma,
           l.total_movie_count,
           wc.cefr_level::text                                  AS level,
           COUNT(*)::int                                        AS votes,
           AVG(wc.confidence)                                   AS confidence,
           MODE() WITHIN GROUP (ORDER BY wc.source::text)        AS source
      FROM lemmas l
      JOIN word_classifications wc ON wc.lemma = l.lemma
     WHERE l.cefr_level = 'UNKNOWN'
       AND {hidden_word_exclusion_sql("l.lemma")}
     GROUP BY l.id, l.lemma, l.total_movie_count, wc.cefr_level
"""

#: Undo table, following #119's backfill_119_unknown_snapshot. 4,094 rows is
#: past the point where "re-run the audit and reason backwards" is a recovery
#: plan: once the level is rewritten the row no longer looks like it was ever
#: UNKNOWN, so the set this pass touched would be unrecoverable. Written
#: inside the same transaction as the promotions, so it cannot end up
#: describing a state that was never reached.
_SNAPSHOT_SQL = """
    CREATE TABLE IF NOT EXISTS backfill_131_unknown_snapshot (
        lemma_id    int PRIMARY KEY,
        lemma       text        NOT NULL,
        old_level   text        NOT NULL,
        old_conf    double precision NOT NULL,
        old_source  text        NOT NULL,
        new_level   text        NOT NULL,
        taken_at    timestamptz NOT NULL DEFAULT NOW()
    )
"""

_SNAPSHOT_INSERT_SQL = """
    INSERT INTO backfill_131_unknown_snapshot (
        lemma_id, lemma, old_level, old_conf, old_source, new_level
    )
    SELECT l.id, l.lemma, l.cefr_level::text, l.confidence, l.source::text,
           v.level
      FROM JSONB_TO_RECORDSET($1::jsonb) AS v(id int, level text)
      JOIN lemmas l ON l.id = v.id
     WHERE l.cefr_level = 'UNKNOWN'
    ON CONFLICT (lemma_id) DO NOTHING
"""

_APPLY_SQL = """
    UPDATE lemmas AS l
       SET cefr_level = v.level::proficiencylevel,
           confidence = v.confidence,
           source     = v.source::classificationsource,
           updated_at = NOW()
      FROM JSONB_TO_RECORDSET($1::jsonb) AS v(
           id int, level text, confidence double precision, source text
       )
     WHERE l.id = v.id
       AND l.cefr_level = 'UNKNOWN'
"""


def _tally(rows: list[dict]) -> dict[int, dict]:
    """Collapse the per-level rows into one record per lemma."""
    lemmas: dict[int, dict] = {}
    for r in rows:
        entry = lemmas.setdefault(
            r["id"],
            {
                "id": r["id"],
                "lemma": r["lemma"],
                "movies": r["total_movie_count"],
                "levels": {},
                "scripts": 0,
                "graded": 0,
            },
        )
        entry["scripts"] += r["votes"]
        if r["level"] == UNKNOWN_LEVEL:
            continue
        entry["graded"] += r["votes"]
        entry["levels"][r["level"]] = {
            "votes": r["votes"],
            "confidence": float(r["confidence"]),
            "source": r["source"],
        }
    return lemmas


def _decide(entry: dict) -> tuple[bool, str]:
    """Promote this lemma? Returns (promote, reason-if-not)."""
    if not entry["levels"]:
        return False, "no_real_grade"

    if entry["movies"] < MIN_MOVIES:
        return False, "too_few_movies"

    graded_share = entry["graded"] / entry["scripts"]
    if graded_share < MIN_GRADED_SHARE:
        return False, "capitalized_majority"

    level, best = max(entry["levels"].items(), key=lambda kv: kv[1]["votes"])
    if best["votes"] / entry["graded"] < MIN_WINNER_SHARE:
        return False, "no_level_plurality"

    # The same guard classify_text applies, with the same curated wordlists.
    # These rows predate #96's recalibration, so a stored row is not evidence
    # that today's guard would still admit it.
    decision = evaluate_lemma(entry["lemma"], is_wordlist_known=is_curated_vocabulary)
    if not decision.keep:
        return False, f"guard:{decision.reason}"

    entry["level"] = level
    entry["votes"] = best["votes"]
    entry["confidence"] = best["confidence"]
    entry["source"] = best["source"]
    entry["graded_share"] = graded_share
    return True, ""


async def audit(db: Prisma) -> tuple[list[dict], Counter]:
    """Every UNKNOWN lemma the recorded per-script grades would place."""
    logger.info("Reading recorded per-script grades for the UNKNOWN bucket...")
    rows = await db.query_raw(_VOTES_SQL)
    lemmas = _tally(rows)
    logger.info(f"  {len(lemmas)} visible UNKNOWN lemmas with classification rows")

    proposals: list[dict] = []
    skipped: Counter = Counter()
    for entry in lemmas.values():
        promote, reason = _decide(entry)
        if promote:
            proposals.append(entry)
        else:
            skipped[reason] += 1
    proposals.sort(key=lambda e: -e["movies"])
    return proposals, skipped


def report(proposals: list[dict], skipped: Counter) -> None:
    if not proposals:
        logger.info("Nothing to promote — the bucket holds no placeable rows.")
        return

    levels = Counter(p["level"] for p in proposals)
    logger.info(f"\n{len(proposals)} lemmas leave UNKNOWN:")
    logger.info(f"  levels: {dict(sorted(levels.items()))}")
    logger.info(f"  staying put: {dict(skipped.most_common())}\n")

    header = (
        f"  {'lemma':<18} {'level':<6} {'movies':>7} {'votes':>7} "
        f"{'scripts':>8} {'graded':>7}  source"
    )
    logger.info(header)
    logger.info("  " + "-" * (len(header) - 2))
    for p in proposals[:40]:
        logger.info(
            f"  {p['lemma']:<18} {p['level']:<6} {p['movies']:>7} "
            f"{p['votes']:>7} {p['scripts']:>8} {p['graded_share']:>7.2f}  "
            f"{p['source']}"
        )
    if len(proposals) > 40:
        logger.info(f"  ... and {len(proposals) - 40} more")


async def apply(db: Prisma, proposals: list[dict]) -> int:
    """Write the promotions in chunks.

    The `AND l.cefr_level = 'UNKNOWN'` in the UPDATE makes this idempotent and
    safe to re-run: a row someone re-graded between the audit and the write is
    left alone rather than stamped back to whatever this pass computed.
    """
    await db.execute_raw(_SNAPSHOT_SQL)
    written = 0
    for start in range(0, len(proposals), CHUNK):
        batch = [
            {
                "id": p["id"],
                "level": p["level"],
                "confidence": p["confidence"],
                "source": p["source"],
            }
            for p in proposals[start:start + CHUNK]
        ]
        # Snapshot and promotion in one transaction: a chunk that recorded
        # what it was about to change but then failed to change it would
        # describe a rollback nobody needs, and one that changed rows without
        # recording them would be unrecoverable.
        async with db.tx(timeout=TX_TIMEOUT, max_wait=TX_TIMEOUT) as tx:
            await tx.execute_raw(_SNAPSHOT_INSERT_SQL, Json(batch))
            written += await tx.execute_raw(_APPLY_SQL, Json(batch))
    return written


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--apply", action="store_true",
        help="Actually write the promotions. Default is a dry run.",
    )
    args = parser.parse_args()

    db = Prisma()
    await db.connect()
    try:
        proposals, skipped = await audit(db)
        report(proposals, skipped)

        if not args.apply:
            logger.info(
                "\nDry run - no writes performed. Re-run with --apply to execute."
            )
            return

        t = time.perf_counter()
        written = await apply(db, proposals)
        logger.info(
            f"Promoted {written} lemmas out of UNKNOWN in "
            f"{time.perf_counter() - t:.1f}s"
        )
    finally:
        await db.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
