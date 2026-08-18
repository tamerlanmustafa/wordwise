-- Issue #118 — Postgres is mistuned for its workload.
--
-- Three separate defects, all of which had to be fixed together. Fixing the
-- statistics alone made the Explore feed SLOWER (200ms -> 978ms), because with
-- random_page_cost=4 the planner responds to a correct row estimate by choosing
-- a 7.7M-row parallel seq scan over sentence_lemma_links. The cost model and
-- the statistics are one fix, not two.
--
-- Measured on prod (`/srs/feed` candidate query, levels B1+B2, 2000 rows):
--   before   127 - 1277 ms   (varies with buffer state)
--   after     ~64 ms         (fully buffer-resident)
--
-- NOT idempotent-safe inside a transaction: ALTER SYSTEM cannot run in one.
-- Run through psql without -1, which wraps each statement separately.
--
--   railway connect Postgres     # or: psql "$DATABASE_PUBLIC_URL"
--   \i backend/prisma/manual/2026_08_18_postgres_tuning_issue_118.sql
--
-- Section 3 requires a Postgres RESTART (shared_buffers is not reloadable).


-- ---------------------------------------------------------------------------
-- 1. Extended statistics — the planner's inputs
-- ---------------------------------------------------------------------------
-- sentence_bank.movie_id and .source are 100% functionally dependent: every
-- LLM-authored sentence is global (movie_id IS NULL) and every subtitle
-- extract belongs to a movie. Postgres assumes independence and multiplies the
-- two selectivities, so `movie_id IS NULL AND source = 'llm'` estimated 800
-- rows against an actual 48,494 — a 61x under-estimate that no amount of
-- ANALYZE can correct, because each column's own statistics are already exact.
--
-- `dependencies` does not apply to IS NULL (it only covers equality clauses);
-- `mcv` is the kind that does the work here. (NULL, 'llm') is the single most
-- common combination in the table, so it always lands in the MCV list.
CREATE STATISTICS IF NOT EXISTS stx_sentence_bank_movie_source
    (ndistinct, dependencies, mcv)
    ON movie_id, source FROM sentence_bank;

-- `length(lemma) >= 4` is an expression, so the planner fell back to its
-- hardcoded 1/3 guess: 14,157 estimated against 40,908 actual. Per-expression
-- statistics (PG14+) give it a real histogram.
CREATE STATISTICS IF NOT EXISTS stx_lemmas_lemma_length
    ON (length(lemma)) FROM lemmas;


-- ---------------------------------------------------------------------------
-- 2. Reloadable settings — the cost model
-- ---------------------------------------------------------------------------
-- random_page_cost=4 is the 1990s rotational-disk default. Railway is NVMe,
-- where a random read costs barely more than a sequential one. At 4 the planner
-- systematically over-costs index scans and prefers seq scans + hash joins.
ALTER SYSTEM SET random_page_cost = 1.1;

-- effective_cache_size is what the planner believes the OS + Postgres can keep
-- cached. It was the 4GB default against a 22.4 GiB container, which biases
-- against index scans in the same direction as random_page_cost. Not listed in
-- the issue, but it is the same defect and pointless to fix by halves.
ALTER SYSTEM SET effective_cache_size = '16GB';

-- The feed's hash table measured 5,425 kB against work_mem=4MB, so it spilled
-- to disk on the hot path. 32MB is ~6x headroom.
ALTER SYSTEM SET work_mem = '32MB';

-- Speeds up ANALYZE/VACUUM/index builds. autovacuum_work_mem is set explicitly
-- so the 3 autovacuum workers are bounded at 768MB rather than inheriting
-- maintenance_work_mem and reserving 1.5GB between them.
ALTER SYSTEM SET maintenance_work_mem = '512MB';
ALTER SYSTEM SET autovacuum_work_mem = '256MB';

SELECT pg_reload_conf();


-- ---------------------------------------------------------------------------
-- 3. Restart-only setting
-- ---------------------------------------------------------------------------
-- 128MB of shared_buffers against a 4,010 MB database — the hot tables
-- (sentence_bank 1.3GB, sentence_lemma_links 1.0GB) could never stay resident,
-- which is why the same query measured 1339ms cold and 28ms warm.
--
-- The container limit is 24 GB (cgroup memory.max), so ~25% is 6GB. That also
-- clears the whole current database with headroom for the sentence worker,
-- which is still appending to sentence_bank.
--
-- Railway sets shared_buffers in postgresql.conf; ALTER SYSTEM writes
-- postgresql.auto.conf, which is read afterwards and therefore wins.
ALTER SYSTEM SET shared_buffers = '6GB';

-- >>> Requires: railway redeploy --service Postgres  (or a dashboard restart)


-- ---------------------------------------------------------------------------
-- 4. Per-table autovacuum — stop the statistics going stale again
-- ---------------------------------------------------------------------------
-- At the default scale factor of 0.1, sentence_lemma_links (7.7M rows) needs
-- 777k rows to change before ANALYZE fires. It had not been auto-analyzed since
-- 2026-07-15, 33 days. Set per-table rather than globally: 0.1 is a fine
-- default for the small tables, and lowering it everywhere just adds churn.
ALTER TABLE sentence_lemma_links SET (
    autovacuum_analyze_scale_factor = 0.02,
    autovacuum_vacuum_scale_factor  = 0.05
);
ALTER TABLE sentence_bank SET (
    autovacuum_analyze_scale_factor = 0.02,
    autovacuum_vacuum_scale_factor  = 0.05
);
ALTER TABLE movie_lemma_mappings SET (
    autovacuum_analyze_scale_factor = 0.02,
    autovacuum_vacuum_scale_factor  = 0.05
);
ALTER TABLE word_classifications SET (
    autovacuum_analyze_scale_factor = 0.02,
    autovacuum_vacuum_scale_factor  = 0.05
);
ALTER TABLE lemmas SET (
    autovacuum_analyze_scale_factor = 0.02,
    autovacuum_vacuum_scale_factor  = 0.05
);
