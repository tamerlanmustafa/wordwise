-- Context-aligned word gloss cache on word_sentence_examples.
--
-- The card reveal shows a word's translation next to the sentence
-- translation. Translating the word in isolation (even with a DeepL context
-- hint) can pick a different sense than the one used inside the sentence
-- ("gallant" → centilmen on top, but Cesur inside the sentence). This column
-- stores the word's translation ALIGNED to the sentence translation (one
-- Haiku call, cached), so the two always agree — and so repeat reveals of the
-- same (movie, word, sentence, lang) cost nothing.
--
-- schema.prisma is the source of truth; applied by hand because the
-- migrations history has pre-existing drift (see the email-verification
-- manual migration for why `migrate dev` / `db push` demand a destructive
-- reset here).
--
-- ⚠ Run this against PROD (railway connect Postgres, or psql "$DATABASE_PUBLIC_URL")
-- BEFORE deploying code that includes the wordTranslation field — the
-- regenerated Prisma client selects this column on every
-- word_sentence_examples query, so deploying first breaks that read path.
--
-- Idempotent: safe to run more than once.

ALTER TABLE word_sentence_examples
  ADD COLUMN IF NOT EXISTS word_translation text;
