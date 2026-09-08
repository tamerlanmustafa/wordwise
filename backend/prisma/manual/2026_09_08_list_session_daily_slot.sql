-- users.srs_last_list_session_date — the Lists tab gets its own daily budget.
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
-- The free tier is "one session per UTC day", and until now that was one slot
-- shared by two different activities: the Practice tab's daily lesson, and a
-- deck drilled from a list the user built themselves. Tapping the gold button
-- on your own saved words therefore consumed the day's Practice lesson — the
-- streak, the stair-tile number and the chest with it — with nothing on the
-- button to say so.
--
-- That is the same defect as 407cb12 (a list session *recording* the day),
-- one layer down: a once-a-day resource spent by something that is not the
-- thing it exists to measure. 407cb12 stopped a list from claiming the day's
-- credit; without this column it can still spend the day's budget, so a free
-- user is punished for practising more.
--
-- The column makes the two independent, which is all it does. Free tier
-- becomes one Practice lesson AND one list session per day. Premium and admin
-- bypass both gates exactly as before.
--
--
-- WHY A NEW COLUMN RATHER THAN REUSING ONE
--
-- Nothing on `users` could answer "did they finish a list deck today":
--
--   * srs_last_session_date is now Practice-only by design — it drives the
--     streak, and 407cb12 is precisely the change that stopped list sessions
--     from touching it;
--   * srs_last_session_started_at is the LAST session of any kind, clobbered
--     by whichever started most recently, and is about dealing rather than
--     finishing;
--   * srs_last_session_kind has the same clobbering problem and no date of
--     its own.
--
-- Overloading any of them would have made one column mean two things
-- depending on who was reading, which is how the shared slot became a bug in
-- the first place.
--
--
-- WHY IT NEEDS NO BACKFILL
--
-- NULL reads as "has never finished a list session", which is true for every
-- existing row on the day this lands, and is exactly what the gate wants:
-- `can_free_user_start_session_today(None)` is True, so the first list deck
-- after deploy is allowed. The column heals itself on first use.
--
--
-- TYPE NOTE — READ BEFORE WRITING TO THIS COLUMN
--
-- DATE, matching srs_last_session_date. prisma-client-py 0.11 will NOT
-- serialise a bare `datetime.date` into a query (it raises TypeError and 500s
-- the request), and it hands the column back as a `datetime` on read, so a
-- `== today` comparison against a `date` is False on the day it should be
-- True. Both halves were live bugs on 2026-09-08 — the first is why the daily
-- chest had never once been awarded. Go through `utils/dates.utc_midnight`
-- when writing and `utils/dates.as_date` when reading; do not hand-roll it.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS srs_last_list_session_date DATE;

COMMENT ON COLUMN users.srs_last_list_session_date IS
    'UTC date of the last COMPLETED Lists-tab practice deck. The free tier''s '
    'per-day budget for list practice, deliberately separate from '
    'srs_last_session_date so drilling a list cannot spend the day''s Practice '
    'lesson. Written by /srs/session/complete, read by /srs/session/start.';

-- No index. Read by primary key only, as one column of the user row the
-- request has already loaded.
