-- Drop the always-empty movies.script_text column (issue #102, deferred from #93).
--
-- Prod audit (2026-08-22), re-checked from the 2026-07-23 figures in the issue:
--   movies | with_script_text | bytes
--     4583 |                0 | 0 bytes
-- Zero of 4,583 movies carry a value, so there is nothing to migrate. Every
-- read path already goes through movie_scripts.cleaned_script_text; the only
-- writer was POST /movies, which no longer accepts the field.
--
-- ⚠ DESTRUCTIVE — drops a column, and the ORDER MATTERS. The generated Prisma
-- client selects every column named in schema.prisma, so a deployment still
-- running the old client would 500 on every movie read the moment this lands.
-- Run it AFTER the code that removes `script_text` from schema.prisma is
-- deployed and green — same sequencing as #105's movie_scripts drop and #103's
-- difficulty_level drop. Idempotent (IF EXISTS).

ALTER TABLE movies DROP COLUMN IF EXISTS script_text;
