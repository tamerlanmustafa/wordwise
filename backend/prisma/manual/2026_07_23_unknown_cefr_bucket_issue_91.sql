-- UNKNOWN CEFR bucket — GitHub issue #91.
--
-- schema.prisma is the source of truth; this file exists because the
-- migrations history has pre-existing drift, so `migrate dev` / `db push`
-- both demand a destructive reset (see 2026_07_15_add_email_verification.sql).
--
-- ⚠ Run this against PROD BEFORE the matching code lands:
--     railway connect Postgres     (or psql "$DATABASE_PUBLIC_URL")
--
-- ⚠ Do NOT wrap this file in BEGIN/COMMIT. Section 1 uses
--   `ALTER TYPE ... ADD VALUE`, whose new label is not usable by later
--   statements in the same transaction, and section 2 commits per batch.
--   Run it as-is with psql, which commits each statement on its own.
--
-- Idempotent: safe to run more than once. Re-runs match zero rows because
-- the rows they would touch are no longer cefr_level='A2'.
--
-- WHY
-- A2 was the classifier's dumping ground. Prod on 2026-07-23: 22,452 of
-- 41,619 lemmas (53.9%) sat at A2, against ~1.4k that any real CEFR wordlist
-- calls A2. Two `source='fallback'` branches in
-- src/services/cefr_classifier.py produced the rest, and both now write
-- UNKNOWN instead:
--
--   confidence 0.9  proper nouns / fantasy words — the branch DETECTS that a
--                   word is a name and then labelled it A2 anyway, which is
--                   how "Aleppo", "Orson" and "Fezziwig" reached A2 learners.
--                   14,399 lemmas + 756,930 word_classifications.
--   confidence 0.2  the final "no wordlist, no frequency, no heuristic"
--                   fallback. 217 lemmas + 2,237 word_classifications.
--
-- The kids whitelist (confidence 0.95: "whee", "yippee") is a deliberate A2
-- call and is left alone — matched on confidence, not on source, for exactly
-- that reason. Confidence is double precision, so these are ranges rather
-- than equality tests; the three branches are far apart (0.2 / 0.9 / 0.95).
--
-- Nothing is deleted. UNKNOWN rows stay queryable so we can see what
-- collects there (admin health exposes `unknown_registry_share`) before
-- deciding what they deserve.


-- ---------------------------------------------------------------------------
-- 1. proficiencylevel: add the UNKNOWN label
-- ---------------------------------------------------------------------------
-- Declared after C2 so enum ordering puts it above every real level: any
-- `cefr_level <= <user level>` comparison excludes it by construction,
-- rather than mistaking it for beginner vocabulary.
ALTER TYPE proficiencylevel ADD VALUE IF NOT EXISTS 'UNKNOWN';


-- ---------------------------------------------------------------------------
-- 2. Backfill rows written by the two fallback branches
-- ---------------------------------------------------------------------------
-- lemmas is small (14,616 rows), so it goes in one statement.
UPDATE lemmas
   SET cefr_level = 'UNKNOWN',
       updated_at = now()
 WHERE source = 'fallback'
   AND cefr_level = 'A2'
   AND (confidence BETWEEN 0.88 AND 0.92 OR confidence BETWEEN 0.15 AND 0.25);

-- word_classifications is ~759k of 4.77M rows. Batched so no single
-- statement holds locks or piles up WAL across the whole table while the
-- app is serving movie vocabulary from it.
DO $$
DECLARE
    touched integer;
    done integer := 0;
BEGIN
    LOOP
        WITH batch AS (
            SELECT id FROM word_classifications
             WHERE source = 'fallback'
               AND cefr_level = 'A2'
               AND (confidence BETWEEN 0.88 AND 0.92
                    OR confidence BETWEEN 0.15 AND 0.25)
             LIMIT 25000
             FOR UPDATE SKIP LOCKED
        )
        UPDATE word_classifications wc
           SET cefr_level = 'UNKNOWN'
          FROM batch
         WHERE wc.id = batch.id;

        GET DIAGNOSTICS touched = ROW_COUNT;
        EXIT WHEN touched = 0;
        done := done + touched;
        RAISE NOTICE 'word_classifications: % rows relabelled', done;
        COMMIT;
    END LOOP;
END $$;


-- ---------------------------------------------------------------------------
-- 3. Verify
-- ---------------------------------------------------------------------------
-- Expected after the backfill: lemmas A2 ~7,836 (18.8%), UNKNOWN ~14,616.
-- word_classifications A2 drops by ~759k; UNKNOWN picks it up.
SELECT 'lemmas' AS table, cefr_level, count(*)
  FROM lemmas GROUP BY 1, 2
UNION ALL
SELECT 'word_classifications', cefr_level, count(*)
  FROM word_classifications GROUP BY 1, 2
 ORDER BY 1, 2;
