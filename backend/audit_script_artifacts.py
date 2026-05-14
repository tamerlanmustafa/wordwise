"""
Audit `word_classifications` for likely script-tokenization artifacts:
classified "words" that never appear as standalone tokens in the movie's
cleaned script — only as substrings of longer words (e.g. "ched" inside
"watched", "atos" inside "rosatos").

Read-only. Prints a report; does not modify any rows.

Run:
    cd backend
    python3.11 audit_script_artifacts.py --movie 47          # one movie
    python3.11 audit_script_artifacts.py --movie 47 --limit 50
    python3.11 audit_script_artifacts.py                     # all movies, summary only

Heuristics, ranked by signal strength:
  1. Surface form does NOT match `\\b{word}\\b` anywhere in the script
     (strongest signal — real words always appear as standalone tokens)
  2. Lemma is missing from the global `lemmas` table
     (real English words almost always have a global lemma row)
  3. Word is short (<=4 chars) AND ends in a common suffix fragment
     (-ed, -ing, -ous, -tion, -ation, -ies, -atos, -ched...)
"""
import argparse
import asyncio
import re
import logging
from collections import defaultdict
from typing import List, Optional, Set

from prisma import Prisma

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("audit")

SUFFIX_FRAGMENTS = (
    "ed", "ing", "ous", "tion", "ation", "ies", "ched", "atos", "ssed",
    "ght", "hed", "ned", "ked", "ped", "med", "fed", "ved", "wed", "zed",
)


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


async def audit_movie(db: Prisma, movie_id: int, limit: Optional[int]) -> dict:
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

    # Bulk-fetch which lemmas exist globally so we don't N+1 the lemmas table.
    unique_lemmas = list({wc.lemma.lower() for wc in classifications})
    lemma_records = await db.lemma.find_many(where={"lemma": {"in": unique_lemmas}})
    known_lemmas: Set[str] = {lr.lemma for lr in lemma_records}

    suspicious: List[dict] = []
    for wc in classifications:
        word = wc.word.lower()
        # Heuristic 1: standalone-token check (the strongest signal).
        if re.search(rf"\b{re.escape(word)}\b", script):
            continue  # real word, appears standalone — keep it
        # Confirmed: never appears as a standalone token. It IS in the script
        # somewhere (otherwise classification wouldn't have produced it),
        # so it must only show up as a substring of longer words.
        host_words = []
        # Find up to 3 example "host" words (longer words containing this fragment).
        for m in re.finditer(re.escape(word), script):
            ctx_start = max(0, m.start() - 12)
            ctx_end = min(len(script), m.end() + 12)
            ctx = script[ctx_start:ctx_end].replace("\n", " ")
            host_words.append(ctx)
            if len(host_words) >= 3:
                break

        # Bonus signals
        lemma_missing = wc.lemma.lower() not in known_lemmas
        suffix_match = any(word.endswith(s) for s in SUFFIX_FRAGMENTS) and len(word) <= 6

        score = 1  # heuristic 1 already satisfied (standalone-miss)
        if lemma_missing:
            score += 2
        if suffix_match:
            score += 1
        if len(word) <= 4:
            score += 1

        suspicious.append({
            "word": word,
            "lemma": wc.lemma.lower(),
            "lemma_known": not lemma_missing,
            "suffix_fragment": suffix_match,
            "score": score,
            "hosts": host_words,
        })

    suspicious.sort(key=lambda x: -x["score"])
    if limit:
        suspicious = suspicious[:limit]

    return {
        "movie_id": movie_id,
        "title": movie.title,
        "total_classifications": len(classifications),
        "standalone_misses": len(suspicious),
        "suspicious": suspicious,
    }


def render_report(report: dict) -> None:
    print(f"\n=== {report['title']} (movie {report['movie_id']}) ===")
    print(
        f"  classifications: {report['total_classifications']} | "
        f"standalone-misses (likely artifacts): {report['standalone_misses']} "
        f"({100 * report['standalone_misses'] / max(report['total_classifications'], 1):.1f}%)"
    )
    if not report["suspicious"]:
        return
    print(f"  {'word':<20} {'lemma':<20} {'in_lemmas':<10} {'suffix':<8} {'score':<6} hosts")
    for s in report["suspicious"]:
        host_preview = " | ".join(h.strip()[:30] for h in s["hosts"][:2])
        print(
            f"  {s['word']:<20} {s['lemma']:<20} {str(s['lemma_known']):<10} "
            f"{str(s['suffix_fragment']):<8} {s['score']:<6} {host_preview}"
        )


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--movie", type=int, help="Audit a single movie id")
    ap.add_argument("--limit", type=int, default=30, help="Cap suspicious entries shown per movie")
    ap.add_argument("--summary-only", action="store_true", help="Only print totals when running across all movies")
    args = ap.parse_args()

    db = Prisma()
    await db.connect()
    try:
        movie_ids = await fetch_movie_ids(db, args.movie)
        logger.info(f"Auditing {len(movie_ids)} movie(s)")
        global_total = 0
        global_artifacts = 0
        for mid in movie_ids:
            r = await audit_movie(db, mid, args.limit)
            if r.get("skipped"):
                continue
            global_total += r["total_classifications"]
            global_artifacts += r["standalone_misses"]
            if not args.summary_only or args.movie:
                render_report(r)
        if not args.movie:
            print(
                f"\n=== GLOBAL ===\n"
                f"  total classifications: {global_total}\n"
                f"  likely artifacts:      {global_artifacts} "
                f"({100 * global_artifacts / max(global_total, 1):.2f}%)"
            )
    finally:
        await db.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
