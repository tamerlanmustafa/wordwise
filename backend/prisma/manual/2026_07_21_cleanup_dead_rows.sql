-- One-off cleanup of dead/bad rows found in the 2026-07-20 prod audit.
--
-- ⚠ DESTRUCTIVE — deletes rows. Review the SELECT counts first (below), then
-- run the DELETEs. Not required by any code deploy; pure hygiene.
--
--   SELECT count(*) FROM translation_cache
--     WHERE lower(btrim(source_text)) = lower(btrim(translated));      -- ~65
--   SELECT count(*) FROM sentence_bank sb
--     WHERE NOT EXISTS (SELECT 1 FROM sentence_lemma_links l
--                       WHERE l.sentence_id = sb.id);                  -- ~825

-- 1. No-op passthrough translations (source == translation): provider
--    failures stored as "translations" (e.g. English text as Turkish). The
--    app now refuses to cache these (translation_service._save_to_cache), so
--    this only clears the historical rows.
DELETE FROM translation_cache
WHERE lower(btrim(source_text)) = lower(btrim(translated));

-- 2. Orphan sentences: indexed in sentence_bank but linked to no lemma, so no
--    read path can ever return them.
DELETE FROM sentence_bank sb
WHERE NOT EXISTS (
  SELECT 1 FROM sentence_lemma_links l WHERE l.sentence_id = sb.id
);
