-- Issue #153 — the sentence worker forgets every LLM refusal on restart.
--
-- src/workers/sentence_worker.py kept its refusal list in a process-local
-- `Set[int]` that starts empty at boot. Railway redeploys the Worker service
-- on every push to main, so several times a day the worker re-sent the same
-- residue of slurs, non-words and proper nouns to Haiku and re-bought the same
-- refusals. Measured on prod 2026-08-23: the residue is 2,072 lemmas, and the
-- 11:16Z deploy's first cycle logged `fetched=150 stored=0 skip=150` — a fresh
-- process starting the re-buy from the top of the backlog again.
--
-- A refusal is a durable fact about the word, so it belongs on the word.
-- These two columns are where it goes.
--
--   sentence_skip_at        when the model declined it (forensics only — the
--                           backlog query does not read it)
--   sentence_skip_version   "<model>|<prompt version>" of whatever declined it
--
-- Why a version string and not a boolean: a bare flag bans a word forever on
-- the strength of one bad day. The backlog predicate is
--
--   AND l.sentence_skip_version IS DISTINCT FROM $1
--
-- so pointing at a different model or bumping SENTENCE_PROMPT_VERSION
-- re-admits every lemma refused by the previous one automatically. There is no
-- revocation job to remember to run. IS DISTINCT FROM, not <>, because
-- `NULL <> 'x'` is NULL — with `<>` every never-refused lemma would be
-- filtered out and the worker would go permanently idle.
--
-- Deliberately NO index. Measured on prod 2026-08-23 with the residue's 2,072
-- ids inlined the old way (the worst case this change produces, once every
-- refusal is on the row):
--
--   fresh process, nothing skipped   24.8 ms   9,554 buffers   150 rows
--   whole residue skipped            46.6 ms  19,047 buffers     0 rows
--
-- The second is a full backward walk of ix_lemmas_priority_score — all 42,634
-- lemmas — and it costs 47 ms once per 900 s idle cycle. An index to save that
-- is 30 MB of write amplification on a table the enrichment path updates; #136
-- declined a similar trade on smaller evidence.
--
-- Additive, so the normal ordering applies (prisma/manual/README.md rule 3):
-- run this BEFORE merging the code. The deployed Prisma client simply does not
-- select columns it has not been regenerated for.
--
--   railway connect Postgres        # or: psql "$DATABASE_PUBLIC_URL"
--   \i backend/prisma/manual/2026_08_23_persist_sentence_refusals_issue_153.sql
--
-- Idempotent: both statements are IF NOT EXISTS, and neither carries a DEFAULT,
-- so on PostgreSQL 11+ each is a catalog-only change — no table rewrite, no
-- lock held while 42,634 rows are touched.

ALTER TABLE lemmas
    ADD COLUMN IF NOT EXISTS sentence_skip_at timestamptz;

ALTER TABLE lemmas
    ADD COLUMN IF NOT EXISTS sentence_skip_version varchar(96);

COMMENT ON COLUMN lemmas.sentence_skip_at IS
    'Issue #153: when the LLM declined to write an example sentence for this '
    'lemma. Set only when the API call completed; a failed call is not a fact '
    'about the word.';

COMMENT ON COLUMN lemmas.sentence_skip_version IS
    'Issue #153: "<model>|<prompt version>" that declined this lemma. The '
    'sentence worker excludes a lemma only while this equals its own running '
    'signature, so a model or prompt change re-admits it automatically.';
