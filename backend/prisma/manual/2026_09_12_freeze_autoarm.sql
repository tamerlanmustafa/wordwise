-- Remember that we auto-armed a user's freezes, so we only ever do it once.
--
-- WHY
-- ---
-- Arming shipped as a user decision, and the migration that introduced
-- `equipped_at` left every existing freeze UNARMED on purpose: nobody should
-- lose a freeze to a rule they were never shown. But the consume path now
-- spends only ARMED freezes, so the two changes together made every freeze
-- every existing user holds inert — earned, counted in the header, and
-- incapable of covering a missed day. Nobody chose that; it is the seam
-- between two correct decisions.
--
-- So the app arms them once, up to the user's cap, on their next visit to the
-- Practice tab, and says so. That needs a marker, because "has never armed
-- anything" is NOT the same question: a user who deliberately stands every
-- freeze down would be silently re-armed on their next launch, which is the
-- same disrespect in the opposite direction. This column is the marker.
--
-- Nullable and never backfilled: NULL means "not yet auto-armed", which is
-- exactly the state every existing row should be in. New accounts stamp it the
-- first time they open the tab holding a freeze.
--
-- SAFE TO RE-RUN. Additive and nullable; no row is written.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS freeze_autoarm_at TIMESTAMPTZ;

COMMENT ON COLUMN users.freeze_autoarm_at IS
  'When the one-time auto-arm of pre-existing freezes ran for this user. '
  'NULL means it has not run. Distinct from "has never armed a freeze", '
  'which would re-arm a user who deliberately stood theirs down.';
