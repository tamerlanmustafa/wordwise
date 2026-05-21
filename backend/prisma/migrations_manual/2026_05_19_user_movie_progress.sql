-- Per-(user, movie) progress cache for the v0.6 reel:
--   • status badge on each reel tile (Unstudied / Studied / Mastered)
--   • comprehensibility % chip
--   • input to the "Ready to Watch" recommendation shelf
--
-- Recomputed after any quiz/SRS completion that touched UserWord rows
-- in that movie. See backend/src/services/movie_progress_service.py.
--
-- Run: psql "$DATABASE_URL" -f prisma/migrations_manual/2026_05_19_user_movie_progress.sql
-- Then: prisma generate

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'moviestudystatus') THEN
    CREATE TYPE moviestudystatus AS ENUM ('unstudied', 'studied', 'mastered');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS user_movie_progress (
  user_id                    INTEGER          NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  movie_id                   INTEGER          NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  lemmas_touched             INTEGER          NOT NULL DEFAULT 0,
  lemmas_in_box_2_plus       INTEGER          NOT NULL DEFAULT 0,
  lemmas_mastered            INTEGER          NOT NULL DEFAULT 0,
  -- Frequency-weighted percent (0..100, not 0..1).
  comprehensibility_percent  DOUBLE PRECISION NOT NULL DEFAULT 0,
  status                     moviestudystatus NOT NULL DEFAULT 'unstudied',
  updated_at                 TIMESTAMPTZ      NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, movie_id)
);

CREATE INDEX IF NOT EXISTS ix_user_movie_progress_user
  ON user_movie_progress (user_id);

CREATE INDEX IF NOT EXISTS ix_user_movie_progress_comprehensibility
  ON user_movie_progress (user_id, comprehensibility_percent DESC);

COMMIT;
