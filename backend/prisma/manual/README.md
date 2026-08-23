# Manual SQL migrations

`prisma migrate` is **not** the migration path for this repo. The migration
history has pre-existing drift (family-plan changes and `src/workers/schema.sql`
were applied outside Prisma), so `migrate dev` and `db push` both demand a
destructive reset. Schema changes ship as hand-written SQL here instead.

## Rules

1. `prisma/schema.prisma` is the source of truth for anything Prisma can
   express. Every file here has a matching schema edit in the same commit.
2. Write files to be **idempotent** (`IF NOT EXISTS`, `IF EXISTS`, guarded
   `UPDATE`s) — they get replayed.
3. **Apply to prod before the code lands.** The regenerated Prisma client
   selects every column in the schema, so pushing code first breaks the read
   path for any column the DB doesn't have yet.
   ```
   railway connect Postgres        # or: psql "$DATABASE_PUBLIC_URL"
   \i backend/prisma/manual/<file>.sql
   ```
4. Don't wrap a file in `BEGIN`/`COMMIT` if it contains
   `ALTER TYPE ... ADD VALUE` — the new label isn't usable by later statements
   in the same transaction.

## Bootstrapping a fresh database

`schema.prisma` alone does **not** reproduce prod. Prisma cannot express
partial indexes, and there are three of them carrying real invariants or
carrying the hot read path:

| Index | Table | Purpose |
|---|---|---|
| `sentence_bank_hash_global_unique` | `sentence_bank` | dedup of global (`movie_id IS NULL`) LLM sentences |
| `user_words_global_word_unique` | `user_words` | dedup of global (`movie_id IS NULL`) learned markers |
| `ix_sll_global_lemma` | `sentence_lemma_links` | the hot/cold split (#120) — every study surface's lemma lookup. Without it those queries fall back to scanning the 1.0 GB relation |

Prisma also cannot express triggers, and `sentence_lemma_links.is_global`
depends on two of them (`trg_sll_set_is_global`, `trg_sb_resync_link_is_global`)
to stay true. A database built without replaying #120's file gets a column that
is silently always `false`, which makes every study surface look empty.

So a fresh environment is: apply the schema, then replay **both**
`prisma/migrations_manual/*.sql` and `prisma/manual/*.sql` in filename order
(they are date-prefixed). `src/workers/schema.sql` is a third source — the
worker tables live only there.

Skipping the replay yields a database that passes `prisma validate` and
silently permits duplicates prod rejects.

## Reading Postgres statistics

`pg_stat_user_tables` holds **cumulative counters**, which PG15+ keeps in shared
memory and persists only on a clean shutdown. Section 3 of
`2026_08_18_postgres_tuning_issue_118.sql` requires a Postgres restart, and that
restart zeroed every counter in this database.

So here a NULL `last_analyze` / `last_autoanalyze` / `last_autovacuum` means
**"not since the last restart"**, not "never". The same reset makes `n_live_tup`
and `n_tup_ins` meaningless until the next (auto)analyze: after the 2026-08-18
restart `word_classifications` reported 13,122 lifetime inserts against 4.8M
rows.

Misreading this cost a P1 issue — #155 read `n_live_tup` as "the planner
estimate", concluded `movie_lemma_mappings` and `sentence_bank` were estimated
368x low, and was closed 2026-08-22 when `pg_class.reltuples` turned out to be
within 0.3% of the real counts. Before concluding the planner's numbers are
stale, check the catalog rather than the counters:

| Question | Where the answer is | Survives a restart? |
|---|---|---|
| What row count does the planner use? | `pg_class.reltuples` (+ `relpages`) | yes — catalog |
| Are per-column histograms/MCVs present? | `pg_stats` | yes — catalog |
| Did the `CREATE STATISTICS` objects get populated? | `pg_statistic_ext_data` — only `ANALYZE` ever writes these | yes — catalog |
| When did analyze/vacuum last run? | `pg_stat_user_tables` | **no** |

`EXPLAIN` settles it outright: the estimated `rows=` on a scan node is what the
planner believes, and on a parallel plan that figure is **per worker**.

A quiet autovacuum is also not a broken one. The thresholds are computed from
`pg_class.reltuples`, so with §4's per-table `autovacuum_analyze_scale_factor =
0.02` a 5M-row table needs ~101k modifications before autoanalyze fires — months
of ordinary traffic on an insert-mostly table, and correct.
