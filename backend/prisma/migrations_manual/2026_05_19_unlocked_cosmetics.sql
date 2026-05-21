-- v0.6 W10: persistent inventory of cinema-named milestone unlocks.
-- See backend/src/services/milestone_service.py for the streak → key
-- mapping. JSON array of slug strings, e.g. '["opening_weekend"]'.
--
-- Run: psql "$DATABASE_URL" -f prisma/migrations_manual/2026_05_19_unlocked_cosmetics.sql
-- Then: prisma generate

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS unlocked_cosmetics JSONB DEFAULT '[]'::jsonb;

COMMIT;
