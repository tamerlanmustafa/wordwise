-- v0.7.2 — Practice tab "session kind" tracker.
--
-- One row per user; remembers which practice tile they picked today
-- ('quick_recall' / 'synonym_round' / 'tough_words' / 'movie_deep_dive').
-- The daily-cap gate (`srs_last_session_started_at` + UTC rollover)
-- naturally invalidates the value at midnight UTC, so we don't need to
-- explicitly clear it.
--
-- Run: psql "$DATABASE_URL" -f prisma/migrations_manual/2026_05_21_srs_last_session_kind.sql
-- Then: prisma generate

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS srs_last_session_kind VARCHAR(40);

COMMIT;
