#!/usr/bin/env python3
"""
Seed the LOCAL dev database with a small, realistic slice of prod.

Why this exists
---------------
The local dev DB drifts behind prod: schema is easy to catch up (the manual/
SQL files), but *data* is not, and several screens are empty without it rather
than broken in any obvious way. The word feed is the clearest case — it only
surfaces a lemma that is graded AND has a global LLM example sentence
(`feed_eligibility_sql`), and locally there were 0 rows with
`sentence_lemma_links.is_global`, so the feed came back empty from a healthy
backend against a healthy database. Nothing logs an error for that.

This copies enough to develop against, not a replica: N feed-eligible lemmas
per CEFR band, their definitions, and one global example sentence each.

What it does NOT do
-------------------
* It never writes to prod. The prod connection issues SELECTs only.
* It does not touch movies, users, or anything user-owned.
* It does not delete. Re-running updates the same rows.

Ids are not copied. Prod and local assign their own `lemmas.id`, so lemmas are
matched **by text** and sentence links are rebuilt against local ids — copying
ids would silently attach a definition to whichever unrelated word happened to
hold that id locally.

Usage
-----
    python3 scripts/seed_local_from_prod.py --prod-url "postgresql://..." [--per-level 60]

`--per-level` is per CEFR band (A1..C2), so the default seeds ~360 lemmas.
"""

from __future__ import annotations

import argparse
import os
import sys

try:
    import psycopg
except ModuleNotFoundError:  # pragma: no cover - dev script
    sys.exit(
        "psycopg (v3) is required.\n"
        "  /opt/homebrew/bin/python3.11 -m pip install 'psycopg[binary]'"
    )

LEVELS = ("A1", "A2", "B1", "B2", "C1", "C2")

# One global LLM sentence per lemma, from prod's feed-eligible set.
#
# DISTINCT ON picks a single sentence per lemma deterministically; without it a
# lemma with 40 sentences would drag all 40 across and the seed would be mostly
# duplicate example text for a handful of words.
FETCH_SQL = """
    SELECT DISTINCT ON (l.lemma)
           l.lemma,
           l.pos,
           l.cefr_level::text  AS cefr_level,
           l.confidence,
           l.source::text      AS source,
           l.frequency_rank,
           l.definition,
           sb.sentence,
           sb.sentence_hash,
           sll.score,
           sll.is_representative,
           sll.matched_form
      FROM lemmas l
      JOIN sentence_lemma_links sll ON sll.lemma_id = l.id AND sll.is_global
      JOIN sentence_bank sb         ON sb.id = sll.sentence_id
     WHERE l.cefr_level::text = %s
       AND l.definition IS NOT NULL
     ORDER BY l.lemma, sll.score DESC NULLS LAST
     LIMIT %s
"""

STAGING_DDL = """
    CREATE TEMP TABLE seed_stage (
        lemma             varchar,
        pos               varchar,
        cefr_level        text,
        confidence        double precision,
        source            text,
        frequency_rank    integer,
        definition        text,
        sentence          text,
        sentence_hash     varchar,
        score             double precision,
        is_representative boolean,
        matched_form      varchar
    ) ON COMMIT DROP
"""

# Only fills gaps on the lemma row. A local lemma that already carries a
# definition keeps it, so re-running never churns rows you have edited by hand.
UPDATE_LEMMAS_SQL = """
    UPDATE lemmas l
       SET definition = COALESCE(l.definition, s.definition),
           pos        = COALESCE(l.pos, s.pos),
           updated_at = now()
      FROM seed_stage s
     WHERE lower(l.lemma) = lower(s.lemma)
"""

# movie_id NULL + source 'llm' is what the trigger reads to set `is_global`;
# those two values ARE the definition of a global sentence, so they are written
# literally here rather than copied.
#
# Both are cast explicitly. In a SELECT list a bare NULL is typed `text` and a
# bare 'llm' is `unknown`, neither of which matches an integer column or an
# enum — the INSERT's target types do not propagate back into the SELECT.
INSERT_SENTENCES_SQL = """
    INSERT INTO sentence_bank (sentence_hash, sentence, movie_id, source, created_at)
    SELECT DISTINCT s.sentence_hash, s.sentence, NULL::integer,
           'llm'::sentencesource, now()
      FROM seed_stage s
     WHERE EXISTS (SELECT 1 FROM lemmas l WHERE lower(l.lemma) = lower(s.lemma))
    ON CONFLICT (sentence_hash) WHERE movie_id IS NULL DO NOTHING
"""
# ^ There are TWO unique constraints on sentence_bank and only one of them
# applies here: `(sentence_hash, movie_id)` never fires for global rows,
# because Postgres treats NULL movie_ids as distinct from each other, so the
# same sentence could be inserted twice. The partial index
# `sentence_bank_hash_global_unique (sentence_hash) WHERE movie_id IS NULL` is
# the one that actually enforces global uniqueness, and ON CONFLICT has to name
# its predicate to match it.

# `is_global` is deliberately absent: the trigger owns it (see
# sll_set_is_global). Writing it here would be the app-code mistake the trigger
# exists to prevent, and it would go stale the moment a sentence moved.
INSERT_LINKS_SQL = """
    INSERT INTO sentence_lemma_links
           (sentence_id, lemma_id, score, is_representative, matched_form)
    SELECT sb.id, l.id, COALESCE(s.score, 1.0),
           COALESCE(s.is_representative, true), s.matched_form
      FROM seed_stage s
      JOIN lemmas l        ON lower(l.lemma) = lower(s.lemma)
      JOIN sentence_bank sb ON sb.sentence_hash = s.sentence_hash
                           AND sb.movie_id IS NULL
     WHERE NOT EXISTS (
             SELECT 1 FROM sentence_lemma_links x
              WHERE x.sentence_id = sb.id AND x.lemma_id = l.id
           )
"""

COUNT_SQL = """
    SELECT count(*) FROM lemmas l
     WHERE EXISTS (SELECT 1 FROM sentence_lemma_links sll
                    WHERE sll.lemma_id = l.id AND sll.is_global)
"""


def local_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    env = os.path.join(os.path.dirname(__file__), "..", ".env")
    with open(env, encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("DATABASE_URL"):
                return line.split("=", 1)[1].strip().strip('"')
    sys.exit("No DATABASE_URL in the environment or backend/.env")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prod-url", required=True, help="read-only source database")
    ap.add_argument("--per-level", type=int, default=60)
    args = ap.parse_args()

    target = local_url()
    if "localhost" not in target and "127.0.0.1" not in target:
        sys.exit(f"Refusing to seed a non-local target: {target.split('@')[-1]}")

    rows: list[tuple] = []
    with psycopg.connect(args.prod_url) as src, src.cursor() as cur:
        for level in LEVELS:
            cur.execute(FETCH_SQL, (level, args.per_level))
            got = cur.fetchall()
            rows.extend(got)
            print(f"  {level}: {len(got)} lemmas from source")

    if not rows:
        sys.exit("Source returned no feed-eligible lemmas — nothing to seed.")

    with psycopg.connect(target) as dst, dst.cursor() as cur:
        before = cur.execute(COUNT_SQL).fetchone()[0]

        cur.execute(STAGING_DDL)
        with cur.copy(
            "COPY seed_stage (lemma, pos, cefr_level, confidence, source,"
            " frequency_rank, definition, sentence, sentence_hash, score,"
            " is_representative, matched_form) FROM STDIN"
        ) as copy:
            for row in rows:
                copy.write_row(row)

        cur.execute(UPDATE_LEMMAS_SQL)
        print(f"  lemmas updated:   {cur.rowcount}")
        cur.execute(INSERT_SENTENCES_SQL)
        print(f"  sentences added:  {cur.rowcount}")
        cur.execute(INSERT_LINKS_SQL)
        print(f"  links added:      {cur.rowcount}")

        after = cur.execute(COUNT_SQL).fetchone()[0]
        dst.commit()

    print(f"\nFeed-eligible lemmas locally: {before} -> {after}")


if __name__ == "__main__":
    main()
