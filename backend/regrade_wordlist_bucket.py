"""
Re-grade the registry rows the two wordlist defects graded wrongly.

WHAT WENT WRONG

Two independent bugs, both fixed in cefr_classifier.py, both leaving bad rows
behind in `lemmas` that the fix cannot reach on its own:

  1. WORDLIST COLLISION (source='efllex'). The graded wordlists grade surface
     FORMS; `cefr_wordlist` is keyed by LEMMA. That is a many-to-one map with
     952 collisions, and the merge rule was "whichever entry was read first
     wins" — so `made`=B2 claimed the key `make` before `make`=A1 could,
     `said`=B2 claimed `say`, `ran`=B2 claimed `run`, `babies`=C1 claimed
     `baby`. 68 lemmas ended up graded harder than their own base form says.

     The damage doubles at lookup time, which is why the target set is every
     efllex row and not just those 68: an inflected form resolves to the same
     poisoned key, so the separate registry row for `amazing` (frequency rank
     79) read B2 off `amaze`, and `excited` (rank 181) read B2 off `excite`.

  2. NO CORPUS AT ALL (source='frequency_backoff', confidence=0.20). The Zipf
     ladder's final branch treated "this word appears in no corpus wordfreq
     knows about" as B2 at confidence 0.20, described in the code as benefit
     of the doubt. Absence of evidence is not evidence of difficulty, and B2
     duly became the drain for everything unrecognisable: 1,393 rows, of which
     684 pass `feed_eligibility_sql` and reach a real deck — `triregnum`,
     `bushwa`, `scrumple`, `quackster`, `muttonhead`, `washrag`, `traitress`.

     Same shape as the A2 default #91 removed and regrade_a2_bucket.py
     repaired, one band up. That branch now returns None, so these words fall
     through to the UNKNOWN terminal case: stored, countable, never taught.

WHY THESE TWO BUCKETS AND NOT A WHOLE-TABLE RE-GRADE

Re-classifying every row would silently re-open decisions other passes made
deliberately — #91/#119's UNKNOWN bucket, #158's over-stripped lemmas,
regrade_a2_bucket's 7,160 rows, the kids and informal-slang whitelists.

The first draft of this script scoped the wordlist bucket to `source='efllex'`
and wrote wherever the classifier now disagreed. The dry run is what caught
that: it proposed `climb` A1->A2, `believe` A1->A2, `fly` A1->A2, all landing
on `fallback` at confidence 0.95 — the informal/kids whitelist, which takes
precedence over the wordlist in `classify_word` and had nothing to do with
either bug. 88 of the 233 proposals were that, making words HARDER on the
authority of a list this pass never intended to consult.

So the scope is now attribution, not disagreement, and it is checked twice:

  * `_wordlist_relaxed` on the classifier is the exact set of lemma keys the
    old first-wins rule graded too hard. A registry row qualifies only if its
    lemma resolves into that set.
  * The fix is monotonic — picking the easiest of a colliding group can only
    lower a level, never raise one — so a proposal that makes a word harder or
    leaves it unchanged is by definition not this bug, and is dropped.

The no_corpus bucket needs neither test: `source='frequency_backoff'` with
confidence below 0.3 is that branch's signature and nothing else's.

THE CROSS-CHECK

regrade_a2_bucket.py could check its proposals against `word_classifications`,
because those rows recorded what non-kids scripts thought. That check is not
available here: `word_classifications` was written by the same classifier
carrying the same poisoned wordlist, so it agrees with the bug by construction.

CEFR-J is genuinely independent — a different project, different method,
different corpus — so the report scores the proposals against
`data/cefr/cefrj_vocabulary.csv` instead. Treat it as a smell test, not a
verdict: CEFR-J and the shipped list already disagree on 25% of the words they
share, which is the ordinary disagreement rate between two CEFR gradings and
not a defect in either.

CONCURRENCY

The UPDATE matches on the old level AND old source as well as the id, so a row
someone re-graded between the audit and the write is skipped rather than
stamped back to whatever this pass computed. That compare-and-set is also what
makes the script idempotent: a second run recomputes the same grades, finds
them already stored, and proposes nothing.

WHAT IT DOES NOT TOUCH

`word_classifications` — the per-script view, rebuilt whenever a script is
re-parsed, and not what any reader trusts for a level (`trusted_registry_sql`).

`priority_score` — matching regrade_a2_bucket.py, backfill_unknown_bucket.py
and purge_impure_lemmas.py: the score's frequency term is a rank within one
movie, so there is no global value to recompute it to.

Rows in `hidden_words` are re-graded like any other. They are invisible today,
but hidden-ness is a display decision that can be reversed, and leaving a
known-wrong grade behind it just buries the next bug.

DESTRUCTIVE when run with --apply. Default is a dry run. Run from backend/
with the prod DATABASE_URL exported:

    python3.11 regrade_wordlist_bucket.py            # dry run, full report
    python3.11 regrade_wordlist_bucket.py --apply    # actually write
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import logging
import time
from collections import Counter
from datetime import timedelta
from pathlib import Path

from prisma import Json, Prisma

from src.services.cefr_classifier import get_shared_classifier
from src.services.lemmatization_service import UNKNOWN_LEVEL

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("regrade_wordlist_bucket")

#: Rows per UPDATE ... FROM statement — the #145 lesson (aggregate and write in
#: SQL, never loop). The target set is ~12k rows, so this is a dozen round
#: trips rather than twelve thousand.
CHUNK = 1000

#: Per-chunk transaction budget. Generous for the same reason
#: regrade_a2_bucket.py's is: this runs from a laptop over the public database
#: URL, so every statement pays a round trip the deployed service would not,
#: and Prisma's interactive transactions default to 5 seconds.
TX_TIMEOUT = timedelta(minutes=5)

#: The Zipf ladder's confidences are 0.8 / 0.75 / 0.65 / 0.55 / 0.45 / 0.35 and
#: then 0.20 for the zipf==0 branch, so anything under this bound is that
#: branch and nothing else. A bound rather than `= 0.2` because stored doubles
#: drift — prod holds 0.5499999999999982 alongside 0.55 in the same column.
NO_CORPUS_CONFIDENCE_MAX = 0.3

CEFRJ_PATH = Path(__file__).resolve().parent / "data" / "cefr" / "cefrj_vocabulary.csv"


def target_sql(alias: str = "") -> str:
    """WHERE-clause fragment: this row was graded by one of the two defects.

    Written once and reused by the SELECT, the snapshot and the UPDATE, so the
    set being reported on cannot drift from the set being written — the same
    reason regrade_a2_bucket.py has one.

    Compares literals against the enum columns rather than casting them to
    text; a `cefr_level::text` predicate is what mis-planned the vocabulary
    queries in #118.

    `alias` is written by the caller, never user input, and is interpolated.
    Pass "" for an unaliased single-table query.
    """
    p = f"{alias}." if alias else ""
    return (
        f"({p}source = 'efllex' "
        f"OR ({p}source = 'frequency_backoff' "
        f"AND {p}confidence < {NO_CORPUS_CONFIDENCE_MAX}))"
    )


_SELECT_SQL = f"""
    SELECT id, lemma, cefr_level::text AS cefr_level, confidence,
           source::text AS source
      FROM lemmas
     WHERE {target_sql()}
     ORDER BY id
"""

#: Undo table, following regrade_a2_bucket's regrade_a2_snapshot and #119's
#: backfill_119_unknown_snapshot. Written inside the same transaction as the
#: update, so it cannot end up describing a state that was never reached.
_SNAPSHOT_SQL = """
    CREATE TABLE IF NOT EXISTS regrade_wordlist_snapshot (
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

_SNAPSHOT_INSERT_SQL = """
    INSERT INTO regrade_wordlist_snapshot (
        lemma_id, lemma, bucket, old_level, old_conf, old_source,
        new_level, new_conf, new_source
    )
    SELECT l.id, l.lemma, v.bucket, l.cefr_level::text, l.confidence,
           l.source::text, v.level, v.confidence, v.source
      FROM JSONB_TO_RECORDSET($1::jsonb) AS v(
           id int, bucket text, level text, confidence double precision,
           source text, old_level text, old_source text
       )
      JOIN lemmas l ON l.id = v.id
     WHERE l.cefr_level = v.old_level::proficiencylevel
       AND l.source     = v.old_source::classificationsource
    ON CONFLICT (lemma_id) DO NOTHING
"""

#: Compare-and-set on (id, old level, old source): a row that changed under us
#: between the audit and the write is skipped rather than overwritten. This is
#: also what makes a second run a no-op — by then every row already holds the
#: value this pass computes, so nothing is proposed in the first place.
_APPLY_SQL = """
    UPDATE lemmas AS l
       SET cefr_level = v.level::proficiencylevel,
           confidence = v.confidence,
           source     = v.source::classificationsource,
           updated_at = NOW()
      FROM JSONB_TO_RECORDSET($1::jsonb) AS v(
           id int, level text, confidence double precision, source text,
           old_level text, old_source text
       )
     WHERE l.id = v.id
       AND l.cefr_level = v.old_level::proficiencylevel
       AND l.source     = v.old_source::classificationsource
"""


#: Easiest first, matching _WORDLIST_LEVEL_ORDER. UNKNOWN is absent because it
#: is not a level and does not sit anywhere on this scale.
LEVEL_ORDER = ("A1", "A2", "B1", "B2", "C1", "C2")


def _bucket(source: str) -> str:
    """Which defect graded this row — see the module docstring."""
    return "wordlist" if source == "efllex" else "no_corpus"


def _is_relaxation(old_level: str, new_level: str) -> bool:
    """True if `new_level` is strictly easier than `old_level`.

    The collision fix takes the easiest of a colliding group where the old rule
    took whichever was read first, so its effect on any lemma is monotonically
    downward. Anything else the classifier now wants to do to an efllex row is
    some other mechanism's opinion and not this pass's business.
    """
    if old_level not in LEVEL_ORDER or new_level not in LEVEL_ORDER:
        return False
    return LEVEL_ORDER.index(new_level) < LEVEL_ORDER.index(old_level)


def _regrade(lemma: str) -> tuple[str, float, str]:
    """The grade this word gets now, with no movie context: (level, conf, src).

    No `is_kids_genre` argument, deliberately — that flag is what created the
    kids bucket regrade_a2_bucket.py had to repair, and the registry is the one
    place a per-movie judgement must never reach.

    A classifier result that is itself an ungraded fallback is written as
    UNKNOWN rather than as a level, matching regrade_a2_bucket.py. This is the
    path the no_corpus bucket takes now that the zipf==0 branch returns None.
    """
    result = get_shared_classifier().classify_word(lemma)
    level = result.cefr_level.value
    source = result.source.value
    if source == "fallback" and result.confidence < 0.5:
        level = UNKNOWN_LEVEL
    return level, result.confidence, source


def _load_cefrj() -> dict[str, str]:
    """CEFR-J's grade per headword — the independent check, easiest sense."""
    order = ["A1", "A2", "B1", "B2", "C1", "C2"]
    graded: dict[str, str] = {}
    if not CEFRJ_PATH.exists():
        return graded
    with open(CEFRJ_PATH, "r", encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            level = (row.get("CEFR") or "").strip().upper()
            if level not in order:
                continue
            for variant in (row.get("headword") or "").split("/"):
                word = variant.strip().lower()
                if not word.isalpha():
                    continue
                if word not in graded or order.index(level) < order.index(graded[word]):
                    graded[word] = level
    return graded


async def audit(db: Prisma) -> tuple[list[dict], dict]:
    """Every row the two defects graded, and what it should be now."""
    logger.info("Reading the rows graded by the wordlist and zipf=0 paths...")
    rows = await db.query_raw(_SELECT_SQL)
    logger.info(f"  {len(rows)} rows in the two buckets")

    classifier = get_shared_classifier()
    relaxed = classifier._wordlist_relaxed
    logger.info(
        f"  the collision fix relaxed {len(relaxed)} wordlist keys; "
        f"only rows resolving into that set are in scope"
    )

    logger.info("Re-classifying (no movie context)...")
    proposals: list[dict] = []
    unchanged = Counter()
    out_of_scope = Counter()
    for row in rows:
        bucket = _bucket(row["source"])
        level, confidence, source = _regrade(row["lemma"])

        if level == row["cefr_level"] and source == row["source"]:
            unchanged[bucket] += 1
            continue

        if bucket == "wordlist":
            # Attribution, then monotonicity — see the module docstring.
            if classifier._get_lemma_simple(row["lemma"]) not in relaxed:
                out_of_scope["not a relaxed lemma"] += 1
                continue
            if not _is_relaxation(row["cefr_level"], level):
                out_of_scope["would not make the word easier"] += 1
                continue

        proposals.append(
            {
                "id": row["id"],
                "lemma": row["lemma"],
                "bucket": bucket,
                "level": level,
                "confidence": confidence,
                "source": source,
                "old_level": row["cefr_level"],
                "old_source": row["source"],
            }
        )

    logger.info("Cross-checking against CEFR-J...")
    cefrj = _load_cefrj()
    checked = agreed = 0
    for p in proposals:
        their = cefrj.get(p["lemma"])
        if not their:
            continue
        checked += 1
        if their == p["level"]:
            agreed += 1

    return proposals, {
        "scanned": len(rows),
        "unchanged": unchanged,
        "out_of_scope": out_of_scope,
        "relaxed_keys": len(relaxed),
        "checked": checked,
        "agreed": agreed,
    }


def report(proposals: list[dict], check: dict) -> None:
    logger.info(
        f"\nScanned {check['scanned']} rows; "
        f"{sum(check['unchanged'].values())} already hold the right grade."
    )
    for reason, n in check["out_of_scope"].most_common():
        logger.info(f"    {n:>5} left alone — {reason}")
    if not proposals:
        logger.info("Nothing to re-grade — both buckets are clean.")
        return

    order = ["A1", "A2", "B1", "B2", "C1", "C2", UNKNOWN_LEVEL]
    for bucket in ("wordlist", "no_corpus"):
        rows = [p for p in proposals if p["bucket"] == bucket]
        if not rows:
            continue
        logger.info(
            f"\n{bucket}: {len(rows)} rows change "
            f"({check['unchanged'][bucket]} already correct)"
        )
        moves = Counter(f"{p['old_level']} -> {p['level']}" for p in rows)
        for move, n in moves.most_common(12):
            logger.info(f"    {move:<20} {n:>5}")
        if len(moves) > 12:
            logger.info(f"    ... and {len(moves) - 12} more transitions")

    net = Counter()
    for p in proposals:
        net[p["old_level"]] -= 1
        net[p["level"]] += 1
    logger.info("\nNet change per level across the whole registry:")
    for level in order:
        if net[level]:
            logger.info(f"    {level:<8} {net[level]:+6}")

    if check["checked"]:
        logger.info(
            f"\nCEFR-J cross-check: {check['agreed']}/{check['checked']} of the "
            f"changed rows land on CEFR-J's level "
            f"({check['agreed'] / check['checked']:.0%}). The two lists already "
            f"disagree on 25% of shared words, so this is a smell test."
        )

    logger.info("\nSample of what moves:")
    header = f"  {'lemma':<18} {'bucket':<10} {'from':<8} {'to':<8} {'conf':<6} source"
    logger.info(header)
    logger.info("  " + "-" * (len(header) - 2))
    for p in proposals[:30]:
        logger.info(
            f"  {p['lemma']:<18} {p['bucket']:<10} {p['old_level']:<8} "
            f"{p['level']:<8} {p['confidence']:<6.2f} {p['source']}"
        )
    if len(proposals) > 30:
        logger.info(f"  ... and {len(proposals) - 30} more")


async def apply(db: Prisma, proposals: list[dict]) -> int:
    """Write the re-grades in chunks."""
    await db.execute_raw(_SNAPSHOT_SQL)
    written = 0
    for start in range(0, len(proposals), CHUNK):
        batch = proposals[start:start + CHUNK]
        # Snapshot and update in one transaction: a chunk that recorded what it
        # was about to change but then failed to change it would describe a
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
            f"Re-graded {written} rows in {time.perf_counter() - t:.1f}s"
        )
        if written != len(proposals):
            logger.warning(
                f"{len(proposals) - written} rows were skipped because they "
                f"changed under us between the audit and the write."
            )
    finally:
        await db.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
