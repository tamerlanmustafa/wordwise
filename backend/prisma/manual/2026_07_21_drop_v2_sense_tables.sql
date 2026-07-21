-- Retire the dead V2 sense-disambiguation infrastructure.
--
-- Prod audit (2026-07-20): word_senses had 1,358 rows over 619 lemmas (0.4%),
-- translation_memory had 10 rows, dominant_sense_id was NULL on all 5.4M
-- movie_lemma_mappings, and sense_id was NULL on all 7.7M sentence_lemma_links.
-- Nothing populated it (the eager pipeline was only reachable from admin /v2
-- endpoints the app never called) and the code that used it has been removed.
--
-- ⚠ DESTRUCTIVE — drops tables and columns. The regenerated Prisma client no
-- longer references any of these, so the code deploy does NOT require this to
-- run; it's cleanup. Safe to run AFTER (or independently of) deploying the
-- V2-removal code. Idempotent (IF EXISTS).
--
-- Order matters: drop the FK-bearing columns before the tables they reference.

-- 1. FK columns that reference word_senses.
ALTER TABLE movie_lemma_mappings DROP COLUMN IF EXISTS dominant_sense_id;
ALTER TABLE sentence_lemma_links  DROP COLUMN IF EXISTS sense_id;

-- 2. translation_memory (FKs lemmas + word_senses), then word_senses.
DROP TABLE IF EXISTS translation_memory;
DROP TABLE IF EXISTS word_senses;

-- 3. Replace the link read-path index. The old composite
--    ix_sentence_lemma_link_lemma_sense (lemma_id, sense_id) is dropped with
--    the sense_id column; the read path only needs lemma_id.
CREATE INDEX IF NOT EXISTS ix_sentence_lemma_link_lemma_id
  ON sentence_lemma_links (lemma_id);
