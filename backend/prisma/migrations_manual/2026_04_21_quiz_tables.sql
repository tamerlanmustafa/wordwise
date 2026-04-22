-- Quiz / gamification tables.
-- Additive only: no DROPs, no ALTERs on existing columns. Safe to run
-- against prod. Raw SQL + psql is the team's current migration pattern
-- (see hidden_words migration, same shape).
--
-- Run: psql "$DATABASE_URL" -f prisma/migrations_manual/2026_04_21_quiz_tables.sql
-- Then: prisma generate (to refresh the Python client)

BEGIN;

-- --- QuizSession ---
CREATE TABLE IF NOT EXISTS quiz_sessions (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movie_id       INTEGER,
  cefr_level     VARCHAR(2) NOT NULL,
  kind           VARCHAR(16) NOT NULL,  -- 'unit' | 'pre_movie'
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ,
  stars          INTEGER,
  correct_count  INTEGER NOT NULL DEFAULT 0,
  total_scored   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS ix_quiz_sessions_user_movie_level
  ON quiz_sessions (user_id, movie_id, cefr_level);
CREATE INDEX IF NOT EXISTS ix_quiz_sessions_completed_at
  ON quiz_sessions (completed_at);

-- --- QuizCardResult ---
CREATE TABLE IF NOT EXISTS quiz_card_results (
  id          SERIAL PRIMARY KEY,
  session_id  INTEGER NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  word        VARCHAR NOT NULL,
  card_type   VARCHAR(16) NOT NULL,      -- 'mcq' | 'self_rate'
  is_correct  BOOLEAN,                   -- null for self_rate
  self_rating VARCHAR(8),                -- 'know' | 'kinda' | 'dont'
  answer_ms   INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_quiz_card_results_session
  ON quiz_card_results (session_id);
CREATE INDEX IF NOT EXISTS ix_quiz_card_results_word
  ON quiz_card_results (word);

-- --- UserQuizStats (denormalized rollup) ---
CREATE TABLE IF NOT EXISTS user_quiz_stats (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_stars      INTEGER NOT NULL DEFAULT 0,
  total_sessions   INTEGER NOT NULL DEFAULT 0,
  avg_accuracy     DOUBLE PRECISION NOT NULL DEFAULT 0,
  retention_score  DOUBLE PRECISION NOT NULL DEFAULT 0,
  xp               INTEGER NOT NULL DEFAULT 0,
  last_active_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_user_quiz_stats_total_stars
  ON user_quiz_stats (total_stars);
CREATE INDEX IF NOT EXISTS ix_user_quiz_stats_xp
  ON user_quiz_stats (xp);
CREATE INDEX IF NOT EXISTS ix_user_quiz_stats_retention
  ON user_quiz_stats (retention_score);

-- --- UnitProgress (per-user, per-movie, per-level high-water mark) ---
CREATE TABLE IF NOT EXISTS unit_progress (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movie_id    INTEGER NOT NULL,
  cefr_level  VARCHAR(2) NOT NULL,
  best_stars  INTEGER NOT NULL DEFAULT 0,
  attempts    INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, movie_id, cefr_level)
);

CREATE INDEX IF NOT EXISTS ix_unit_progress_user_movie
  ON unit_progress (user_id, movie_id);

COMMIT;
