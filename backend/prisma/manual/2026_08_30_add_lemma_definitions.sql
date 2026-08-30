-- Learner definitions on `lemmas` — the definition line the word cards were
-- built without.
--
-- apps/mobile/src/components/explore/WordCard.tsx has carried this comment
-- since the card shipped:
--
--     The definition line the design calls for is absent by decision: nothing
--     in the data model carries a learner gloss (`lemmas` has no definition
--     column, `words.definition` is empty) [...]
--
-- These two columns are that missing home. (`words.definition` is NOT it —
-- `words` is the vestigial pre-SRS save table from #93, keyed per surface form
-- and per movie, and empty in prod. `lemmas` is where every study surface
-- already reads from.)
--
--   definition          one short learner-facing gloss, English, ~<= 90 chars
--   definition_version  "<model>|<prompt version>" that produced it
--
-- WHY ONE DEFINITION PER LEMMA, GLOBALLY. The same cardinality the example
-- sentence already has (sentence_bank.movie_id IS NULL, one representative
-- link per lemma). A per-movie or per-sense definition table would multiply
-- generation cost by the number of movies containing the word for flavour no
-- surface asks for — the same trade llm_sentence_service.py's docstring
-- records the sentence generator already losing once.
--
-- WHY THE DEFINITION IS GENERATED FROM THE SENTENCE. The card shows a word, an
-- example sentence, and a translated gloss aligned to that sentence
-- (word_sentence_examples.word_translation, via ALIGN_SYSTEM_PROMPT). A
-- definition written from the bare headword names the most *frequent* sense,
-- which for a polysemous word is regularly not the sense the sentence uses —
-- so the card would contradict itself. The definition worker feeds the lemma's
-- own global sentence into the prompt, making the sentence the single sense
-- anchor all three fields agree on.
--
-- WHY ONE VERSION COLUMN AND NO SKIP COLUMN. Unlike #153's
-- sentence_skip_version, which only ever records refusals, this column is
-- written on every completed attempt and encodes three states:
--
--   definition_version IS NULL                        never attempted
--   definition_version set AND definition IS NOT NULL  generated
--   definition_version set AND definition IS NULL      model declined
--
-- The backlog predicate is
--
--   AND l.definition_version IS DISTINCT FROM $1
--
-- so bumping DEFINITION_PROMPT_VERSION or pointing at another model re-admits
-- every lemma — both the generated ones and the refused ones — with no
-- revocation job. IS DISTINCT FROM, never <>: `NULL <> 'x'` is NULL, so `<>`
-- would filter out every never-attempted lemma and the worker would start life
-- permanently idle (#153 hit exactly this).
--
-- DELIBERATELY NO INDEX, for the same reason #153 declined one. The backlog
-- query already walks ix_lemmas_priority_score backwards and applies this as a
-- row filter; an index on a column that is UPDATEd once per lemma buys ~40 ms
-- per 900 s cycle at the cost of write amplification on a hot table.
--
-- Additive, so the normal ordering applies (prisma/manual/README.md rule 3):
-- run this BEFORE merging the code. The deployed Prisma client does not select
-- columns it has not been regenerated for.
--
--   railway connect Postgres        # or: psql "$DATABASE_PUBLIC_URL"
--   \i backend/prisma/manual/2026_08_30_add_lemma_definitions.sql
--
-- Idempotent: both statements are IF NOT EXISTS, and neither carries a
-- DEFAULT, so on PostgreSQL 11+ each is a catalog-only change — no table
-- rewrite, no lock held while 42,668 rows are touched.

ALTER TABLE lemmas
    ADD COLUMN IF NOT EXISTS definition text;

ALTER TABLE lemmas
    ADD COLUMN IF NOT EXISTS definition_version varchar(96);

COMMENT ON COLUMN lemmas.definition IS
    'One-line English learner gloss shown under the word on the Explore card '
    'and the movie-detail deck. Generated from this lemma''s own global LLM '
    'example sentence so it describes the sense that sentence uses. NULL with '
    'definition_version set means the model was asked and declined.';

COMMENT ON COLUMN lemmas.definition_version IS
    '"<model>|<prompt version>" that produced (or declined) this definition. '
    'The definition worker skips a lemma only while this equals its own '
    'running signature, so a model or prompt change re-admits it automatically.';
