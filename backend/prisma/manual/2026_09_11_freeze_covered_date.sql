-- Record WHICH day a spent freeze covered.
--
-- WHY
-- ---
-- A consumed freeze records `consumed_at` (the instant the mercy pass ran, on
-- the user's return) and `consumed_reason`. Neither says which calendar day it
-- paid for, and those are routinely different: a user who misses Tuesday and
-- opens the app on Thursday has a freeze consumed on Thursday covering
-- Tuesday. The only trace of the covered day was `srs_last_session_date` being
-- rolled forward — a mutation, not a record, and one that is overwritten by
-- the next session.
--
-- The week strip needs to draw a *frozen* day differently from a missed one:
-- that distinction is the entire reason a user tolerates a streak mechanic at
-- all, and showing a covered day as a gap would report the freeze as having
-- failed. Without this column the strip would have to guess, and the honest
-- options were "guess" or "don't show frozen days" — neither acceptable for a
-- number the app asks people to care about.
--
-- Nullable: every freeze consumed before this column existed has no covered
-- day and the strip renders those days as missed. That is a small, bounded
-- and self-healing inaccuracy — it only affects days already in the past for
-- users who had already spent a freeze — and it is preferable to inventing a
-- date from a rolled counter.
--
-- SAFE TO RE-RUN. Additive and nullable; no row is written.

ALTER TABLE user_streak_freezes
  ADD COLUMN IF NOT EXISTS covered_date DATE;

COMMENT ON COLUMN user_streak_freezes.covered_date IS
  'The local calendar day this freeze paid for. Distinct from consumed_at, '
  'which is when the mercy pass noticed. NULL for freezes spent before this '
  'column existed.';

-- The week strip: "which days in this range were covered by a freeze".
CREATE INDEX IF NOT EXISTS ix_user_streak_freezes_covered
  ON user_streak_freezes (user_id, covered_date)
  WHERE covered_date IS NOT NULL;
