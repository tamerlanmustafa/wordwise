"""
One-shot: populate `lemmas.pos` for the rows that never got one.

The cards print "(noun) a wild animal like a large dog" — the label comes from
`lemmas.pos`. 5,839 of 42,668 lemmas have no tag, and they are not a random
sample: every lemma created in March 2026 (the first import) is untagged and
everything created from April onward is tagged, so the hole sits precisely on
the oldest, most common vocabulary. A1 is 19.8% tagged against C1's 95.3%,
which is why `wolf` and `bank` show no label while `linger` and `reluctant` do.
Explore draws frequent words first, so the reader meets the gap constantly.

`word_classifications.pos` cannot fill it — that column is NULL on all 4.8M
rows in prod. The tag has to be derived.

WHERE THE TAG COMES FROM
------------------------
Each lemma is tagged from its OWN global example sentence, resolved with the
same ordering `definition_worker`, `/srs/feed` and both enrichment endpoints
use (is_representative DESC, score DESC NULLS LAST, sentence_id ASC). That is
the point, not an implementation detail: the definition printed beside the
label was generated from that exact sentence, so tagging the same sentence is
what keeps "(verb)" from appearing in front of a noun's gloss. Tagging the bare
headword instead would answer a different question — "what is this word
usually?" — and would disagree with the card's own gloss on every ambiguous
word in the corpus.

It also means the backfill covers exactly what is visible: 5,564 of the 5,839
untagged lemmas have a global sentence, and a lemma WITHOUT one cannot reach an
Explore card or a deck card at all (both surfaces require the sentence). The
275 left behind are invisible either way.

WHEN IT WRITES NOTHING
----------------------
A wrong label is worse than no label: no label costs a reader nothing, a wrong
one teaches them something false. So the tag is skipped, leaving NULL for a
later run, when:

  * the target word cannot be located in its own sentence (nothing to tag);
  * the lemma is multi-word — "give up" spans two tokens with two tags, and
    picking one of them is a guess this script has no business making;
  * the only occurrence is the sentence's first word AND spaCy called it PROPN.
    Sentence-initial capitals are where the tagger's proper-noun branch does
    its worst (the same branch behind #91's A2 bucket), and these lemmas are
    ordinary vocabulary — "Wolves hunt in packs" must not make `wolf` a name;
  * the tag is structural junk (PUNCT/SPACE/NUM/SYM/X), which means the token
    match was wrong rather than that the word is a symbol.

Idempotent: only rows with `pos IS NULL` are read, and the UPDATE re-asserts
that predicate, so an interrupted run resumes and a second full run is a no-op.
It sets `pos` and nothing else — `cefr_level`, `source` and `confidence` are
the columns #91/#119 re-graded, and `definition` is the worker's.

Run from the backend/ directory with the interpreter that has Prisma and spaCy
(python3.11 on this machine — `python3` is Apple's 3.9):

    cd backend
    DATABASE_URL=... python3.11 backfill_lemma_pos.py --dry-run   # counts + sample
    DATABASE_URL=... python3.11 backfill_lemma_pos.py --limit 200 # smoke run
    DATABASE_URL=... python3.11 backfill_lemma_pos.py             # everything

Cost: spaCy only — no LLM calls and no external APIs. ~5,500 short sentences
through `nlp.pipe` is a couple of minutes of local CPU. It runs OFF the API
process, so the event-loop rule in CLAUDE.md is not in play here; nothing in
this file may be imported by a request path.
"""
import argparse
import asyncio
import json
import logging
import time
from typing import Any, Dict, List, Optional

from prisma import Prisma

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("backfill_lemma_pos")
logging.getLogger("httpx").setLevel(logging.WARNING)

#: One row per untagged lemma: its canonical global sentence and the surface
#: form the tagger recorded. DISTINCT ON with the shared anchor ordering, so
#: this picks the same sentence the definition was written from.
PENDING_SQL = """
    SELECT DISTINCT ON (l.id)
        l.id             AS id,
        l.lemma          AS lemma,
        l.is_multi_word  AS is_multi_word,
        sb.sentence      AS sentence,
        sll.matched_form AS matched_form
    FROM lemmas l
    JOIN sentence_lemma_links sll ON sll.lemma_id = l.id AND sll.is_global
    JOIN sentence_bank sb ON sb.id = sll.sentence_id
    WHERE l.pos IS NULL
    ORDER BY
        l.id,
        sll.is_representative DESC,
        sll.score DESC NULLS LAST,
        sll.sentence_id ASC
"""

#: One UPDATE per chunk against a values list, not a statement per row — 5.5k
#: round trips is the shape #145 measured as worse than the payload it saves.
#: The `pos IS NULL` guard is what makes a re-run a no-op instead of an
#: overwrite of tags written in the meantime.
UPDATE_SQL = """
    UPDATE lemmas AS l
    SET pos = r.pos
    FROM JSONB_TO_RECORDSET($1::jsonb) AS r(id int, pos text)
    WHERE l.id = r.id
      AND l.pos IS NULL
"""

CHUNK = 1000

#: Tags that mean the token match went wrong, not that the word is punctuation.
JUNK_TAGS = {"PUNCT", "SPACE", "NUM", "SYM", "X"}


def resolve_pos(doc, lemma: str, matched_form: Optional[str]) -> Optional[str]:
    """The UPOS tag for `lemma` as used in `doc`, or None to leave it NULL.

    `doc` is any spaCy Doc (only `text`, `lemma_`, `pos_` and `i` are read, so
    tests can hand it a list of stubs).

    Candidates are found by surface form first — that is what the tagger
    actually recorded for this link — then by lemma, which catches an inflection
    the recorded form missed. Among several occurrences the first NON
    sentence-initial one wins: position 0 is where the proper-noun branch
    misfires, and any later occurrence of the same word carries the same sense
    with none of that risk.
    """
    needle = (matched_form or "").strip().lower()
    lem = (lemma or "").strip().lower()

    by_form = [t for t in doc if t.text.lower() == needle] if needle else []
    by_lemma = [t for t in doc if (t.lemma_ or "").lower() == lem] if lem else []
    candidates = by_form or by_lemma
    if not candidates:
        return None

    # Prefer a token that is not the first word of the sentence.
    token = next((t for t in candidates if t.i > 0), candidates[0])
    tag = (token.pos_ or "").strip().upper()

    if not tag or tag in JUNK_TAGS:
        return None
    if tag == "PROPN" and token.i == 0:
        # Only ever seen at the start of the sentence, where a capital letter
        # alone can produce this tag. Not enough evidence for a label.
        return None
    return tag


def tag_rows(rows: List[Dict[str, Any]], nlp) -> List[Dict[str, str]]:
    """Tag a batch of pending lemmas in ONE pass of the parser.

    `nlp.pipe` over the whole batch rather than a parse per lemma: same reason
    the SRS lemmatizer batches (#144) — 5.5k separate `nlp()` calls cost several
    times what one pipe does, and the per-call overhead dwarfs the text.

    Multi-word lemmas are dropped before the parser sees them; they have no
    single token to read a tag off.
    """
    taggable = [
        r for r in rows
        if not r.get("is_multi_word") and (r.get("sentence") or "").strip()
    ]
    if not taggable:
        return []

    out: List[Dict[str, str]] = []
    docs = nlp.pipe([r["sentence"] for r in taggable])
    for row, doc in zip(taggable, docs):
        tag = resolve_pos(doc, row.get("lemma") or "", row.get("matched_form"))
        if tag:
            out.append({"id": int(row["id"]), "pos": tag})
    return out


def write_undo_set(rows: List[Dict[str, str]]) -> str:
    """Record what this run is about to write, before it writes it.

    Every row in `rows` is NULL in the database right now, so the revert is
    `SET pos = NULL` for exactly these ids — but only while something still
    remembers which ids they were. Same reasoning as #119's snapshot table, at
    a scale that does not justify one.

    Sync on purpose: this is a batch script with nothing else on its loop, and
    a blocking write here stalls only itself. Nothing in this file may ever be
    imported by a request path, where that would not be true.
    """
    path = f"backfill_lemma_pos_applied_{int(time.time())}.json"
    with open(path, "w") as fh:
        json.dump(rows, fh)
    return path


async def fetch_pending(db: Prisma, limit: Optional[int]) -> List[Dict[str, Any]]:
    sql = PENDING_SQL + (f" LIMIT {int(limit)}" if limit else "")
    return [dict(r) for r in await db.query_raw(sql)]


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="count the work, write nothing")
    parser.add_argument("--limit", type=int, default=None, help="process at most N lemmas")
    args = parser.parse_args()

    try:
        from src.services.lemmatization_service import get_nlp
        nlp = get_nlp()
    except Exception as e:  # pragma: no cover - environment guard
        raise SystemExit(f"spaCy is not usable in this interpreter: {e}")

    db = Prisma()
    await db.connect()
    try:
        pending = await fetch_pending(db, args.limit)
        logger.info("%d untagged lemmas have a global sentence to tag from", len(pending))
        if not pending:
            return

        started = time.perf_counter()
        tagged = tag_rows(pending, nlp)
        logger.info(
            "tagged %d of %d in %.1fs (%d skipped: no token match, multi-word, "
            "or not enough evidence)",
            len(tagged), len(pending), time.perf_counter() - started,
            len(pending) - len(tagged),
        )

        counts: Dict[str, int] = {}
        for row in tagged:
            counts[row["pos"]] = counts.get(row["pos"], 0) + 1
        logger.info("tag distribution: %s", dict(sorted(
            counts.items(), key=lambda kv: -kv[1]
        )))

        if args.dry_run:
            names = {int(r["id"]): r for r in pending}
            for sample in tagged[:25]:
                row = names[sample["id"]]
                logger.info(
                    "  %-18s -> %-5s  | %s",
                    row["lemma"], sample["pos"], (row["sentence"] or "")[:70],
                )
            logger.info("DRY RUN: would update %d rows", len(tagged))
            return

        undo_path = write_undo_set(tagged)
        logger.info("undo set written to %s (revert = SET pos = NULL for these ids)", undo_path)

        written = 0
        for i in range(0, len(tagged), CHUNK):
            chunk = tagged[i:i + CHUNK]
            written += await db.execute_raw(UPDATE_SQL, json.dumps(chunk))
            logger.info("updated %d/%d", written, len(tagged))

        logger.info("done: %d rows in %.1fs", written, time.perf_counter() - started)
    finally:
        await db.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
