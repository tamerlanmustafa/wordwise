-- Allow sentence_bank rows with the same sentenceHash to co-exist per movie.
--
-- Previous schema deduped sentences globally by SHA-256 hash. That broke
-- per-movie queries for movies that share text with others (most visibly,
-- duplicate movie rows like the two City of God entries id=29 and id=69 —
-- the second movie's link inserts collide with the first's, so its For You
-- list silently loses sentences).
--
-- This change keeps dedup but scopes it to (movieId, sentenceHash). Same
-- text in two movies → two rows. Same text twice in one movie → one row.
--
-- Additive + safe: no row deletions, no FK changes. Existing rows already
-- satisfy the new compound uniqueness because the global one was stricter.
--
-- Run: psql "$DATABASE_URL" -f prisma/migrations_manual/2026_05_09_sentence_bank_per_movie.sql
-- Then: prisma generate

BEGIN;

-- Drop the global hash uniqueness. Prisma stored this as a UNIQUE INDEX,
-- not a CONSTRAINT, so DROP CONSTRAINT is a no-op — we have to drop the
-- index explicitly. The CONSTRAINT line stays for environments where it
-- might have been promoted (no-op IF NOT EXISTS).
ALTER TABLE sentence_bank
  DROP CONSTRAINT IF EXISTS sentence_bank_sentence_hash_key;
DROP INDEX IF EXISTS sentence_bank_sentence_hash_key;

-- Replace with per-movie uniqueness.
ALTER TABLE sentence_bank
  ADD CONSTRAINT sentence_bank_hash_movie_unique UNIQUE (sentence_hash, movie_id);

-- The hash column is still useful as a dedup key inside the indexer, so
-- keep a non-unique index on it.
CREATE INDEX IF NOT EXISTS ix_sentence_bank_sentence_hash
  ON sentence_bank (sentence_hash);

COMMIT;
