-- Two worker fixes: a definition can fail without being marked done, and the
-- movie seed walk remembers where it got to.
--
-- schema.prisma is the source of truth; this file exists because the
-- migrations history has pre-existing drift, so `migrate dev` / `db push`
-- both demand a destructive reset.
--
-- ⚠ Run this against PROD BEFORE the matching code lands.
-- Idempotent: safe to run more than once.
--
--
-- 1. lemmas.definition_skip_version
--
-- Measured 2026-09-05: 2,330 of 27,113 cardable lemmas (8.6%) show a blank
-- gloss line on the Explore card. The cause is that `definition_version`
-- records two different facts with one value:
--
--     definition written  → version stamped
--     model said nothing  → version stamped, definition left NULL
--
-- and the backlog only asks `definition_version IS DISTINCT FROM $1`. So a
-- failure is indistinguishable from a success and is never retried, and the
-- only way to retry one was to bump the version — which re-queues all 29,610
-- lemmas including the 27,150 that already have a good definition, and pays
-- for every one of them again.
--
-- Splitting the two apart is what makes a retry cheap enough to be safe:
-- success keeps `definition_version`, refusal gets `definition_skip_version`,
-- and the backlog wants a lemma with no definition that the running model has
-- not already declined.
--
-- The 2,460 rows that were stamped-but-empty are un-stamped below so they go
-- round once more under the new scheme. That is a bounded, one-time cost:
-- ~2.5k lemmas at 15 per call is ~165 Haiku calls. Whatever the model
-- genuinely declines then gets `definition_skip_version` and is never bought
-- again.
--
--
-- 2. seed_cursor
--
-- The movie seed walks TMDB's /discover pages and kept its place in
-- `backend/.seed_cursor.json` — a file inside the container, on a service
-- with no volume. Every deploy reset the walk to page 1, whose films are all
-- long since queued, so the insert deduped to nothing: prod logs
-- "auto-seeded 0 new jobs" on every restart and the catalogue has not grown.
-- A cursor that has to survive a restart belongs in the database.

ALTER TABLE lemmas
    ADD COLUMN IF NOT EXISTS definition_skip_version VARCHAR NULL;

COMMENT ON COLUMN lemmas.definition_skip_version IS
    'Model+prompt signature that DECLINED to define this lemma. Kept apart '
    'from definition_version (which records a success) so a failure can be '
    'retried without re-buying every definition that already worked.';

-- Hand the stamped-but-empty rows back to the worker. NOT a blanket version
-- bump: rows that actually have a definition keep theirs and are not re-bought.
UPDATE lemmas
   SET definition_version = NULL
 WHERE definition_version IS NOT NULL
   AND (definition IS NULL OR definition = '');

CREATE TABLE IF NOT EXISTS seed_cursor (
    -- One row per (endpoint, filter) walk, e.g. 'discover_en_vote_count_desc_gte1000'.
    key        VARCHAR PRIMARY KEY,
    next_page  INTEGER     NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE seed_cursor IS
    'Where each TMDB discover walk got to. Was a file in the container, so '
    'every deploy restarted the walk at page 1 and seeded nothing.';
