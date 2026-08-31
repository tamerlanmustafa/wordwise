-- user_words.source — tell a word the user chose apart from one Practice added.
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
-- The Practice tab used to pad a short session with lemmas pulled from a reel
-- movie's script, and every padded row was written with that movie's id. That
-- movie_id was doing load-bearing work nobody named: the Favourites list and
-- the saved-words screen are adapters over
--
--     user_words WHERE movie_id IS NULL AND is_learned = false
--
-- (services/lists.py::list_words, ::_favourites_page, routes/user_words.py),
-- so a NOT NULL movie_id is the only thing that kept auto-added practice
-- vocabulary out of the list the user thinks of as "words I saved".
--
-- Practice now pads from the lemmas registry at the user's CEFR level instead
-- of from a film, so there is no movie to attribute the row to and movie_id is
-- NULL. Without a second marker every word the quiz introduced would appear in
-- the user's Favourites, which is not a list they built.
--
-- `source` is that marker, and it says what it means rather than leaning on a
-- foreign key's nullability to imply it:
--
--     NULL         legacy row, or one the user saved themselves. Treated as
--                  user-owned everywhere — the backfill deliberately leaves
--                  existing rows alone, because every row written before this
--                  migration either came from a save or carries a movie_id.
--     'practice'   introduced by a Practice session's padding. Studied like
--                  any other row, but never shown as something the user saved.
--
-- Reads use `source IS DISTINCT FROM 'practice'` rather than `<> 'practice'`:
-- plain <> is NULL for a NULL source, which SQL treats as not-true, so it
-- would filter out every legacy row — i.e. every saved word in the database.

ALTER TABLE user_words
    ADD COLUMN IF NOT EXISTS source VARCHAR(16);

COMMENT ON COLUMN user_words.source IS
    'NULL = saved by the user (or legacy); ''practice'' = added by a Practice '
    'session''s padding. Saved-word surfaces filter on IS DISTINCT FROM ''practice''.';

-- No index. The column is only ever read alongside user_id, which
-- ix_user_words_user_id and ix_user_words_user_due already cover, and its
-- cardinality (2) would make a standalone b-tree useless to the planner.
