-- Two coordinated changes for the shared-sentence rollout:
--
-- 1. sentence_bank.movie_id becomes nullable. Rows with movie_id IS NULL are
--    "global" LLM-authored examples shared across every movie that contains
--    the linked lemma. Legacy movie-tied rows (subtitle + per-movie LLM)
--    continue to live with movie_id NOT NULL and are unaffected.
--
--    The existing per-movie unique (sentence_hash, movie_id) still enforces
--    dedup for movie-tied rows; Postgres treats NULL ≠ NULL in unique
--    constraints, so we add a partial unique index to dedup global rows by
--    sentence_hash alone.
--
-- 2. New llm_usage_ledger table. The backend writes one row per Anthropic
--    call (token counts + estimated USD cost). A nightly job — or just the
--    cap check before each call — sums this table; the LLM service refuses
--    to fire when the sum reaches LLM_COST_CAP_USD.
--
-- Run:
--   psql "$DATABASE_URL" -f prisma/migrations_manual/2026_05_14_shared_sentences_and_cost_ledger.sql
--   prisma generate

BEGIN;

-- ── 1. sentence_bank.movie_id nullable + global dedup index ─────────────
ALTER TABLE sentence_bank
  ALTER COLUMN movie_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sentence_bank_hash_global_unique
  ON sentence_bank (sentence_hash)
  WHERE movie_id IS NULL;

-- ── 2. LLM usage ledger ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS llm_usage_ledger (
  id                    SERIAL PRIMARY KEY,
  ts                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  model                 VARCHAR(64) NOT NULL,
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd    NUMERIC(12, 6) NOT NULL DEFAULT 0,
  context               VARCHAR(64) NOT NULL DEFAULT 'unknown'
);

CREATE INDEX IF NOT EXISTS ix_llm_usage_ledger_ts
  ON llm_usage_ledger (ts);

COMMIT;
