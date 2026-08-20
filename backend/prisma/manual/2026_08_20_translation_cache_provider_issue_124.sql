-- Issue #124 — record which provider translated each cached row.
--
-- Why this has to land BEFORE any bulk warming runs:
--
-- The cache is warmed from two providers with different quality. DeepL is
-- markedly better on the European pairs; Google is the only option for
-- Azerbaijani and the only way to keep warming after DeepL's monthly 500k
-- free characters run out. Warming a language with both is what makes ten
-- languages a ~9-month job instead of a ~17-month one.
--
-- But a row is just `translated` text. Once written, nothing distinguishes a
-- DeepL translation from a Google one. Without this column we would be
-- permanently unable to:
--
--   * audit quality per provider,
--   * re-warm the Google rows with DeepL later (the whole reason mixing is
--     acceptable — it is a reversible decision only if it is a traceable one),
--   * explain why one card in a language reads worse than its neighbour.
--
-- Adding the column afterwards is useless: the existing rows' provenance is
-- gone. This is a one-way door, which is why it goes first.
--
-- Nullable on purpose. The ~4.1k pre-existing rows genuinely have unknown
-- provenance (written before this column existed, mostly DeepL but with no
-- record). Backfilling them to 'deepl' would be inventing data; NULL states
-- honestly that we do not know, and the health report counts them as such.

ALTER TABLE translation_cache
    ADD COLUMN IF NOT EXISTS provider VARCHAR(16);

COMMENT ON COLUMN translation_cache.provider IS
    'Which service produced this translation: deepl | google | NULL (written '
    'before provenance was tracked, #124). Used by the warmer to re-warm '
    'lower-quality rows and by /admin/health/translation-cache to report mix.';

-- Partial index: the only lookup that needs it is "find the Google rows in
-- language X so DeepL can replace them", which is a small slice of the table.
-- Indexing every row (the vast majority of which will be 'deepl') would cost
-- write throughput during warming to speed up a query nobody runs on them.
CREATE INDEX IF NOT EXISTS ix_translation_cache_provider_lang
    ON translation_cache (target_lang, provider)
    WHERE provider IS DISTINCT FROM 'deepl';
