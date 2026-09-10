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

This copies enough to develop against, not a replica.

What it seeds
-------------
1. **Feed-eligible lemmas** — N per CEFR band, their definitions, and one
   global LLM example sentence each. Without these the word feed is empty.
2. **The translation cache** — every row, because it is small (~35k) and
   because a cache miss locally now *fails*: both DeepL and Google are switched
   off (see CLAUDE.md), so an uncached word has nowhere to go and the reveal
   500s. Prod's cache is the only thing that makes translation work offline.
3. **Translation passthroughs** — the small table recording terms a provider
   handed back unchanged. It is what keeps `khat -> khat` from being written
   into the cache as a real translation.
4. **Vocab coverage snapshots** — the admin health card reads the latest row
   and renders nothing at all without one.

What it does NOT do
-------------------
* It never writes to prod. The prod connection issues SELECTs only.
* It does not touch movies, users, or anything user-owned. User rows are
  supposed to come from using the app locally, not from copying real accounts.
* It does not delete. Re-running updates or skips, never churns.

Ids are not copied. Prod and local assign their own `lemmas.id`, so lemmas are
matched **by text**, sentence links are rebuilt against local ids, and every
copied table is deduped on its natural key rather than its primary key —
copying ids would silently attach a definition to whichever unrelated word
happened to hold that id locally.

Usage
-----
    python3 scripts/seed_local_from_prod.py --prod-url "postgresql://..." \\
        [--per-level 60] [--translations 0] [--skip-lemmas]

The prod URL is `DATABASE_PUBLIC_URL` from Railway's Postgres service; the
service's own `DATABASE_URL` points at `postgres.railway.internal` and is not
reachable from a laptop:

    railway variables -s Postgres --json | python3 -c \\
      "import json,sys; print(json.load(sys.stdin)['DATABASE_PUBLIC_URL'])"

`--per-level` is per CEFR band (A1..C2), so the default seeds ~360 lemmas.
`--translations` caps the cache copy (0 = all of it, the default).
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

# ── Plain table copies ─────────────────────────────────────────────────────
#
# Each of these is derived, non-user-owned data with a natural unique key, so a
# copy is a straight INSERT ... ON CONFLICT DO NOTHING and re-running is free.
# The key named in each ON CONFLICT is the table's real unique index, not its
# primary key — ids are prod's and mean nothing here.
#
# `updated_at DESC` on the cache is the closest thing to a hit counter the
# table has: the row is touched when it is written, so the most recently
# updated rows are the ones prod actually served.
# `reads` is the SELECT list, which is not always the column list: a jsonb
# column comes back to Python as a dict, and psycopg's COPY text formatter has
# no dumper for one. Selecting it as ::text hands COPY a string and lets
# Postgres parse it back into jsonb on the way in, which is both simpler and
# faster than registering a dumper for a single column.
COPIES: tuple[tuple[str, str, tuple[str, ...], str, str, str], ...] = (
    (
        "translation_cache",
        "translation cache",
        ("source_text", "source_lang", "target_lang", "translated", "provider",
         "created_at", "updated_at"),
        "",  # reads: same as the column list
        "(source_text, target_lang)",
        "ORDER BY updated_at DESC",
    ),
    (
        "translation_passthroughs",
        "passthroughs",
        ("source_text", "target_lang", "provider", "times_seen",
         "first_seen_at", "last_seen_at"),
        "",
        "(source_text, target_lang, provider)",
        "ORDER BY last_seen_at DESC",
    ),
    (
        "vocab_coverage_snapshots",
        "coverage snapshots",
        ("captured_at", "metrics"),
        "captured_at, metrics::text",
        # No natural unique index on this one, so there is nothing for
        # ON CONFLICT to name — dedupe on captured_at with an anti-join
        # instead (see copy_table).
        "",
        "ORDER BY captured_at DESC",
    ),
)


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


def copy_table(
    src: "psycopg.Connection",
    dst: "psycopg.Connection",
    table: str,
    label: str,
    cols: tuple[str, ...],
    reads: str,
    conflict: str,
    order: str,
    limit: int,
) -> None:
    """Copy one derived table from prod, skipping rows already held locally.

    Staged through a TEMP table rather than inserted row by row: the cache is
    tens of thousands of rows and a per-row round trip over the public proxy
    turns a two-second copy into a two-minute one.
    """
    collist = ", ".join(cols)
    cap = f" LIMIT {limit}" if limit else ""
    with src.cursor() as cur:
        cur.execute(f"SELECT {reads or collist} FROM {table} {order}{cap}")
        rows = cur.fetchall()
    if not rows:
        print(f"  {label:<20} source empty, skipped")
        return

    with dst.cursor() as cur:
        before = cur.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        cur.execute(
            f"CREATE TEMP TABLE stage_{table} "
            f"(LIKE {table} INCLUDING DEFAULTS) ON COMMIT DROP"
        )
        with cur.copy(f"COPY stage_{table} ({collist}) FROM STDIN") as copy:
            for row in rows:
                copy.write_row(row)

        if conflict:
            cur.execute(
                f"INSERT INTO {table} ({collist}) SELECT {collist} "
                f"FROM stage_{table} ON CONFLICT {conflict} DO NOTHING"
            )
        else:
            # Same intent, expressed as an anti-join because the table has no
            # unique index for ON CONFLICT to name.
            cur.execute(
                f"INSERT INTO {table} ({collist}) SELECT s.{collist} "
                f"FROM stage_{table} s WHERE NOT EXISTS ("
                f"  SELECT 1 FROM {table} t WHERE t.captured_at = s.captured_at)"
            )
        added = cur.rowcount
        after = cur.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
    print(f"  {label:<20} +{added:<7} ({before:,} -> {after:,})")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prod-url", required=True, help="read-only source database")
    ap.add_argument("--per-level", type=int, default=60)
    ap.add_argument(
        "--translations",
        type=int,
        default=0,
        help="cap on translation-cache rows to copy (0 = all)",
    )
    ap.add_argument(
        "--skip-lemmas",
        action="store_true",
        help="only refresh the copied tables, leave the feed seeding alone",
    )
    args = ap.parse_args()

    target = local_url()
    if "localhost" not in target and "127.0.0.1" not in target:
        sys.exit(f"Refusing to seed a non-local target: {target.split('@')[-1]}")

    # The plain copies first: they are independent of the lemma seeding and
    # cheap, so a run that fails halfway through the feed step still leaves the
    # translation cache populated.
    print("Copying derived tables:")
    with psycopg.connect(args.prod_url) as src, psycopg.connect(target) as dst:
        for table, label, cols, reads, conflict, order in COPIES:
            limit = args.translations if table == "translation_cache" else 0
            copy_table(src, dst, table, label, cols, reads, conflict, order, limit)
        dst.commit()

    if args.skip_lemmas:
        return

    print("\nSeeding feed-eligible lemmas:")
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
