"""
One-off repair for lemmas both lemmatizers over-stripped (issue #158).

NLTK's WordNet lemmatizer reads the final "s" of an -ss word as a plural
marker ("boss" -> "bos", "discuss" -> "discus", "pass" -> "pas") and spaCy
folds -ies to the archaic -y ("cookies" -> "cooky"). Every stripped form is a
real dictionary entry, so lemma_guard looked at each one, saw legitimate
English, and kept it. The word therefore exists in the registry twice: a junk
row holding essentially all of the movie mappings and sentence links, and the
correct row holding almost nothing.

src/services/lemma_normalizer.py stops new parses producing these. This script
repairs what is already stored, and it decides what to repair by calling THAT
SAME `correct_lemma` function — not by re-implementing the rule. A backfill
with its own copy of the logic is a backfill that disagrees with the write
path the moment either one is edited.

The evidence it feeds the rule is the real thing: `sentence_lemma_links`
records the surface token each link was matched on, so every proposal is
decided by the tokens that actually produced the lemma. A lemma is only
repaired when a MAJORITY of its recorded tokens vote for the same correction.
That is what separates the 4,532 English "pass"/"passed"/"passing" tokens
filed under `pas` from the 36 French "pas de deux" ones: the majority wins the
row, and a lemma whose tokens genuinely are the rare word keeps it.

Two outcomes per proposal:
  MERGE   the correct row already exists — repoint movie_lemma_mappings and
          sentence_lemma_links, recompute total_movie_count, rewrite
          word_classifications.lemma, delete the junk row.
  RENAME  no correct row exists (`fiberglas`) — rename in place, nothing to
          repoint.

CEFR is repaired with the same merge, because it is corrupted by the same bug
from the other end: the wordlist loader lemmatized its own entries, so
cefrj's "boss" (A2) was filed under `bos` and "pass" (A2) under `pas`. That is
why prod shows the junk rows graded and the real words at B1/UNKNOWN. Where
the curated wordlist knows the corrected form, its grade is written to the
surviving row.

`priority_score` is deliberately NOT recomputed, matching
purge_impure_lemmas.py: the formula's frequency_rank argument is a rank WITHIN
one movie, so there is no meaningful global value to recompute it to here.

DESTRUCTIVE when run with --apply. Default is a dry run. Run from backend/
with the prod DATABASE_URL exported:

    python3.11 fix_overstripped_lemmas.py            # dry run, full report
    python3.11 fix_overstripped_lemmas.py --apply    # actually write
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import time
from datetime import timedelta
from pathlib import Path

from prisma import Prisma

from src.services.cefr_classifier import HybridCEFRClassifier
from src.services.lemma_normalizer import correct_lemma

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("fix_overstripped_lemmas")

#: A correction must be supported by more than this share of the lemma's
#: recorded tokens. Above a half means at most one target can ever win.
MAJORITY = 0.5

#: Interjection spellings that are frequent enough to clear every purity
#: check but are not vocabulary anybody should be taught. `whoo` sits in
#: 1,157 movies with an UNKNOWN level, so #131 — which gives the UNKNOWN
#: bucket an exit path — would otherwise promote it straight into a level
#: deck. Hiding is a read-side patch and is reversible; the row keeps its
#: mappings.
INTERJECTIONS_TO_HIDE = ("whoo",)

#: Per-lemma transaction budget. Generous on purpose: this runs from a laptop
#: over the public database URL, so every statement pays a round trip that the
#: deployed service would not.
TX_TIMEOUT = timedelta(minutes=5)


def build_classifier() -> HybridCEFRClassifier:
    data_dir = Path(__file__).parent / "data" / "cefr"
    logger.info("Loading CEFR wordlists (no embeddings)...")
    return HybridCEFRClassifier(data_dir=data_dir, use_embedding_classifier=False)


async def audit(db: Prisma, classifier) -> list[dict]:
    """Every stored lemma the write-path rule would now correct."""
    rows = await db.query_raw(
        """
        SELECT l.id, l.lemma, l.cefr_level::text AS cefr, l.total_movie_count,
               s.matched_form, count(*)::int AS n
          FROM lemmas l
          JOIN sentence_lemma_links s ON s.lemma_id = l.id
         WHERE s.matched_form IS NOT NULL
         GROUP BY l.id, l.lemma, l.cefr_level, l.total_movie_count, s.matched_form
        """
    )

    # Tally, per lemma, how many recorded tokens vote for each correction.
    votes: dict[str, dict] = {}
    for r in rows:
        lemma = r["lemma"]
        entry = votes.setdefault(
            lemma,
            {
                "id": r["id"],
                "lemma": lemma,
                "cefr": r["cefr"],
                "movies": r["total_movie_count"],
                "targets": {},
                "tokens": 0,
            },
        )
        target = correct_lemma(r["matched_form"], lemma)
        entry["targets"][target] = entry["targets"].get(target, 0) + r["n"]
        entry["tokens"] += r["n"]

    proposals = []
    for entry in votes.values():
        winner, support = max(entry["targets"].items(), key=lambda kv: kv[1])
        if winner == entry["lemma"]:
            continue
        if support <= entry["tokens"] * MAJORITY:
            logger.info(
                f"  skipping {entry['lemma']!r}: best correction {winner!r} has only "
                f"{support}/{entry['tokens']} tokens behind it"
            )
            continue
        entry["target"] = winner
        entry["support"] = support
        proposals.append(entry)

    if not proposals:
        return []

    # Resolve each target to an existing row, and read the grade the curated
    # wordlist holds for it now that the loader keys entries correctly.
    targets = sorted({p["target"] for p in proposals})
    placeholders = ",".join(f"${i + 1}" for i in range(len(targets)))
    existing = await db.query_raw(
        f"SELECT id, lemma, cefr_level::text AS cefr, total_movie_count "
        f"FROM lemmas WHERE lemma IN ({placeholders})",
        *targets,
    )
    by_lemma = {r["lemma"]: r for r in existing}

    wc_counts = await db.query_raw(
        f"SELECT lemma, count(*)::int AS n FROM word_classifications "
        f"WHERE lemma IN ({','.join(f'${i + 1}' for i in range(len(proposals)))}) "
        f"GROUP BY lemma",
        *[p["lemma"] for p in proposals],
    )
    wc_by_lemma = {r["lemma"]: r["n"] for r in wc_counts}

    for p in proposals:
        dst = by_lemma.get(p["target"])
        p["action"] = "MERGE" if dst else "RENAME"
        p["dst_id"] = dst["id"] if dst else None
        p["dst_cefr"] = dst["cefr"] if dst else p["cefr"]
        p["dst_movies"] = dst["total_movie_count"] if dst else 0
        p["wc_rows"] = wc_by_lemma.get(p["lemma"], 0)
        # cefr_wordlist stores (CEFRLevel, ClassificationSource) per entry.
        graded = classifier.cefr_wordlist.get(p["target"])
        p["wordlist_cefr"] = graded[0].value if graded else None

    proposals.sort(key=lambda p: -p["movies"])
    return proposals


async def apply_proposal(db: Prisma, p: dict) -> None:
    src_id, dst_id = p["id"], p["dst_id"]

    if p["action"] == "RENAME":
        await db.execute_raw(
            "UPDATE lemmas SET lemma = $2 WHERE id = $1", src_id, p["target"]
        )
    else:
        # Repoint dependents the target doesn't already hold, drop the rest,
        # then recompute the surviving row's movie count. Same shape as
        # purge_impure_lemmas.apply_lemma_merges.
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
        # user_list_words.lemma_id is ON DELETE SET NULL, not CASCADE, so
        # dropping the junk row would quietly unlink a saved word from the
        # registry instead of failing. The table is empty on prod today; this
        # is here so a later re-run cannot damage real user lists. Its key is
        # (list_id, word), so there is no uniqueness on lemma_id to collide.
        await db.execute_raw(
            "UPDATE user_list_words SET lemma_id = $2 WHERE lemma_id = $1",
            src_id, dst_id,
        )
        await db.execute_raw("DELETE FROM lemmas WHERE id = $1", src_id)
        await db.execute_raw(
            """
            UPDATE lemmas SET total_movie_count =
              (SELECT count(*) FROM movie_lemma_mappings WHERE lemma_id = $1)
             WHERE id = $1
            """,
            dst_id,
        )

    # word_classifications is keyed by surface word with the lemma alongside,
    # so the stored lemma has to follow the registry or the two disagree.
    await db.execute_raw(
        "UPDATE word_classifications SET lemma = $2 WHERE lemma = $1",
        p["lemma"], p["target"],
    )

    # Hand the surviving row the grade the curated wordlist actually holds.
    # The Postgres enum is `proficiencylevel` — Prisma's CEFRLevel is the
    # client-side name and does not exist as a type in the database.
    if p["wordlist_cefr"] and p["wordlist_cefr"] != p["dst_cefr"]:
        await db.execute_raw(
            "UPDATE lemmas SET cefr_level = $2::proficiencylevel WHERE id = $1",
            dst_id or src_id, p["wordlist_cefr"],
        )


async def audit_interjections(db: Prisma) -> list[str]:
    """The listed interjections that are not hidden yet."""
    rows = await db.query_raw(
        """
        SELECT l.lemma, l.total_movie_count
          FROM lemmas l
         WHERE l.lemma = ANY($1::text[])
           AND NOT EXISTS (SELECT 1 FROM hidden_words h
                            WHERE lower(h.word) = l.lemma)
        """,
        list(INTERJECTIONS_TO_HIDE),
    )
    for r in rows:
        logger.info(f"  hide {r['lemma']!r} ({r['total_movie_count']} movies)")
    return [r["lemma"] for r in rows]


async def apply_interjection_hides(db: Prisma, lemmas: list[str]) -> None:
    if not lemmas:
        return
    row = await db.query_first(
        "SELECT id FROM users WHERE is_admin = TRUE ORDER BY id LIMIT 1"
    )
    if not row:
        raise RuntimeError("No admin user found — cannot attribute hide entries.")
    for lemma in lemmas:
        await db.execute_raw(
            """
            INSERT INTO hidden_words (word, hidden_by_id, reason)
            VALUES ($1, $2, $3)
            ON CONFLICT (word) DO NOTHING
            """,
            lemma, row["id"], "auto: interjection, not teachable vocabulary (#158)",
        )
    logger.info(f"Hid {len(lemmas)} interjections.")


def report(proposals: list[dict]) -> None:
    if not proposals:
        logger.info("No over-stripped lemmas found. Nothing to do.")
        return
    logger.info(f"{len(proposals)} lemmas to repair:\n")
    header = (
        f"  {'lemma':<12} {'->':<12} {'act':<7} {'movies':>7} {'links':>6} "
        f"{'wc':>6}  {'cefr':<20} tokens behind it"
    )
    logger.info(header)
    logger.info("  " + "-" * (len(header) - 2))
    for p in proposals:
        cefr = f"{p['cefr']}/{p['dst_cefr']}"
        if p["wordlist_cefr"] and p["wordlist_cefr"] != p["dst_cefr"]:
            cefr += f" -> {p['wordlist_cefr']}"
        logger.info(
            f"  {p['lemma']:<12} {p['target']:<12} {p['action']:<7} "
            f"{p['movies']:>7} {p['tokens']:>6} {p['wc_rows']:>6}  {cefr:<20} "
            f"{p['support']}/{p['tokens']}"
        )


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true",
                        help="Actually merge/rename/rewrite. Default is a dry run.")
    args = parser.parse_args()

    classifier = build_classifier()

    db = Prisma()
    await db.connect()
    try:
        proposals = await audit(db, classifier)
        report(proposals)
        logger.info("\nInterjections to hide:")
        to_hide = await audit_interjections(db)
        if not to_hide:
            logger.info("  (none — already hidden)")

        if not args.apply:
            logger.info("\nDry run - no writes performed. Re-run with --apply to execute.")
            return

        t = time.perf_counter()
        for p in proposals:
            # One transaction per lemma. Without it a failure part-way through
            # leaves the repair half-done — the junk row deleted and its data
            # repointed, but the surviving row still carrying the wrong CEFR,
            # which is exactly what a bad enum cast did on the first run.
            # Prisma's interactive transactions default to a 5s budget, which
            # `bos` alone blows through — it repoints 1,771 links and 1,597
            # mappings and rewrites 1,730 classification rows.
            async with db.tx(timeout=TX_TIMEOUT, max_wait=TX_TIMEOUT) as tx:
                await apply_proposal(tx, p)
        logger.info(
            f"Repaired {len(proposals)} lemmas in {time.perf_counter() - t:.1f}s"
        )
        await apply_interjection_hides(db, to_hide)
    finally:
        await db.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
