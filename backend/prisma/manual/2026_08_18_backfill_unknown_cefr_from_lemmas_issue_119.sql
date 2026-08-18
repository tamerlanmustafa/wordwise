-- Recover UNKNOWN word_classifications from the lemmas registry — issue #119.
--
-- Data only: no schema change, so this does not carry the "prod before push"
-- ordering that the schema files in this directory do. The matching code
-- (src/services/cefr_registry.py) stops NEW rows being written this way; this
-- file fixes the ones already stored.
--
--     psql "$DATABASE_PUBLIC_URL" -f <this file>
--     (DATABASE_PUBLIC_URL from the *Postgres* service — the wordwise
--      service's DATABASE_URL is the unreachable postgres.railway.internal)
--
-- ⚠ Do NOT wrap this file in BEGIN/COMMIT: section 3 commits per batch.
--
-- Idempotent: a re-run matches zero rows, because the rows it would touch are
-- no longer cefr_level='UNKNOWN'.
--
-- WHY
-- word_classifications holds a CEFR level per (script, word); lemmas holds one
-- per word. Classification is script-sensitive in a way the word is not — the
-- proper-noun branch of the classifier fires on capitalisation, so "Journey"
-- opening a line of dialogue is stored UNKNOWN for that script while every
-- other script, and the registry, has it at A1. should_keep_word drops
-- UNKNOWN, so those rows never reach a movie vocabulary screen.
--
-- Measured on prod 2026-08-18:
--   4,819,624 rows total, 761,423 UNKNOWN (15.8%)
--   526,251 of them (8,521 distinct words) have a real level in `lemmas`
--   = 69% of every UNKNOWN row, recoverable with no reclassification
--   A1 356,924 · A2 77,815 · B1 54,602 · B2 31,505 · C1 4,255 · C2 1,150
--
-- WHAT IS DELIBERATELY LEFT ALONE
-- A `lemmas` row with source='fallback' and confidence 0 is not a
-- classification: it is populate_lemma_registry's old A2 default for lemmas
-- the classifier never placed ("adumbrate", "asse", "ers" — 83 lemmas / 453
-- rows). Promoting UNKNOWN to that is re-importing the #91 bucket under a
-- different label, so it is excluded. The deliberate whitelists share
-- source='fallback' but carry real confidence (kids 0.95, informal slang
-- 0.85) and are kept — the split is on confidence, exactly as the #91
-- backfill did it.
--
-- Related: #127 normalises the ~135x duplication that makes this drift
-- possible in the first place, which retires this whole class of backfill.


-- ---------------------------------------------------------------------------
-- 1. Snapshot, so this is reversible
-- ---------------------------------------------------------------------------
-- Once UNKNOWN becomes A1 there is nothing left to say the row was ever in the
-- bucket. Keep the old values until #127 lands; section 5 has the undo.
CREATE TABLE IF NOT EXISTS backfill_119_unknown_snapshot (
    id            integer PRIMARY KEY,
    cefr_level    proficiencylevel NOT NULL,
    confidence    double precision NOT NULL,
    source        classificationsource NOT NULL,
    frequency_rank integer,
    captured_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO backfill_119_unknown_snapshot (id, cefr_level, confidence, source, frequency_rank)
SELECT wc.id, wc.cefr_level, wc.confidence, wc.source, wc.frequency_rank
  FROM word_classifications wc
  JOIN lemmas l ON l.lemma = wc.lemma
 WHERE wc.cefr_level = 'UNKNOWN'
   AND l.cefr_level <> 'UNKNOWN'
   AND NOT (l.source = 'fallback' AND l.confidence < 0.5)
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 2. What this is about to change
-- ---------------------------------------------------------------------------
SELECT l.cefr_level AS becomes,
       count(*)               AS rows,
       count(DISTINCT wc.lemma) AS lemmas
  FROM word_classifications wc
  JOIN lemmas l ON l.lemma = wc.lemma
 WHERE wc.cefr_level = 'UNKNOWN'
   AND l.cefr_level <> 'UNKNOWN'
   AND NOT (l.source = 'fallback' AND l.confidence < 0.5)
 GROUP BY 1
 ORDER BY 2 DESC;


-- ---------------------------------------------------------------------------
-- 3. Backfill
-- ---------------------------------------------------------------------------
-- ~526k rows of a 4.8M-row, 827MB table. Batched so no single statement holds
-- locks or piles up WAL across the whole table while the app is serving movie
-- vocabulary from it.
--
-- confidence and source are adopted alongside the level so the row stays
-- self-consistent — a row saying "A1, source=fallback, confidence=0.9" would
-- claim the proper-noun branch produced an A1.
DO $$
DECLARE
    touched integer;
    done integer := 0;
BEGIN
    LOOP
        WITH batch AS (
            SELECT wc.id,
                   l.cefr_level,
                   l.confidence,
                   l.source,
                   COALESCE(wc.frequency_rank, l.frequency_rank) AS frequency_rank
              FROM word_classifications wc
              JOIN lemmas l ON l.lemma = wc.lemma
             WHERE wc.cefr_level = 'UNKNOWN'
               AND l.cefr_level <> 'UNKNOWN'
               AND NOT (l.source = 'fallback' AND l.confidence < 0.5)
             LIMIT 25000
             FOR UPDATE OF wc SKIP LOCKED
        )
        UPDATE word_classifications wc
           SET cefr_level     = batch.cefr_level,
               confidence     = batch.confidence,
               source         = batch.source,
               frequency_rank = batch.frequency_rank
          FROM batch
         WHERE wc.id = batch.id;

        GET DIAGNOSTICS touched = ROW_COUNT;
        EXIT WHEN touched = 0;
        done := done + touched;
        RAISE NOTICE 'word_classifications: % rows recovered from lemmas', done;
        COMMIT;
    END LOOP;
END $$;


-- ---------------------------------------------------------------------------
-- 4. Verify
-- ---------------------------------------------------------------------------
-- Expected: UNKNOWN drops 761,423 → ~235,172, and `recoverable` reads 0.
SELECT count(*) FILTER (WHERE cefr_level = 'UNKNOWN') AS unknown_rows,
       count(*)                                        AS total_rows
  FROM word_classifications;

SELECT count(*) AS recoverable
  FROM word_classifications wc
  JOIN lemmas l ON l.lemma = wc.lemma
 WHERE wc.cefr_level = 'UNKNOWN'
   AND l.cefr_level <> 'UNKNOWN'
   AND NOT (l.source = 'fallback' AND l.confidence < 0.5);


-- ---------------------------------------------------------------------------
-- 5. Undo (not run — kept here so the snapshot is usable without archaeology)
-- ---------------------------------------------------------------------------
-- backfill_119_unknown_snapshot is scaffolding, not schema: it is deliberately
-- absent from schema.prisma. Drop it (~30MB) once the recovered words have
-- been seen on the movie screens, or when #127 makes the drift impossible.
--
-- UPDATE word_classifications wc
--    SET cefr_level = s.cefr_level,
--        confidence = s.confidence,
--        source = s.source,
--        frequency_rank = s.frequency_rank
--   FROM backfill_119_unknown_snapshot s
--  WHERE wc.id = s.id;
