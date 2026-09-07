"""
Re-grade the registry rows that sit at A2 without ever having been graded A2.

WHAT WENT WRONG

`lemmas.cefr_level = 'A2'` is meant to be the beginner band. Prod on
2026-09-06 held 8,926 A2 rows, and 7,160 of them (80%) were never a real A2
judgement. They arrived by two different accidents:

  1. UNGRADED (5,638 rows, source='fallback' confidence=0). spaCy's lemma set
     and the classifier's do not match exactly, so some lemmas reached
     populate_lemma_registry with no classification at all, and the old code
     defaulted those to A2. That default is gone — lemmatization_service.py
     writes UNKNOWN now (#91/#119) — but the rows written before the fix were
     never revisited. This is how `disport`, `pumpernickel` and `unbreached`
     became beginner vocabulary.

  2. KIDS LEAK (1,522 rows, source='frequency_backoff' confidence=0.6). The
     kids-genre branch in classify_word softens a B2 frequency grade to A2 so
     a family film reads at the right level. That judgement is scoped to one
     movie, but it was written to `lemmas`, which is keyed on the word alone
     and serves every user. `_level_wins` keeps the higher confidence, and
     the downgrade carries 0.6 against frequency backoff's B2 at 0.55 — so
     the softened grade beat the real one and could never be beaten back.
     `contingent` is A2 app-wide because of Rango; `unilateral` because of
     Batman v Superman (Fantasy counts as a kids genre).

Both causes are fixed upstream. WordClassification now carries `base_level`
through any script-scoped adjustment and routes/cefr.py hands
`registry_level` to the registry writer, so the per-script grade stays in
word_classifications where it belongs. This script repairs the stored rows.

WHY IT IS ONE PASS AND NOT TWO

Both buckets want the same thing — the grade the classifier gives the word
with no movie context — so both get it the same way: re-run
`get_shared_classifier().classify_word(lemma)` and write what it says.

For the kids rows there is independent evidence to check that against, since
`word_classifications` recorded what the non-kids scripts thought. Of the
1,522, 1,505 have such a verdict, and the classifier agrees with **all 1,505**
(100%). It is the same code that wrote those rows, so this is a consistency
check rather than a discovery, but it is the check that makes one mechanism
defensible for both buckets. The other 17 appear only in kids films and have
no recorded alternative; the classifier places them anyway.

WHAT IT DOES, MEASURED ON PROD 2026-09-06

    kids     1,522 rows ->  B2 1,520   B1 1   C1 1
    ungraded 5,638 rows ->  C2 3,192   B2 1,159   A1 375   C1 214
                            A2 164   B1 141   UNKNOWN 393

164 of the ungraded rows really are A2 and keep the level, now with a real
source behind them. 393 are still unplaceable and go to UNKNOWN, the holding
pen #91 built for exactly that.

Note the shape of the answer: 56% of the ungraded bucket is C2. These were
never borderline calls — `rapscallion`, `mignonette`, `thundershower`,
`damnably` — they were words nothing had ever looked at.

WHY RE-GRADE RATHER THAN JUST HIDE THEM

`trusted_registry_sql` already refuses to serve source='fallback' rows with
no confidence, so the obvious repair is to make every reader call it and let
these rows fall out. That fix is correct and, on its own, would have been
worse than the bug: it takes the A2 feed from 6,745 words to 1,477, below A1,
and beginners are the users least able to absorb a thinner deck. Re-grading
first puts 5,127 words where they belong AND hands 141 of them back to A2
that the blunt filter would have deleted. The guard goes in afterwards, when
it is a no-op that catches future drift instead of a wrecking ball.

WHAT IT DOES NOT TOUCH

`word_classifications` is left alone. Those rows are the per-script view and
are already right — a kids film SHOULD record `contingent` as A2 for itself.
The registry was the only thing that took a local opinion for a global fact.

`priority_score` is left alone, matching backfill_unknown_bucket.py and
purge_impure_lemmas.py — the score's frequency term is a rank within one
movie, so there is no global value to recompute it to.

Rows in `hidden_words` are re-graded like any other. They are invisible today
so it changes nothing on screen, but hidden-ness is a display decision that
can be reversed, and leaving a known-wrong grade behind it just buries the
next bug.

DESTRUCTIVE when run with --apply. Default is a dry run. Run from backend/
with the prod DATABASE_URL exported:

    python3.11 regrade_a2_bucket.py            # dry run, full report
    python3.11 regrade_a2_bucket.py --apply    # actually write
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import time
from collections import Counter
from datetime import timedelta

from prisma import Json, Prisma

from src.services.cefr_classifier import get_shared_classifier
from src.services.lemmatization_service import UNKNOWN_LEVEL

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("regrade_a2_bucket")

#: Rows written per UPDATE ... FROM statement. The target set is ~7k rows, so
#: this is a handful of round trips rather than one per lemma — the #145
#: lesson (aggregate and write in SQL, never loop).
CHUNK = 1000

#: Per-chunk transaction budget. Generous for the same reason
#: backfill_unknown_bucket.py is: this runs from a laptop over the public
#: database URL, so every statement pays a round trip the deployed service
#: would not, and Prisma's interactive transactions default to 5 seconds.
TX_TIMEOUT = timedelta(minutes=5)

def target_sql(alias: str = "") -> str:
    """WHERE-clause fragment: this row reached A2 without being graded A2.

    The two buckets of the module docstring, written once and reused by the
    SELECT, the snapshot and the UPDATE, so the set being reported on cannot
    drift from the set being written.

    Compares literals against the enum columns rather than casting them to
    text — a `cefr_level::text` predicate is what mis-planned the vocabulary
    queries in #118.

    Takes an alias the way `trusted_registry_sql` does rather than being a
    bare string that callers rewrite; `alias` is written by the caller, never
    user input, and is interpolated. Pass "" for an unaliased single-table
    query.
    """
    p = f"{alias}." if alias else ""
    return (
        f"{p}cefr_level = 'A2' "
        f"AND (({p}source = 'fallback' AND {p}confidence < 0.5) "
        f"OR ({p}source = 'frequency_backoff' AND {p}confidence = 0.6))"
    )


_SELECT_SQL = f"""
    SELECT id, lemma, confidence, source::text AS source
      FROM lemmas
     WHERE {target_sql()}
     ORDER BY id
"""

#: Undo table, following #119's backfill_119_unknown_snapshot and #131's.
#: Once the level and source are rewritten the row no longer looks like it was
#: ever in either bucket, so without this the set the pass touched would be
#: unrecoverable. Written inside the same transaction as the update, so it
#: cannot end up describing a state that was never reached.
_SNAPSHOT_SQL = """
    CREATE TABLE IF NOT EXISTS regrade_a2_snapshot (
        lemma_id    int PRIMARY KEY,
        lemma       text             NOT NULL,
        bucket      text             NOT NULL,
        old_level   text             NOT NULL,
        old_conf    double precision NOT NULL,
        old_source  text             NOT NULL,
        new_level   text             NOT NULL,
        new_conf    double precision NOT NULL,
        new_source  text             NOT NULL,
        taken_at    timestamptz      NOT NULL DEFAULT NOW()
    )
"""

_SNAPSHOT_INSERT_SQL = f"""
    INSERT INTO regrade_a2_snapshot (
        lemma_id, lemma, bucket, old_level, old_conf, old_source,
        new_level, new_conf, new_source
    )
    SELECT l.id, l.lemma, v.bucket, l.cefr_level::text, l.confidence,
           l.source::text, v.level, v.confidence, v.source
      FROM JSONB_TO_RECORDSET($1::jsonb) AS v(
           id int, bucket text, level text,
           confidence double precision, source text
       )
      JOIN lemmas l ON l.id = v.id
     WHERE {target_sql("l")}
    ON CONFLICT (lemma_id) DO NOTHING
"""

#: Re-checking `target_sql` inside the UPDATE is what makes this idempotent
#: and safe to re-run: a row someone re-graded between the audit and the write
#: is left alone rather than stamped back to whatever this pass computed. It
#: also means a second run is a no-op, because the first run moved every row
#: out of the target set.
_APPLY_SQL = f"""
    UPDATE lemmas AS l
       SET cefr_level = v.level::proficiencylevel,
           confidence = v.confidence,
           source     = v.source::classificationsource,
           updated_at = NOW()
      FROM JSONB_TO_RECORDSET($1::jsonb) AS v(
           id int, level text, confidence double precision, source text
       )
     WHERE l.id = v.id
       AND {target_sql("l")}
"""

#: The per-script grades recorded for the kids-leak rows by scripts that were
#: NOT kids films — the independent check described in the module docstring.
#: One aggregate, not one query per lemma.
_KIDS_VOTES_SQL = """
    SELECT l.lemma,
           wc.cefr_level::text AS level,
           COUNT(*)::int       AS votes
      FROM lemmas l
      JOIN word_classifications wc ON wc.lemma = l.lemma
     WHERE l.cefr_level = 'A2'
       AND l.source = 'frequency_backoff'
       AND l.confidence = 0.6
       AND wc.cefr_level <> 'UNKNOWN'
       AND NOT (wc.source = 'frequency_backoff' AND wc.confidence = 0.6)
     GROUP BY l.lemma, wc.cefr_level
"""


def _bucket(source: str, confidence: float) -> str:
    """Which accident put this row at A2 — see the module docstring."""
    return "ungraded" if source == "fallback" and confidence < 0.5 else "kids"


def _regrade(lemma: str) -> tuple[str, float, str]:
    """The grade this word gets with no movie context: (level, conf, source).

    No `is_kids_genre` argument, deliberately — that flag is what created the
    kids bucket, and the registry is the one place it must never reach.

    A classifier result that is itself an ungraded fallback goes to UNKNOWN
    rather than being written back as a level. Re-writing "I could not place
    this" as A2 is the exact defect this script exists to repair, so it is
    not allowed to recreate it.
    """
    result = get_shared_classifier().classify_word(lemma)
    level = result.cefr_level.value
    source = result.source.value
    if source == "fallback" and result.confidence < 0.5:
        level = UNKNOWN_LEVEL
    return level, result.confidence, source


async def audit(db: Prisma) -> tuple[list[dict], dict]:
    """Every A2 row that was never graded A2, and what it should be."""
    logger.info("Reading the untrusted A2 rows...")
    rows = await db.query_raw(_SELECT_SQL)
    logger.info(f"  {len(rows)} rows in the two buckets")

    logger.info("Re-classifying (no movie context)...")
    proposals: list[dict] = []
    for row in rows:
        level, confidence, source = _regrade(row["lemma"])
        proposals.append(
            {
                "id": row["id"],
                "lemma": row["lemma"],
                "bucket": _bucket(row["source"], float(row["confidence"])),
                "level": level,
                "confidence": confidence,
                "source": source,
            }
        )

    logger.info("Cross-checking the kids rows against their non-kids scripts...")
    votes: dict[str, Counter] = {}
    for row in await db.query_raw(_KIDS_VOTES_SQL):
        votes.setdefault(row["lemma"], Counter())[row["level"]] = row["votes"]

    checked = agreed = 0
    disagreements: list[tuple[str, str, str]] = []
    for p in proposals:
        tally = votes.get(p["lemma"])
        if p["bucket"] != "kids" or not tally:
            continue
        checked += 1
        consensus = tally.most_common(1)[0][0]
        if consensus == p["level"]:
            agreed += 1
        else:
            disagreements.append((p["lemma"], consensus, p["level"]))

    check = {
        "checked": checked,
        "agreed": agreed,
        "unchecked": sum(1 for p in proposals if p["bucket"] == "kids") - checked,
        "disagreements": disagreements,
    }
    return proposals, check


def report(proposals: list[dict], check: dict) -> None:
    if not proposals:
        logger.info("Nothing to re-grade — both buckets are empty.")
        return

    order = ["A1", "A2", "B1", "B2", "C1", "C2", UNKNOWN_LEVEL]
    for bucket in ("kids", "ungraded"):
        rows = [p for p in proposals if p["bucket"] == bucket]
        if not rows:
            continue
        levels = Counter(p["level"] for p in rows)
        moved = sum(1 for p in rows if p["level"] != "A2")
        logger.info(f"\n{bucket}: {len(rows)} rows, {moved} leave A2")
        for level in order:
            if levels[level]:
                logger.info(
                    f"    {level:<8} {levels[level]:>5}  "
                    f"({levels[level] / len(rows):.1%})"
                )

    logger.info(
        f"\nkids cross-check: {check['agreed']}/{check['checked']} agree with "
        f"their non-kids scripts, {check['unchecked']} had no non-kids grade "
        f"to check against"
    )
    for lemma, consensus, proposed in check["disagreements"][:10]:
        logger.info(f"    {lemma:<18} scripts say {consensus}, classifier says {proposed}")

    logger.info("\nSample of what moves:")
    header = f"  {'lemma':<18} {'bucket':<9} {'A2 ->':<7} {'conf':<6} source"
    logger.info(header)
    logger.info("  " + "-" * (len(header) - 2))
    for p in proposals[:30]:
        logger.info(
            f"  {p['lemma']:<18} {p['bucket']:<9} {p['level']:<7} "
            f"{p['confidence']:<6.2f} {p['source']}"
        )
    if len(proposals) > 30:
        logger.info(f"  ... and {len(proposals) - 30} more")


async def apply(db: Prisma, proposals: list[dict]) -> int:
    """Write the re-grades in chunks."""
    await db.execute_raw(_SNAPSHOT_SQL)
    written = 0
    for start in range(0, len(proposals), CHUNK):
        batch = proposals[start:start + CHUNK]
        # Snapshot and update in one transaction: a chunk that recorded what
        # it was about to change but then failed to change it would describe a
        # rollback nobody needs, and one that changed rows without recording
        # them would be unrecoverable.
        async with db.tx(timeout=TX_TIMEOUT, max_wait=TX_TIMEOUT) as tx:
            await tx.execute_raw(_SNAPSHOT_INSERT_SQL, Json(batch))
            written += await tx.execute_raw(_APPLY_SQL, Json(batch))
        logger.info(f"  {written}/{len(proposals)} rows written")
    return written


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--apply", action="store_true",
        help="Actually write the re-grades. Default is a dry run.",
    )
    args = parser.parse_args()

    db = Prisma()
    await db.connect()
    try:
        proposals, check = await audit(db)
        report(proposals, check)

        if not args.apply:
            logger.info(
                "\nDry run - no writes performed. Re-run with --apply to execute."
            )
            return

        t = time.perf_counter()
        written = await apply(db, proposals)
        logger.info(
            f"Re-graded {written} rows out of the untrusted A2 bucket in "
            f"{time.perf_counter() - t:.1f}s"
        )
    finally:
        await db.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
