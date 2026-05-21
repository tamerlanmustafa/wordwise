-- v0.6 mercy infrastructure: per-user inventory of streak freezes.
--
-- One row per freeze. `consumed_at IS NULL` ⇒ still held. Auto-granted
-- weekly on /daily/state read (free users, cap 2 held), credited in
-- batches by the consumable freeze-pack IAP, and lazily consumed when
-- the user opens the app after missing a day.
--
-- Run: psql "$DATABASE_URL" -f prisma/migrations_manual/2026_05_19_user_streak_freezes.sql
-- Then: prisma generate

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'freezeacquisition') THEN
    CREATE TYPE freezeacquisition AS ENUM (
      'auto_weekly', 'iap', 'debug_grant', 'repair_grant'
    );
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS user_streak_freezes (
  id              SERIAL            PRIMARY KEY,
  user_id         INTEGER           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  acquired_at     TIMESTAMPTZ       NOT NULL DEFAULT now(),
  acquired_via    freezeacquisition NOT NULL,
  consumed_at     TIMESTAMPTZ,
  consumed_reason VARCHAR
);

-- Hot path: counting held freezes per user.
CREATE INDEX IF NOT EXISTS ix_user_streak_freezes_held
  ON user_streak_freezes (user_id, consumed_at);

COMMIT;
