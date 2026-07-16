-- Email verification columns (soft verification — login is never gated).
-- schema.prisma is the source of truth; this file exists because the
-- migrations history has pre-existing drift (family-plan changes + the
-- worker tables from src/workers/schema.sql were applied outside
-- `prisma migrate`), so `migrate dev` / `db push` both demand destructive
-- resets. Apply manually instead, exactly like workers/schema.sql.
--
-- ⚠ Run this against PROD (railway connect postgres) BEFORE deploying code
-- that includes the emailVerified field — the regenerated Prisma client
-- selects these columns on every user query, so deploying first breaks auth.
--
-- Idempotent: safe to run more than once.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

-- Existing OAuth users' addresses were already verified by Apple/Google.
-- ::text comparison because the oauthprovider enum's members differ between
-- environments ('apple' is missing from schema.prisma's enum even though
-- routes/oauth.py writes it — pre-existing inconsistency).
UPDATE users
SET email_verified = true, email_verified_at = NOW()
WHERE oauth_provider::text IN ('google', 'apple') AND email_verified IS NOT true;
