-- One row per Practice session, so the server can answer for itself what the
-- user actually did.
--
-- WHY
-- ---
-- `POST /srs/session/complete` only ever UPDATEd columns on `users`. Nothing
-- recorded that a session happened, which left four separate problems that are
-- all the same problem:
--
--   1. **The streak is client-reported.** The body carries `total_count`, the
--      server's only guard is `> 0`, and the response echoes it straight back
--      unvalidated. The number a user sees is one the app asserted.
--   2. **The streak cannot be audited or recomputed.** `srs_current_streak` is
--      a scalar with no history behind it, so a bug in it is permanent — there
--      is nothing to rebuild it from.
--   3. **There is no calendar.** Which days a user practised is unrecoverable
--      beyond the single latest date, so a week strip has nothing to draw.
--   4. **The one date we do keep is not even honest.** `auto_apply_mercy`
--      rolls `srs_last_session_date` FORWARD on days the user did not
--      practise, to make the freeze arithmetic work — so anything reading it
--      as "a day the user practised" is reading a day they did not.
--
-- Storing the event fixes all four: the aggregate on `users` stays as the hot
-- read, and this becomes the thing it is derived from.
--
-- SHAPE
-- -----
-- `cards_dealt` is written at session START, from the deck the server itself
-- built. That is what makes the completion clamp possible — the server knows
-- the ceiling before the client reports anything.
--
-- `local_date` is the user's calendar day (see utils/dates.local_today), not
-- the server's, and it is stamped at completion rather than derived later: a
-- user who changes timezone must not retroactively move the days they already
-- earned. It is also the column the week strip reads, which is why the index
-- on (user_id, local_date) is not optional.
--
-- `completed_at IS NULL` ⇒ dealt but never finished. Those rows are kept
-- deliberately: "how often is a deck abandoned" is a question worth being able
-- to ask, and deleting them would make `cards_dealt` mean two different things
-- depending on whether the row survived.
--
-- Run: psql "$DATABASE_URL" -f prisma/manual/2026_09_11_practice_sessions.sql
-- Then: prisma generate
--
-- SAFE TO RE-RUN. Creates nothing that exists, writes no rows, and no existing
-- read changes shape.

BEGIN;

CREATE TABLE IF NOT EXISTS practice_sessions (
  id            SERIAL      PRIMARY KEY,
  user_id       INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Canonical kind, as `services/session_kinds.canonical_kind` resolves it —
  -- so a session started by a stale client reads back as 'practice' here too.
  kind          VARCHAR(40) NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  -- How many cards the SERVER put in the deck. The ceiling the completion
  -- clamps against; a client cannot report having answered more than it was
  -- given.
  cards_dealt   INTEGER     NOT NULL DEFAULT 0,
  correct_count INTEGER,
  total_count   INTEGER,
  -- The user's own calendar day, stamped at completion. NULL until finished.
  local_date    DATE
);

-- The week strip: "which local days did this user complete a session on".
-- Partial, because a row with no completion is not a day the user practised
-- and would otherwise have to be filtered out on every read.
CREATE INDEX IF NOT EXISTS ix_practice_sessions_user_day
  ON practice_sessions (user_id, local_date)
  WHERE completed_at IS NOT NULL;

-- Resuming / completing the session a client is holding an id for.
CREATE INDEX IF NOT EXISTS ix_practice_sessions_user_started
  ON practice_sessions (user_id, started_at DESC);

COMMIT;
