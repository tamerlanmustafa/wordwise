-- Adaptive worker schema.
-- Run once: psql "$DATABASE_URL" -f backend/src/workers/schema.sql
--
-- These tables live alongside the Prisma-managed schema but are intentionally
-- not declared in schema.prisma. They are owned by the worker subsystem and
-- are touched only with raw SQL via asyncpg, so we don't need to round-trip
-- through Prisma migrations every time we tune the queue.

CREATE TABLE IF NOT EXISTS movie_jobs (
    id           BIGSERIAL PRIMARY KEY,
    tmdb_id      INTEGER     NOT NULL,
    title        TEXT        NOT NULL,
    year         INTEGER,
    -- 0 = highest priority (Top 250 first), 1 = backlog, 2+ = future tiers.
    priority     SMALLINT    NOT NULL DEFAULT 1,
    -- pending | running | done | failed | dead
    status       TEXT        NOT NULL DEFAULT 'pending',
    attempts     SMALLINT    NOT NULL DEFAULT 0,
    -- Earliest time a worker may claim this row. Used for backoff after a
    -- transient failure: we set run_after = now() + backoff(attempts).
    run_after    TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_by   TEXT,
    claimed_at   TIMESTAMPTZ,
    finished_at  TIMESTAMPTZ,
    movie_id     INTEGER,        -- FK to movies.id once the row exists
    vocab_count  INTEGER,        -- words classified, for sanity-checking
    last_error   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial index: the only index the claim query needs.
-- Excluding non-pending rows keeps it tiny even after millions of jobs.
CREATE INDEX IF NOT EXISTS idx_movie_jobs_claim
    ON movie_jobs (priority, run_after, id)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_movie_jobs_status      ON movie_jobs (status);
CREATE INDEX IF NOT EXISTS idx_movie_jobs_tmdb_unique ON movie_jobs (tmdb_id);

-- One row, id = 1. Holds the live token bucket and the AIMD target.
-- Workers and the controller all SELECT ... FOR UPDATE this row briefly.
CREATE TABLE IF NOT EXISTS rate_state (
    id          SMALLINT PRIMARY KEY,
    target_qps  DOUBLE PRECISION NOT NULL,
    tokens      DOUBLE PRECISION NOT NULL,
    -- Hard ceiling so a runaway controller can't ask for the moon.
    max_qps     DOUBLE PRECISION NOT NULL DEFAULT 4.0,
    -- Floor so we can always make at least some forward progress.
    min_qps     DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    last_refill TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO rate_state (id, target_qps, tokens, max_qps, min_qps)
VALUES (1, 0.5, 0.5, 4.0, 0.05)
ON CONFLICT (id) DO NOTHING;

-- Append-only ring of recent API outcomes. The controller scans the last
-- 30 seconds of this table to compute success/error/latency and decide the
-- next AIMD step. Old rows are pruned by the controller.
CREATE TABLE IF NOT EXISTS api_events (
    id           BIGSERIAL PRIMARY KEY,
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    success      BOOLEAN     NOT NULL,
    status_code  INTEGER,
    latency_ms   INTEGER,
    error_kind   TEXT  -- 'timeout' | 'rate_limited' | 'http_5xx' | 'other' | NULL
);

CREATE INDEX IF NOT EXISTS idx_api_events_occurred_at ON api_events (occurred_at);
