-- Add `matched_form` to sentence_lemma_links so the /sentences endpoint
-- can return the highlighted token without re-running spaCy on every cached
-- sentence on every request. Populated at indexing time by
-- populate_sentence_bank.
--
-- Additive only: column is nullable. Legacy rows stay NULL and the endpoint
-- falls back to the input word for highlighting (case-insensitive match on
-- the client already handles surface-form variation).
--
-- Run: psql "$DATABASE_URL" -f prisma/migrations_manual/2026_05_08_sentence_link_matched_form.sql
-- Then: prisma generate

BEGIN;

ALTER TABLE sentence_lemma_links
  ADD COLUMN IF NOT EXISTS matched_form VARCHAR;

COMMIT;
