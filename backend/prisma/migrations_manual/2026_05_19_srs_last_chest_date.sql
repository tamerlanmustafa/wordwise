-- One-chest-per-day idempotency for /srs/session/complete.
-- See backend/src/services/chest_service.py.
--
-- Run: psql "$DATABASE_URL" -f prisma/migrations_manual/2026_05_19_srs_last_chest_date.sql
-- Then: prisma generate

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS srs_last_chest_date DATE;

COMMIT;
