-- Delete stranded global LLM sentences (orphans).
--
-- An orphan is a `sentence_bank` row with no `sentence_lemma_links` row. Every
-- study surface reaches a sentence through its lemma link, so an orphan is LLM
-- output that has been paid for and can never be shown to anybody. They are
-- what turned `orphan_sentences` FAIL on /admin/health/vocab-coverage.
--
-- ⚠ DESTRUCTIVE. Read the scoping note below before running it, and run
-- section 1 first — it only counts.
--
-- STATUS 2026-09-05: section 2 APPLIED to prod. 4,424 global LLM orphans
-- deleted; 2,984,633 linked sentences intact afterwards and 0 dangling links.
-- Every deleted row is in `orphan_sentence_cleanup_20260905` (see section 0),
-- so this is reversible. The 58,670 movie-tied orphans are still there — see
-- the findings at the bottom.
--
--
-- IS IT SAFE TO DELETE THESE?
-- ---------------------------
-- Nothing reads one. Verified across the backend 2026-09-05:
--
--   * every read joins through sentence_lemma_links —
--     routes/srs.py:1917, workers/definition_worker.py:162,
--     services/sentence_bank_service.py:184 and :537;
--   * `word_sentence_examples` (the reveal cache) stores the sentence TEXT,
--     not a foreign key, so a deleted row cannot dangle it;
--   * `sentence_lemma_links.sentence_id` is ON DELETE CASCADE, and an orphan
--     has no links by definition, so nothing cascades either.
--
--
-- WHY ONLY `movie_id IS NULL AND source = 'llm'`
-- ----------------------------------------------
-- Because the movie-tied ones are not safe to delete on a live system, for two
-- separate reasons.
--
-- 1. THE SUBTITLE PATH MAKES ORPHANS ON PURPOSE, BRIEFLY.
--    `services/sentence_bank_service.populate_sentence_bank` writes every
--    sentence for a film in one loop and links them in a *second* loop, with
--    no transaction around the pair. Between those loops every row it has
--    written is an orphan. Deleting during an ingestion would therefore
--    silently destroy real sentences that were about to be linked — and the
--    film worker ingests continuously.
--
-- 2. A FILM'S ROWS GATE ITS OWN RE-POPULATION.
--    `populate_movie_sentence_bank` skips a film when *any* sentence_bank row
--    exists for it (`skip_if_exists`). Deleting every row for a film that has
--    only orphans flips that guard and the film is re-populated. That is
--    re-work rather than damage — population is idempotent — but it is
--    surprising, and it is avoided entirely by not touching those rows.
--
-- The global LLM rows have neither problem. Since 2026-09-05 every writer goes
-- through `sentence_bank_service.persist_sentence_with_links`, which puts the
-- sentence and its links in one transaction, so a global row is never visible
-- un-linked to another session: an uncommitted transaction's rows are
-- invisible under READ COMMITTED, and once it commits both rows are there.
-- That is what makes this delete race-free, and it is why it had to wait for
-- that fix — running it a day earlier could have deleted a sentence the worker
-- was about to link.
--
-- No need to pause the workers for this one, for the same reason. (Deleting
-- movie-tied rows WOULD need the film worker stopped first, which is the other
-- reason they are out of scope.)
--
--
-- WHY NOT JUST LEAVE THEM
-- -----------------------
-- They do not self-heal. The lemma stays in the backlog because it still has
-- no link, so it is retried — but the retry asks the model for a *new*
-- sentence, which hashes differently and becomes a *new* row. The old one is
-- stranded for good. And while any are present, `orphan_sentences` sits at
-- WARN or FAIL permanently, so the metric stops being a signal about today.


-- 0. UNDO TABLE. Run before section 2 — same precedent as
--    backfill_119_unknown_snapshot (#119). A delete you cannot reverse is a
--    different risk from one you can, and 63k short rows cost nothing to keep.
--
--    To reverse: INSERT INTO sentence_bank SELECT (its columns minus
--    captured_at) FROM orphan_sentence_cleanup_20260905 — though the ids will
--    be new, so the links would have to be rebuilt too. It is a safety net for
--    the TEXT, not a transactional undo.
CREATE TABLE IF NOT EXISTS orphan_sentence_cleanup_20260905 AS
SELECT sb.*, now() AS captured_at
  FROM sentence_bank sb
 WHERE NOT EXISTS (SELECT 1 FROM sentence_lemma_links sll WHERE sll.sentence_id = sb.id);


-- 1. COUNT FIRST. Run this on its own and read it before running section 2.
--    The split matters: only the first row is in scope.
--
--    ⚠ Run `SET max_parallel_workers_per_gather = 0;` on the session first.
--    Without it this dies with "could not resize shared memory segment ... No
--    space left on device": the planner parallelises the scan of a 3M-row
--    table and the helpers want a 16 MB segment out of Railway's small
--    /dev/shm. Same failure, same fix, as the daily coverage snapshot (#154).
SELECT
    CASE
        WHEN movie_id IS NULL AND source = 'llm' THEN 'global llm  (in scope)'
        WHEN movie_id IS NULL                    THEN 'global other (LEAVE)'
        ELSE                                          'movie-tied   (LEAVE)'
    END                              AS bucket,
    count(*)                         AS orphans,
    min(created_at)                  AS oldest,
    max(created_at)                  AS newest
FROM sentence_bank sb
WHERE NOT EXISTS (
    SELECT 1 FROM sentence_lemma_links sll WHERE sll.sentence_id = sb.id
)
GROUP BY 1
ORDER BY 1;


-- 2. THE DELETE. Scoped to global LLM orphans only.
--
--    ⚠ Run this statement ON ITS OWN, deliberately — do not `psql -f` this
--    file. There is no BEGIN wrapping it on purpose: psql COMMITS an open
--    transaction block when it exits normally, so a `BEGIN` with a
--    commented-out `COMMIT` reads like a safety net and is not one. Section 1
--    is the dry run; this is the commit.
--
--    RETURNING gives the count back, so compare it against section 1's
--    "global llm (in scope)" row before you walk away.
WITH gone AS (
    DELETE FROM sentence_bank sb
     WHERE sb.movie_id IS NULL
       AND sb.source = 'llm'
       AND NOT EXISTS (
           SELECT 1 FROM sentence_lemma_links sll WHERE sll.sentence_id = sb.id
       )
    RETURNING sb.id
)
SELECT count(*) AS deleted FROM gone;


-- 2b. THE MOVIE-TIED ORPHANS — measured 2026-09-05, NOT deleted.
--
--     58,670 of them, created 2026-05-23 to 2026-07-24 and static since. Both
--     of the objections above were measured and neither survived contact:
--
--       * the race is gone. Since the atomic write shipped today, no writer
--         can leave a sentence unlinked even transiently, and every one of
--         these predates it by six weeks;
--       * exactly TWO films out of 4,146 with orphans would lose every
--         sentence row they have (484 rows between them), which is what would
--         flip skip_if_exists. Re-ingesting two films is idempotent and those
--         two evidently have nothing usable anyway.
--
--     They are left in place only because this file said it would leave them
--     and 58,670 rows is not a scope to widen silently. The delete is section
--     2 with `movie_id IS NULL AND source = 'llm'` swapped for
--     `movie_id IS NOT NULL`, and the undo table already holds them.
--
--
-- 3. AFTERWARDS
--    `orphan_sentences` is classified by _status_no_increase: it FAILs on a
--    rise, WARNs on any non-zero, and is OK at zero. A fall is never a
--    failure, so this cannot make the report worse. The number the dashboard
--    shows will not move until the sentence worker writes its next daily
--    snapshot, or until you press ↻ on the Vocab coverage screen, which
--    forces a live recount.
--
--    Movie-tied orphans are left behind on purpose and will keep the metric at
--    WARN. That is honest: the subtitle path still has both of the bugs the
--    LLM path just lost — a non-atomic two-loop write, and a link insert whose
--    `except Exception: pass` hides a genuine failure. Fixing that is the
--    follow-up; deleting its output first would only refill.
