-- Two more pieces of client state that were never on the account.
--
-- schema.prisma is the source of truth; this file exists because the
-- migrations history has pre-existing drift, so `migrate dev` / `db push`
-- both demand a destructive reset (see 2026_07_15_add_email_verification.sql).
--
-- ⚠ Run this against PROD BEFORE the matching code lands:
--     railway connect Postgres     (or psql "$DATABASE_PUBLIC_URL")
--
-- Idempotent: safe to run more than once.
--
--
-- WHY
--
-- Same audit that produced practice_lessons_completed (2026-09-04). The
-- Practice cursor was not the only thing living in AsyncStorage that had no
-- business being per-install:
--
--   onboarding.v1   → apps/mobile/src/stores/onboardingStore.ts
--   feedLevelMix    → apps/mobile/src/stores/wordFeedStore.ts
--
-- AsyncStorage is per install, so both were properties of the phone:
--
--   • A user who already finished onboarding got the *entire first-run flow
--     again* — placement quiz included — on a second device or after a
--     reinstall. The gate in core/App.tsx reads nothing but the local flag.
--   • The Explore level mix is a setting the user deliberately dialled in.
--     Each phone held a different one, and neither knew about the other.
--
-- (The third finding, the translation language, needed no column: it already
-- has users.learning_language. It simply was never written there.)
--
--
-- SHAPES
--
-- `onboarding_completed_at` is a timestamp rather than a boolean because
-- "when" is free once you are storing "whether", and it is **monotonic**: the
-- API sets it only when it is NULL and never clears it. That is what lets the
-- client merge with a plain OR — local `completed` OR server `completed` —
-- with no backfill and no way for a fresh install (which reports false) to
-- push an existing user back through onboarding.
--
-- `feed_level_mix` is JSONB holding the six CEFR bands as integers summing to
-- 100, the same shape /srs/feed already validates. NULL means "this account
-- has never set one", which is different from an all-zero mix and lets the
-- client keep deriving the default from the user's level.
--
-- Neither is indexed: both are read by primary key as columns of the user row
-- the request has already loaded.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ NULL;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS feed_level_mix JSONB NULL;

COMMENT ON COLUMN users.onboarding_completed_at IS
    'When this ACCOUNT finished onboarding. Was an AsyncStorage flag, so a '
    'second device replayed the whole first-run flow. Set once by PATCH '
    '/auth/me and never cleared; the client merges with OR.';

COMMENT ON COLUMN users.feed_level_mix IS
    'Explore feed CEFR mix chosen by this ACCOUNT: six bands as integers '
    'summing to 100. NULL = never set, so the client derives it from the '
    'user''s level. Was AsyncStorage-only and diverged per install.';
