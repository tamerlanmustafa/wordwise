-- Schema audit cleanup — GitHub issue #93.
--
-- schema.prisma is the source of truth; this file exists because the
-- migrations history has pre-existing drift, so `migrate dev` / `db push`
-- both demand a destructive reset (see 2026_07_15_add_email_verification.sql).
--
-- ⚠ Run this against PROD BEFORE the matching code lands:
--     railway connect Postgres     (or psql "$DATABASE_PUBLIC_URL")
--
-- ⚠ Do NOT wrap this file in BEGIN/COMMIT. Section 2 uses
--   `ALTER TYPE ... ADD VALUE`, whose new label is not usable by later
--   statements in the same transaction. Run it as-is with psql, which
--   commits each statement on its own.
--
-- Idempotent: safe to run more than once.


-- ---------------------------------------------------------------------------
-- 1. user_words: uniqueness backstop for global (movie_id IS NULL) markers
-- ---------------------------------------------------------------------------
-- `unique_user_word_movie` is (user_id, word, movie_id) with movie_id
-- nullable, and Postgres treats NULL <> NULL — so the global learned-marker
-- rows escape the constraint entirely and concurrent /mark-learned calls can
-- write duplicates. /unlearn then deletes only one, leaving a stale marker
-- that keeps hiding the word everywhere. Same NULL trap sentence_bank hit;
-- same fix (partial unique index), see
-- migrations_manual/2026_05_14_shared_sentences_and_cost_ledger.sql.

-- 1a. Collapse is_learned onto the row we are about to keep. "Keep" = the
--     most advanced SRS state (these rows carry Leitner state too — srs.py
--     pads sessions with movie_id IS NULL rows), tie-broken by recency.
WITH ranked AS (
    SELECT
        id,
        bool_or(is_learned) OVER (PARTITION BY user_id, word) AS any_learned,
        row_number() OVER (
            PARTITION BY user_id, word
            ORDER BY srs_box DESC,
                     srs_last_reviewed_at DESC NULLS LAST,
                     created_at DESC,
                     id DESC
        ) AS rn
    FROM user_words
    WHERE movie_id IS NULL
)
UPDATE user_words uw
SET is_learned = true
FROM ranked r
WHERE uw.id = r.id
  AND r.rn = 1
  AND r.any_learned
  AND uw.is_learned IS DISTINCT FROM true;

-- 1b. Drop the losers.
WITH ranked AS (
    SELECT
        id,
        row_number() OVER (
            PARTITION BY user_id, word
            ORDER BY srs_box DESC,
                     srs_last_reviewed_at DESC NULLS LAST,
                     created_at DESC,
                     id DESC
        ) AS rn
    FROM user_words
    WHERE movie_id IS NULL
)
DELETE FROM user_words uw
USING ranked r
WHERE uw.id = r.id
  AND r.rn > 1;

-- 1c. The backstop itself. Prisma cannot express partial uniques, so this
--     index lives only here — schema.prisma carries a pointer comment.
CREATE UNIQUE INDEX IF NOT EXISTS user_words_global_word_unique
    ON user_words (user_id, word)
    WHERE movie_id IS NULL;


-- ---------------------------------------------------------------------------
-- 2. oauthprovider: add the 'apple' label the code has always written
-- ---------------------------------------------------------------------------
-- src/routes/oauth.py writes oauthProvider='apple', but the enum in
-- schema.prisma and the init migration only had email|google|facebook.
--
-- Issue #93 assumed prod had the label added by hand (as
-- 2026_07_15_add_email_verification.sql speculated). It did not: on
-- 2026-07-23 prod's enum was still email|google|facebook and `users` had
-- zero rows with an apple_id — i.e. Apple sign-in had never once succeeded
-- in production, it 500'd on this write every time. This statement is the
-- actual fix for that, not just fresh-DB reproducibility.
ALTER TYPE oauthprovider ADD VALUE IF NOT EXISTS 'apple';


-- ---------------------------------------------------------------------------
-- 3. user_word_lists: NoAction -> Cascade on both FKs
-- ---------------------------------------------------------------------------
-- The only user-owned table left on NoAction. Account deletion works solely
-- because DELETE /auth/me deletes these rows first inside its transaction;
-- any second deletion path (admin purge, GDPR script) would trip on the
-- constraint. Same for word_id, which blocks deleting a Word.
ALTER TABLE user_word_lists
    DROP CONSTRAINT IF EXISTS user_word_lists_user_id_fkey;
ALTER TABLE user_word_lists
    ADD CONSTRAINT user_word_lists_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE user_word_lists
    DROP CONSTRAINT IF EXISTS user_word_lists_word_id_fkey;
ALTER TABLE user_word_lists
    ADD CONSTRAINT user_word_lists_word_id_fkey
    FOREIGN KEY (word_id) REFERENCES words (id) ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- 4. Drop indexes that duplicate an existing unique/primary key
-- ---------------------------------------------------------------------------
-- Each of these shadows the table's PK index (or, for movie_scripts, the
-- unique on the same column): write overhead on every insert, zero reads.
DROP INDEX IF EXISTS ix_users_id;
DROP INDEX IF EXISTS ix_movies_id;
DROP INDEX IF EXISTS ix_books_id;
DROP INDEX IF EXISTS ix_words_id;
DROP INDEX IF EXISTS ix_user_word_lists_id;
DROP INDEX IF EXISTS ix_movie_scripts_movie_id;


-- ---------------------------------------------------------------------------
-- 5. users: make the three-state booleans two-state
-- ---------------------------------------------------------------------------
-- is_active / is_admin / ads_eligible are nullable but every read path treats
-- them as plain booleans (`not user.isActive`, `bool(u.isAdmin)`), so NULL is
-- an unrepresentable third state that only invites bugs.
UPDATE users SET is_active     = true  WHERE is_active     IS NULL;
UPDATE users SET is_admin      = false WHERE is_admin      IS NULL;
UPDATE users SET ads_eligible  = true  WHERE ads_eligible  IS NULL;

ALTER TABLE users ALTER COLUMN is_active    SET DEFAULT true;
ALTER TABLE users ALTER COLUMN is_admin     SET DEFAULT false;
ALTER TABLE users ALTER COLUMN ads_eligible SET DEFAULT true;

ALTER TABLE users ALTER COLUMN is_active    SET NOT NULL;
ALTER TABLE users ALTER COLUMN is_admin     SET NOT NULL;
ALTER TABLE users ALTER COLUMN ads_eligible SET NOT NULL;
