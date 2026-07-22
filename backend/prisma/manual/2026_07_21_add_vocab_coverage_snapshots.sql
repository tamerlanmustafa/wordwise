-- Vocab-pipeline health snapshots.
--
-- GET /admin/health/vocab-coverage computes coverage metrics live, but several
-- of them are trend/regression signals ("uncovered lemmas should FALL",
-- "noop_translations must not INCREASE"). A stateless endpoint has nothing to
-- diff against, so the sentence worker writes one snapshot per day here and the
-- endpoint reads the most recent prior row to compute deltas.
--
-- metrics jsonb holds the full computed report ({key: {value, status, ...}}),
-- so adding/removing a metric never needs a schema change.
--
-- schema.prisma is the source of truth; applied by hand because the migrations
-- history has pre-existing drift (see 2026_07_21_add_word_translation_gloss.sql
-- for why `migrate dev` / `db push` demand a destructive reset here).
--
-- ⚠ Run this against PROD (psql "$DATABASE_PUBLIC_URL") BEFORE deploying code
-- that includes the VocabCoverageSnapshot model — the regenerated Prisma client
-- references this table on the health endpoint and in the worker snapshot path.
--
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS vocab_coverage_snapshots (
    id          SERIAL PRIMARY KEY,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    metrics     JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_vocab_coverage_snapshots_captured_at
    ON vocab_coverage_snapshots (captured_at DESC);
