-- Daily-cap gate for /srs/session/start.
--
-- The new monetization model gives free users 1 SRS session per UTC day
-- (premium unlimited). The existing `srs_last_session_date` tracks per-card
-- review activity (drives the streak), so we need a separate column that
-- captures "user started a session at this instant" — bumped by
-- /srs/session/start regardless of how many cards they actually review.
--
-- The legacy `srs_free_previews_used` column is left in place but is no
-- longer read or written by the new flow (kept for backwards compat with
-- older mobile clients that still poll /srs/stats for previews_remaining).
--
-- Run: psql "$DATABASE_URL" -f prisma/migrations_manual/2026_05_19_srs_session_started_at.sql
-- Then: prisma generate

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS srs_last_session_started_at TIMESTAMPTZ;

COMMIT;
