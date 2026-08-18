-- Issue #120 — the hot 44k-lemma working set is buried inside a 7.7M-row index.
--
-- The issue proposed declarative partitioning. Re-measured after #118 landed
-- (as the issue instructed), the premise had changed and the remedy with it:
--
--   * shared_buffers is now 6GB against a 4,080 MB database, so the whole DB
--     is resident. Every buffer access below is a `hit`, zero reads. The
--     "shared_buffers cannot hold the hot set" argument no longer holds, and
--     the 539 seq scans over 2.6B rows are gone — the planner picks
--     ix_sentence_bank_movie_id now.
--
--   * The defect that survived is CPU, not storage. Both hot queries spend
--     ~97% of their work rebuilding the SAME 44,142-lemma set from scratch:
--
--       Explore feed candidates   52 ms   Buffers: shared hit=150,441
--       sentence worker backlog   66 ms   Buffers: shared hit=151,031
--
--       ->  Index Only Scan using unique_sentence_lemma  (7.7M entries)
--             Index Searches: 48537
--             Buffers: shared hit=145,783     <-- 97% of both queries
--
--     48,537 separate B-tree descents into a 7.7M-entry index — ~1.15 GB of
--     buffer traffic per request — to answer "which lemmas have a global LLM
--     sentence?". On a single uvicorn process that is load every other
--     request waits behind (see CLAUDE.md, backend concurrency).
--
-- Declarative partitioning fixes that, but sentence_lemma_links has no
-- partition key of its own, so it needs a denormalized column REGARDLESS —
-- and then also a composite PK (id, is_global), a dropped-and-rebuilt
-- sll -> sb foreign key (losing cascade-delete of links when a movie goes),
-- composite-ID surgery across the Prisma models, and a 10.7M-row / 2.3 GB
-- rewrite under ACCESS EXCLUSIVE on a live single-replica database.
--
-- This file takes the denormalized column on its own and indexes it
-- partially. Same hot/cold separation, same ~3 MB hot structure instead of a
-- 1.0 GB one, but additive and reversible: no PK change, no FK loss, no
-- Prisma churn, no rewrite.
--
-- NOT safe inside a transaction: CREATE INDEX CONCURRENTLY cannot run in one.
-- Run through psql without -1, which wraps each statement separately.
--
--   railway connect Postgres     # or: psql "$DATABASE_PUBLIC_URL"
--   \i backend/prisma/manual/2026_08_18_hot_cold_sentence_links_issue_120.sql


-- ---------------------------------------------------------------------------
-- 1. The partition key, as a column
-- ---------------------------------------------------------------------------
-- `is_global` mirrors, for the linked sentence, the exact predicate every
-- study surface applies: sentence_bank.movie_id IS NULL AND source = 'llm'.
-- PG11+ treats ADD COLUMN with a non-volatile default as metadata-only, so
-- this does not rewrite the 7.7M-row heap.
ALTER TABLE sentence_lemma_links
    ADD COLUMN IF NOT EXISTS is_global boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN sentence_lemma_links.is_global IS
    'Denormalized: sentence_bank.movie_id IS NULL AND source = ''llm'' for the '
    'linked sentence. Maintained by trigger, never by application code. '
    'Issue #120.';


-- ---------------------------------------------------------------------------
-- 2. Triggers — so the denormalization cannot drift
-- ---------------------------------------------------------------------------
-- A denormalized flag whose only guarantee is "the writers remember to set
-- it" rots silently, and the failure mode here is invisible: a word with a
-- perfectly good Haiku sentence quietly stops appearing in Explore, and the
-- worker regenerates a sentence it already has. So the database owns the
-- value and application code never sets it.
--
-- Created BEFORE the backfill so rows inserted while this file runs are
-- already correct.

CREATE OR REPLACE FUNCTION sll_set_is_global() RETURNS trigger AS $$
BEGIN
    SELECT (sb.movie_id IS NULL AND sb.source = 'llm')
      INTO NEW.is_global
      FROM sentence_bank sb
     WHERE sb.id = NEW.sentence_id;

    -- No such sentence: the FK will reject this row at end of statement
    -- anyway, but NULL would violate the NOT NULL before we get there.
    IF NEW.is_global IS NULL THEN
        NEW.is_global := false;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- `UPDATE OF ... is_global` is deliberate: it means a direct write to the
-- column is re-derived from sentence_bank rather than believed. The flag then
-- has exactly one source of truth from every direction — insert, re-point, or
-- someone hand-fixing a row in psql at 2am.
DROP TRIGGER IF EXISTS trg_sll_set_is_global ON sentence_lemma_links;
CREATE TRIGGER trg_sll_set_is_global
    BEFORE INSERT OR UPDATE OF sentence_id, is_global ON sentence_lemma_links
    FOR EACH ROW EXECUTE FUNCTION sll_set_is_global();

-- The flag also depends on two sentence_bank columns. Today nothing updates
-- them — sentence_bank is insert-only across the whole codebase (verified: no
-- .update / .upsert / UPDATE sentence_bank anywhere) — but "today nothing
-- does" is exactly the assumption that decays. Re-sync instead of relying on
-- it. Fires only if those columns are ever actually written.
CREATE OR REPLACE FUNCTION sb_resync_link_is_global() RETURNS trigger AS $$
DECLARE
    hot boolean := (NEW.movie_id IS NULL AND NEW.source = 'llm');
BEGIN
    UPDATE sentence_lemma_links
       SET is_global = hot
     WHERE sentence_id = NEW.id
       AND is_global IS DISTINCT FROM hot;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sb_resync_link_is_global ON sentence_bank;
CREATE TRIGGER trg_sb_resync_link_is_global
    AFTER UPDATE OF movie_id, source ON sentence_bank
    FOR EACH ROW EXECUTE FUNCTION sb_resync_link_is_global();


-- ---------------------------------------------------------------------------
-- 3. Backfill the existing 7.7M rows
-- ---------------------------------------------------------------------------
-- Guarded so a replay is a no-op rather than 7.7M no-op row versions.
UPDATE sentence_lemma_links sll
   SET is_global = true
  FROM sentence_bank sb
 WHERE sb.id = sll.sentence_id
   AND sb.movie_id IS NULL
   AND sb.source = 'llm'
   AND sll.is_global = false;
-- expected: ~44,142 rows


-- ---------------------------------------------------------------------------
-- 4. The hot partition, as a partial index
-- ---------------------------------------------------------------------------
-- Key order is not arbitrary — it is the study read path's ORDER BY, so the
-- DISTINCT ON in /srs/feed and get_llm_examples_for_lemmas can walk the index
-- instead of sorting:
--
--     ORDER BY lemma_id, is_representative DESC, score DESC NULLS LAST, sb.id
--
-- sentence_id IS sb.id, so it serves as the final tiebreak in-index.
-- matched_form rides along as INCLUDE so the feed's per-page lookup is
-- index-only and never touches the 1.0 GB heap at all.
--
-- CONCURRENTLY because the sentence worker is appending to this table right
-- now; a plain build would hold SHARE and stall its inserts.

-- A previous interrupted CONCURRENTLY build leaves an INVALID index behind,
-- which IF NOT EXISTS would happily skip. Clear that case first.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_index i ON i.indexrelid = c.oid
        WHERE c.relname = 'ix_sll_global_lemma' AND NOT i.indisvalid
    ) THEN
        EXECUTE 'DROP INDEX ix_sll_global_lemma';
    END IF;
END $$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_sll_global_lemma
    ON sentence_lemma_links
       (lemma_id, is_representative DESC, score DESC NULLS LAST, sentence_id)
    INCLUDE (matched_form)
    WHERE is_global;
-- expected: ~44k entries, ~3 MB (vs the 1.0 GB relation it replaces on the
-- hot path)


-- ---------------------------------------------------------------------------
-- 5. Statistics AND the visibility map
-- ---------------------------------------------------------------------------
-- VACUUM, not just ANALYZE, and it is not optional. An index-only scan still
-- visits the heap for any page the visibility map does not mark all-visible,
-- and the 44,142-row backfill above dirtied pages across the whole 534 MB
-- relation. Skipping this leaves the plan saying "Index Only Scan" while it
-- quietly does 44k heap fetches — measured 38,498 buffers / 63.9 ms before the
-- VACUUM against 6,421 buffers / 31.5 ms after, for an identical plan shape.
VACUUM (ANALYZE) sentence_lemma_links;


-- ---------------------------------------------------------------------------
-- 6. Verify
-- ---------------------------------------------------------------------------
-- Both counts must match, and the drift count must be 0.
--
--   SELECT
--     (SELECT count(*) FROM sentence_lemma_links WHERE is_global) AS flagged,
--     (SELECT count(*) FROM sentence_lemma_links sll
--        JOIN sentence_bank sb ON sb.id = sll.sentence_id
--       WHERE sb.movie_id IS NULL AND sb.source = 'llm')          AS truth,
--     pg_size_pretty(pg_relation_size('ix_sll_global_lemma'))     AS hot_size;
