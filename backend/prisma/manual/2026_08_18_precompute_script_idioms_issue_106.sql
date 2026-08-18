-- Issue #106: idiom/phrasal-verb detection recomputed on every request.
--
-- `detect_phrasal_verbs_and_idioms` is a pure function of cleaned_script_text,
-- which never changes after ingestion — yet it ran a full spaCy dependency
-- parse on every call to /movies/{id}/vocabulary/preview, /vocabulary/full and
-- /api/cefr/classify-script. Measured in production: 2.4s (5 KB script) to
-- 21.0s (414 KB script), recomputed every time, against a 0.16s baseline.
--
-- This column stores the result so the parse happens once per script.
--   NULL = never computed  -> the read path computes it and writes it back
--   []   = computed, and this script genuinely contains none
-- so an idiom-free script is never reparsed.
--
-- Apply BEFORE the code lands: the regenerated Prisma client selects every
-- column in schema.prisma, so movie_scripts reads break without it.

ALTER TABLE movie_scripts
  ADD COLUMN IF NOT EXISTS idioms JSONB;

COMMENT ON COLUMN movie_scripts.idioms IS
  'Precomputed phrasal verbs + idioms (issue #106): [{phrase, type, cefr_level, words}]. NULL = not yet computed, [] = none in this script. Derived from cleaned_script_text; invalidated to NULL whenever that text is rewritten.';
