-- The day a streak is measured in belongs to the user, not to the server.
--
-- WHY
-- ---
-- Every date this product cares about — the streak, the free tier's one lesson
-- a day, the chest, the freeze gap arithmetic — was computed as
-- `datetime.now(timezone.utc).date()`. That was a deliberate choice, recorded
-- at services/srs_engine.py: "UTC was picked over user-local time
-- deliberately: the server has no reliable client timezone."
--
-- The premise was true and is no longer. `expo-localization` is already in the
-- mobile binary (it resolves the UI locale), so the client can report an IANA
-- zone on launch at the cost of one field on a PATCH it already sends.
--
-- What UTC-only costs, concretely: at UTC+13 a session practised at 10am local
-- on Monday is stamped Sunday 21:00 UTC. Two consecutive local mornings can
-- therefore land on one UTC day — the streak does not advance and the user is
-- told they have already practised today — or straddle two, spending two days
-- of a free tier's budget for one sitting. At UTC-8 the mirror image: the day
-- rolls over at 4pm local, so an evening session counts for tomorrow.
--
-- SHAPE
-- -----
-- An IANA name ('Europe/Istanbul'), not an offset. Offsets are wrong twice a
-- year in every country with daylight saving, and a streak that breaks on the
-- clock change is the same bug this migration exists to remove.
--
-- NULLABLE on purpose, and the server falls back to UTC when it is NULL. That
-- is the entire backward-compatibility story: every account starts NULL and
-- behaves exactly as it does today until a client that knows how to report a
-- zone signs in. No backfill, no guessing a zone from a phone number or an IP.
--
-- SAFE TO RE-RUN. Additive and nullable; no row is written and no existing
-- read changes shape.

ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone VARCHAR;

COMMENT ON COLUMN users.timezone IS
  'IANA timezone name reported by the client (e.g. Europe/Istanbul). NULL means '
  'unknown, and every date calculation falls back to UTC. Set via PATCH /auth/me.';
