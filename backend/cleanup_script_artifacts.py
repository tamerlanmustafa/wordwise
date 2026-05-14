"""
Delete word_classifications rows that look like script-tokenization artifacts
— "words" that never appear as a standalone token in their movie's cleaned
script (only as substrings of longer words like 'rosatos' → 'atos',
'welched' → 'ched').

Same heuristic as audit_script_artifacts.py, scored 1–5. Defaults to dry-run
and `--min-score 4` so you can preview the highest-confidence deletes first.

Run:
    cd backend

    # Dry-run, top scores only, single movie
    python3.11 cleanup_script_artifacts.py --movie 47

    # Dry-run across all movies, score >= 4
    python3.11 cleanup_script_artifacts.py

    # Actually delete (high confidence only)
    python3.11 cleanup_script_artifacts.py --apply

    # Lower threshold for a second pass once you've eyeballed the report
    python3.11 cleanup_script_artifacts.py --min-score 2 --apply

Notes:
  • Operates per-movie. Deleting "ette" from Godfather II does not touch
    any other movie's "ette" rows. Other movies are evaluated independently.
  • Only word_classifications rows are removed. SentenceLemmaLink rows
    that referenced the deleted lemmas stay (they're keyed by lemma, not
    by classification, and may be useful for other movies). They're cheap
    and won't be queried because nothing asks for them.
  • Idempotent — re-running after --apply finds no new artifacts unless
    new movies were classified.
"""
import argparse
import asyncio
import re
import logging
from typing import List, Optional, Set

from prisma import Prisma

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("cleanup")

SUFFIX_FRAGMENTS = (
    "ed", "ing", "ous", "tion", "ation", "ies", "ched", "atos", "ssed",
    "ght", "hed", "ned", "ked", "ped", "med", "fed", "ved", "wed", "zed",
)


def score_classification(word: str, lemma_known: bool) -> int:
    """Score 1..5 — higher means more likely a script artifact.
    Caller has already confirmed the word fails the standalone-token check
    (heuristic 1, baseline +1)."""
    score = 1
    if not lemma_known:
        score += 2
    if any(word.endswith(s) for s in SUFFIX_FRAGMENTS) and len(word) <= 6:
        score += 1
    if len(word) <= 4:
        score += 1
    return score


async def fetch_movie_ids(db: Prisma, single: Optional[int]) -> List[int]:
    if single is not None:
        return [single]
    rows = await db.query_raw(
        """
        SELECT DISTINCT ms.movie_id
        FROM movie_scripts ms
        JOIN word_classifications wc ON wc.script_id = ms.id
        ORDER BY ms.movie_id
        """
    )
    return [int(r["movie_id"]) for r in rows]


async def cleanup_movie(
    db: Prisma,
    movie_id: int,
    *,
    min_score: int,
    apply: bool,
    show_examples: int,
) -> dict:
    movie = await db.movie.find_unique(
        where={"id": movie_id},
        include={"movieScripts": True},
    )
    if not movie or not movie.movieScripts or not movie.movieScripts[0].cleanedScriptText:
        return {"movie_id": movie_id, "skipped": True}

    script = movie.movieScripts[0].cleanedScriptText.lower()
    classifications = await db.wordclassification.find_many(
        where={"scriptId": movie.movieScripts[0].id}
    )

    unique_lemmas = list({wc.lemma.lower() for wc in classifications})
    lemma_records = await db.lemma.find_many(where={"lemma": {"in": unique_lemmas}})
    known_lemmas: Set[str] = {lr.lemma for lr in lemma_records}

    to_delete_ids: List[int] = []
    samples: List[dict] = []
    for wc in classifications:
        word = wc.word.lower()
        if re.search(rf"\b{re.escape(word)}\b", script):
            continue  # standalone token exists — keep
        score = score_classification(word, wc.lemma.lower() in known_lemmas)
        if score < min_score:
            continue
        to_delete_ids.append(wc.id)
        if len(samples) < show_examples:
            samples.append({"word": word, "lemma": wc.lemma.lower(), "score": score})

    deleted = 0
    if apply and to_delete_ids:
        # Chunked delete to keep parameter counts reasonable.
        CHUNK = 500
        for i in range(0, len(to_delete_ids), CHUNK):
            batch = to_delete_ids[i : i + CHUNK]
            res = await db.wordclassification.delete_many(where={"id": {"in": batch}})
            deleted += res

    return {
        "movie_id": movie_id,
        "title": movie.title,
        "candidates": len(to_delete_ids),
        "deleted": deleted,
        "samples": samples,
    }


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--movie", type=int, help="Operate on a single movie id")
    ap.add_argument("--min-score", type=int, default=4, help="Minimum artifact score to delete (default 4)")
    ap.add_argument("--apply", action="store_true", help="Actually delete (default is dry-run)")
    ap.add_argument("--show-examples", type=int, default=5, help="Per-movie examples to print (default 5)")
    ap.add_argument("--quiet", action="store_true", help="Only print totals + non-zero movies")
    args = ap.parse_args()

    mode = "APPLY" if args.apply else "DRY-RUN"
    logger.info(f"{mode} | min_score={args.min_score}")

    db = Prisma()
    await db.connect()
    try:
        movie_ids = await fetch_movie_ids(db, args.movie)
        logger.info(f"Inspecting {len(movie_ids)} movie(s)")

        global_candidates = 0
        global_deleted = 0
        movies_with_hits = 0

        for mid in movie_ids:
            r = await cleanup_movie(
                db, mid,
                min_score=args.min_score,
                apply=args.apply,
                show_examples=args.show_examples,
            )
            if r.get("skipped"):
                continue
            global_candidates += r["candidates"]
            global_deleted += r["deleted"]
            if r["candidates"] > 0:
                movies_with_hits += 1
                if not args.quiet or args.movie:
                    sample_text = ", ".join(
                        f"{s['word']}(score={s['score']}, lemma={s['lemma']})"
                        for s in r["samples"]
                    )
                    action = f"deleted {r['deleted']}" if args.apply else f"would delete {r['candidates']}"
                    logger.info(
                        f"movie={mid:<5} {action:<22} title={r['title'][:40]!r:<42} samples: {sample_text}"
                    )

        verb = "Deleted" if args.apply else "Would delete"
        logger.info(
            f"=== DONE === movies_inspected={len(movie_ids)} "
            f"movies_with_hits={movies_with_hits} candidates={global_candidates} "
            f"{verb.lower()}={global_deleted if args.apply else global_candidates}"
        )
    finally:
        await db.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
