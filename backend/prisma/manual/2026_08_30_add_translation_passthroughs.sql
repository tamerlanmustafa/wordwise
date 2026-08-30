-- Record translation passthroughs instead of discarding them.
--
-- WHY
-- ---
-- services/translation_service._save_to_cache has always refused to persist a
-- result identical to its source ("khat" → "khat" for TR). That guard is
-- right for what it was written to stop: a provider silently handing English
-- back would otherwise be cached and served as Turkish forever.
--
-- But it collapses two different facts into one `return`:
--
--   * a failed/degraded provider call            → junk, correctly dropped
--   * a genuine loanword identical in the target → a FACT, wrongly dropped
--
-- Measured on prod 2026-08-30, which is what makes this concrete:
--
--   translation_cache          25,665 TR terms,   0 identical  ← by construction
--   word_sentence_examples        290 TR glosses, 7 identical
--
-- Those 7 — khat, tweeter, grappa, beanbag, argon, sampler, malt — survive
-- only because the LLM gloss path (llm_sentence_service.align_word_translation)
-- has no equivalent guard. The 0 in the first row is not an absence of
-- passthroughs; it is an absence of *records* of them. This table is where
-- they go from now on.
--
-- SHAPE
-- -----
-- It stores the OBSERVATION, not the interpretation. Nothing here asserts a
-- word is untranslatable; it asserts that provider P returned it unchanged
-- for language L, N times. Telling a loanword from a dead API call is then a
-- query (two providers agreeing, repeatedly) rather than a guess made at
-- write time with one data point — which is exactly the mistake the old
-- `return` embodied.
--
-- One row per provider, so provider agreement is a GROUP BY. `provider` is
-- NOT NULL DEFAULT 'unknown' on purpose: Postgres treats NULLs as distinct
-- in a unique index, so a nullable column would quietly accumulate duplicate
-- rows for one term rather than incrementing times_seen.
--
-- BLAST RADIUS
-- ------------
-- Additive and idempotent. No existing table, column, or row is touched, and
-- no read path consults this table — a backend deployed before this SQL runs
-- keeps working unchanged, and one deployed after it degrades to "the write
-- fails, gets logged, the translation still returns" (the write is wrapped,
-- deliberately). Safe to run before or after the deploy.
--
--   railway connect Postgres     # or: psql "$DATABASE_PUBLIC_URL"
--   \i backend/prisma/manual/2026_08_30_add_translation_passthroughs.sql

CREATE TABLE IF NOT EXISTS translation_passthroughs (
    id            SERIAL PRIMARY KEY,
    source_text   VARCHAR      NOT NULL,
    target_lang   VARCHAR(10)  NOT NULL,
    provider      VARCHAR(16)  NOT NULL DEFAULT 'unknown',
    times_seen    INTEGER      NOT NULL DEFAULT 1,
    first_seen_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_seen_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- The upsert target. Without it every sighting inserts a new row and
-- times_seen never leaves 1, which is precisely the signal we came for.
CREATE UNIQUE INDEX IF NOT EXISTS unique_translation_passthrough
    ON translation_passthroughs (source_text, target_lang, provider);

-- Reports are "what is identical in Turkish?", never "what languages echo
-- this word?", so the language leads.
CREATE INDEX IF NOT EXISTS ix_translation_passthroughs_target_lang
    ON translation_passthroughs (target_lang);

-- Seed the 7 already observable in the reveal cache, so the table does not
-- start empty and the aligned-gloss path's blind spot is on the record too.
-- Tagged 'llm-gloss' rather than deepl/google because that is who produced
-- them. Idempotent via the unique index; re-running changes nothing.
INSERT INTO translation_passthroughs (source_text, target_lang, provider, times_seen)
SELECT DISTINCT LOWER(BTRIM(word)), UPPER(target_lang), 'llm-gloss', 1
FROM word_sentence_examples
WHERE word_translation IS NOT NULL
  AND LOWER(BTRIM(word_translation)) = LOWER(BTRIM(word))
  AND UPPER(target_lang) <> 'EN'
ON CONFLICT (source_text, target_lang, provider) DO NOTHING;
