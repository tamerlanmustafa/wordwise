-- Reel: per-user ordered list of movies displayed as tiles on the
-- Journey Reel screen. Movies are referenced by their TMDB id (the same
-- id mobile uses in MovieData) so users can add anything from TMDB
-- search without requiring the title to exist in our `movies` table.
-- Title/poster/year are denormalized so the reel renders without a
-- per-row TMDB roundtrip on load.
--
-- Run: psql "$DATABASE_URL" -f prisma/migrations_manual/2026_05_15_user_reel_movies.sql
-- Then: prisma generate

BEGIN;

CREATE TABLE IF NOT EXISTS user_reel_movies (
  user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tmdb_id     INTEGER     NOT NULL,
  position    INTEGER     NOT NULL,
  title       VARCHAR     NOT NULL,
  poster_path VARCHAR,
  year        INTEGER,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tmdb_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_user_reel_movies_user_position
  ON user_reel_movies (user_id, position);

CREATE INDEX IF NOT EXISTS ix_user_reel_movies_user_added_at
  ON user_reel_movies (user_id, added_at);

COMMIT;
