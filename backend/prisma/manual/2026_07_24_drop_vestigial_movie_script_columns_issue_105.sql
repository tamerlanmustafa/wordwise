-- Drop the three always-empty text/JSON columns on movie_scripts (issue #105).
--
-- Prod audit (2026-07-24): across all 4,357 movie_scripts rows, these columns
-- are populated on ZERO rows:
--   raw_subtitle_text  0/4357
--   tokenized_words    0/4357
--   cefr_results       0/4357
-- Only the manual-upload path ever wrote raw_subtitle_text, and it produced no
-- surviving rows; nothing in the codebase reads or writes tokenized_words or
-- cefr_results. They are vestigial (same category as the movies.script_text
-- column tracked in #102). The live text lives in cleaned_script_text, which
-- this migration deliberately does NOT touch.
--
-- ⚠ DESTRUCTIVE — drops columns. The regenerated Prisma client no longer
-- references any of these and upload.py no longer writes raw_subtitle_text, so
-- this is cleanup: run it AFTER the code that removes those references is
-- deployed. Idempotent (IF EXISTS).

ALTER TABLE movie_scripts DROP COLUMN IF EXISTS raw_subtitle_text;
ALTER TABLE movie_scripts DROP COLUMN IF EXISTS tokenized_words;
ALTER TABLE movie_scripts DROP COLUMN IF EXISTS cefr_results;
