-- Issue #103 — a movie's CEFR level was derived four different ways and they
-- disagreed. Re-measured on prod 2026-08-20, over the 4,406 movies that have
-- both a score and a stored level:
--
--   all three user-facing derivations agree      2,690  (61.1%)
--   at least two of them disagree                1,716  (38.9%)
--
-- The worst shape, 418 films, answered three different levels at once:
--
--   reel tile / saved-list row   B1   (movies.difficulty_level enum)
--   movie detail screen          B2   (inline ladder in routes/movies.py)
--   home feed shelf              C1   (CEFR_SCORE_RANGES in routes/movies.py)
--
-- The enum was never an independent signal. difficulty_scorer bucketed the
-- same difficulty_score to fill it, but mapped two CEFR bands onto one label
-- (A1+A2 -> ELEMENTARY, B1+B2 -> INTERMEDIATE), which is why every single
-- disagreement against the score was one of exactly two shapes:
--
--   from_enum | from_score | count
--   ----------+------------+-------
--   B1        | B2         |  1003
--   A2        | A1         |     3
--
-- and why BEGINNER, UPPER_INTERMEDIATE and PROFICIENT were never once assigned
-- in 4,406 rows. So the column carried no information the score did not, and
-- there is nothing to preserve: no backfill, no snapshot table.
--
-- The surviving mapping is services/movie_cefr.py, banding difficulty_score on
-- the boundaries /movies/by-cefr already used (A1 <=24, A2 <=34, B1 <=44,
-- B2 <=54, C1 <=69, C2 <=100). The scorer's own 20/35/50/65/80 thresholds were
-- rejected because the scorer clamps most films into 0.35-0.65: prod scores
-- span 18-72 (p50 39, p99 63), so a 65-80 "C1" band holds 31 of 4,406 films
-- against 442 here, and "C2" would be empty.
--
-- ============================================================================
-- ORDERING: RUN THIS *AFTER* THE DEPLOY, NOT BEFORE.
-- ============================================================================
-- This is the reverse of the usual rule in prisma/manual/README.md. That rule
-- exists because a regenerated client SELECTs newly-added columns, so an
-- additive change must reach the DB first. A *drop* fails the other way: the
-- client running in prod right now still lists difficulty_level in every
-- `SELECT` it builds for the movies table, so dropping the column before the
-- new build is live 500s every movie read — the home feed, the reel, search.
--
--   1. merge + push, wait for the Railway `wordwise` deploy to go green
--   2. confirm the new client is live:  curl -s api.getwordwise.us/movies/by-level?level=A1
--      (pre-#103 that is a 400 "Invalid level: A1"; after, a 200 with movies)
--   3. only then run this file
--
-- Step 1 is safe to sit on indefinitely — an unused column costs nothing.
-- ============================================================================

BEGIN;

-- Every level filter is now a range over the score: /movies/by-level,
-- /movies/by-cefr, /movies/?difficulty=, /admin/movies/processed. Create the
-- replacement before dropping the old index so no window is left unindexed.
CREATE INDEX IF NOT EXISTS ix_movies_difficulty_score
    ON public.movies USING btree (difficulty_score);

DROP INDEX IF EXISTS public.ix_movies_difficulty;

ALTER TABLE public.movies DROP COLUMN IF EXISTS difficulty_level;

COMMIT;

-- Planner stats for the new index. Outside the transaction: ANALYZE takes its
-- own snapshot and there is no reason to hold the DDL lock while it runs.
ANALYZE public.movies;

-- ---------------------------------------------------------------------------
-- NOT dropped here, on purpose.
--
-- `books.difficulty_level` and `words.difficulty_level` still reference the
-- `difficultylevel` type, so `DROP TYPE difficultylevel` would fail. Both
-- tables have 0 rows in prod and neither is reachable from the mobile app, so
-- retiring the type is free whenever books stop being a maybe — but it is not
-- this change, and doing it here would mean editing two models nothing reads.
--
--   ALTER TABLE public.words DROP COLUMN difficulty_level;
--   ALTER TABLE public.books DROP COLUMN difficulty_level;
--   DROP TYPE public.difficultylevel;
--
-- ---------------------------------------------------------------------------
-- Verify after applying:
--
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_name = 'movies' AND column_name = 'difficulty_level';   -- 0
--
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'movies' AND indexname LIKE 'ix_movies_difficulty%';
--   -- ix_movies_difficulty_score, and only that
--
--   EXPLAIN SELECT id FROM movies WHERE difficulty_score BETWEEN 35 AND 44;
--   -- Index Scan / Bitmap Index Scan using ix_movies_difficulty_score
