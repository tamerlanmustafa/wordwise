-- users.practice_lessons_completed — the Practice path's lesson number, on the
-- account instead of on the phone.
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
-- The Practice tab is a linear path of lesson tiles and the cursor — "which
-- lesson am I on" — has always lived in AsyncStorage:
--
--     apps/mobile/src/stores/practicePathStore.ts   KEY = 'practice.path.cursor.v1'
--
-- AsyncStorage is per *install*, not per account. So the number was never a
-- property of the user at all; it was a property of the phone. Reported
-- 2026-09-04 for account id 1: the same login showed lesson 34 on iOS and
-- lesson 8 on Android, because those are two independent counters that have
-- never met. Reinstalling the app resets it to 1 for the same reason, and
-- nothing about that was visible as a bug until someone signed in twice.
--
-- Nothing else on `users` could stand in for it. `srs_total_reviews` counts
-- cards, not sessions; `srs_current_streak` counts days; `user_quiz_stats.
-- total_sessions` belongs to the movie quiz, which is a different surface.
--
--
-- MERGING THE TWO DEVICES
--
-- The column starts at 0 for everyone, which would read as "your progress is
-- gone" on first launch — so the client does not simply adopt the server's
-- value. `POST /srs/practice-progress` merges with GREATEST:
--
--     practice_lessons_completed = GREATEST(practice_lessons_completed, $submitted)
--
-- A monotonic counter is the one shape that merges safely without a real sync
-- protocol: GREATEST is commutative and idempotent, so it does not matter
-- which device syncs first, how often, or whether a request is retried. The
-- iOS install pushes 34 and the column becomes 34; the Android install pushes
-- 8 and stays 34, then adopts it. Both converge on the higher number and no
-- lesson is lost, with no backfill to write and nothing to run once.
--
-- From then on `/srs/session/complete` owns the increment, under the same
-- `total_count > 0` guard the streak uses — a deck whose every card was
-- unrenderable "finishes" without asking the user anything, and that is not a
-- lesson any more than it is a streak day.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS practice_lessons_completed INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN users.practice_lessons_completed IS
    'Practice path cursor — how many lessons this ACCOUNT has completed. '
    'Was AsyncStorage-only, so it diverged per install. Merged with GREATEST '
    'on sync; incremented by /srs/session/complete.';

-- No index. It is only ever read by primary key, as one column of the user
-- row the request has already loaded.
