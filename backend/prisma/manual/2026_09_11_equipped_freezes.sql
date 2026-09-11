-- A freeze is something the user arms, not something the app spends for them.
--
-- WHY
-- ---
-- Two complaints, one column.
--
-- 1. **It was never the user's decision.** The only way a freeze was ever
--    spent was `auto_apply_mercy`, run lazily at the top of `GET /daily/state`
--    — a read. So a freeze was consumed by *opening the app*, and the client
--    never even showed that it had happened: `/daily/state` has returned
--    `auto_consumed` since the feature shipped and nothing in the mobile app
--    reads it. Silent mercy teaches nothing, and silently *losing* your mercy
--    is worse.
--
-- 2. **Freezes were burned even when they could not save the streak.**
--    `freezes_to_consume_for_gap` burned `min(missed_days, held)` with no
--    check that they bridged the gap. Simulated against the real functions:
--
--        gap  held  burned  streak after
--         3     2      2      kept
--         3     1      1      LOST
--         5     2      2      LOST
--        10     8      8      LOST
--
--    A ten-day absence cost all eight freezes AND the streak. Doing nothing
--    would at least have kept the freezes. Note the old behaviour was
--    deliberate — `test_gap_larger_than_held_consumes_all_held` asserted it,
--    commented "burn what we have" — so this is a product decision reversed,
--    not a slip corrected.
--
-- THE MODEL
-- ---------
-- Duolingo's: you equip a freeze in advance, and an equipped freeze is what
-- covers a miss. The *arming* is the decision; the spend still has to be
-- automatic, because the user is by definition not in the app on the day they
-- miss. What changes is that nothing is ever spent that they did not first
-- choose to put at risk, and nothing is spent unless it actually works.
--
-- `equipped_at IS NOT NULL AND consumed_at IS NULL` ⇒ armed and available.
-- Held-but-unequipped freezes stay in the inventory and are never touched.
--
-- SAFE TO RE-RUN. Additive and nullable. Every existing freeze starts
-- unequipped, which means the mercy pass stops consuming anything until users
-- arm one — deliberate: nobody should lose a freeze to a rule they were never
-- shown.

ALTER TABLE user_streak_freezes
  ADD COLUMN IF NOT EXISTS equipped_at TIMESTAMPTZ;

COMMENT ON COLUMN user_streak_freezes.equipped_at IS
  'When the user armed this freeze. NULL = held but not armed. Only an armed, '
  'unconsumed freeze is ever spent to cover a missed day.';

-- Counting what is armed, on every /daily/state.
CREATE INDEX IF NOT EXISTS ix_user_streak_freezes_equipped
  ON user_streak_freezes (user_id, equipped_at)
  WHERE consumed_at IS NULL;
