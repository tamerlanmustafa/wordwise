-- Bring a stale LOCAL dev database up to prod's index and constraint state.
--
-- WHY
-- ---
-- Schema changes here go through hand-written SQL in this folder, applied to
-- prod by hand (see the README and CLAUDE.md). Nothing tracks whether the same
-- file was ever applied to a developer's local database, and in practice it
-- often was not — so local drifts behind prod silently, one migration at a
-- time.
--
-- Measured 2026-09-10, prod vs local:
--
--   * every table in the Prisma schema existed in both, so the drift is not
--     missing TABLES — it is missing INDEXES, and one of them is a UNIQUE
--     index the application code names directly.
--   * `translation_passthroughs` had no `unique_translation_passthrough`
--     locally, so `TranslationService._record_passthroughs` — which runs
--     `ON CONFLICT (source_text, target_lang, provider) DO UPDATE` — raises
--     `InvalidColumnReference: there is no unique or exclusion constraint
--     matching the ON CONFLICT specification` on every call. That code path is
--     simply broken on a local DB, and passes CI, and works in prod.
--
-- That is the failure mode worth naming: a missing *performance* index makes
-- local slow, which you notice; a missing *unique* index makes local wrong,
-- which you do not, because the query only fails on the branch you were not
-- testing.
--
-- WHAT THIS IS NOT
-- ----------------
-- Not a replacement for the individual migration files — each of the indexes
-- below already has one, listed against it. This is a single idempotent
-- catch-up so a developer with an old database can reach prod's state in one
-- command instead of replaying twenty-nine files and guessing which of them
-- also carried a data migration they do not want to re-run.
--
-- SAFE TO RE-RUN. Every statement is IF NOT EXISTS, nothing is dropped, and no
-- row is written. Applying it to prod is a no-op, because prod already has all
-- of these — that is the definition it was built from.
--
-- USAGE
-- -----
--   psql "$DATABASE_URL" -f backend/prisma/manual/2026_09_10_local_index_catchup.sql
--
-- A UNIQUE index will fail rather than apply if the local table already holds
-- duplicate rows. That is the correct outcome: it means local data violates a
-- rule prod enforces, and the duplicates need looking at rather than the index
-- being skipped.

-- from 2026_08_18_hidden_words_lower_index_issue_121.sql
CREATE INDEX IF NOT EXISTS ix_hidden_words_word_lower
  ON public.hidden_words USING btree (lower((word)::text));

-- from 2026_08_20_converge_movie_cefr_issue_103.sql
CREATE INDEX IF NOT EXISTS ix_movies_difficulty_score
  ON public.movies USING btree (difficulty_score);

-- from 2026_07_21_drop_v2_sense_tables.sql — the plain lemma_id index that
-- replaced the (lemma_id, sense_id) one when the V2 sense tables went away.
CREATE INDEX IF NOT EXISTS ix_sentence_lemma_link_lemma_id
  ON public.sentence_lemma_links USING btree (lemma_id);

-- issue #120. The covering partial index behind the hot/cold sentence split;
-- without it every global-sentence lookup falls back to a scan.
CREATE INDEX IF NOT EXISTS ix_sll_global_lemma
  ON public.sentence_lemma_links
  USING btree (lemma_id, is_representative DESC, score DESC NULLS LAST, sentence_id)
  INCLUDE (matched_form)
  WHERE is_global;

-- Prisma-generated, from the StudentVerification model's @@unique.
CREATE UNIQUE INDEX IF NOT EXISTS student_verifications_user_id_method_key
  ON public.student_verifications USING btree (user_id, method);

-- from 2026_08_20_translation_cache_provider_issue_124.sql
CREATE INDEX IF NOT EXISTS ix_translation_cache_provider_lang
  ON public.translation_cache USING btree (target_lang, provider)
  WHERE ((provider)::text IS DISTINCT FROM 'deepl'::text);

-- from 2026_08_30_add_translation_passthroughs.sql. The UNIQUE one is the
-- ON CONFLICT target described at the top of this file — the reason this
-- catch-up exists at all.
CREATE UNIQUE INDEX IF NOT EXISTS unique_translation_passthrough
  ON public.translation_passthroughs USING btree (source_text, target_lang, provider);
CREATE INDEX IF NOT EXISTS ix_translation_passthroughs_target_lang
  ON public.translation_passthroughs USING btree (target_lang);

-- from 2026_08_26_add_user_survey_responses_issue_108.sql. Also an upsert
-- target: one answer per question per survey version per user.
CREATE UNIQUE INDEX IF NOT EXISTS user_survey_responses_answer_key
  ON public.user_survey_responses
  USING btree (user_id, survey_key, survey_version, question_key);

-- from 2026_07_23_schema_audit_issue_93.sql. Partial, because a word saved
-- against a film is a different row from the same word saved globally.
CREATE UNIQUE INDEX IF NOT EXISTS user_words_global_word_unique
  ON public.user_words USING btree (user_id, word)
  WHERE (movie_id IS NULL);

-- from 2026_07_21_add_vocab_coverage_snapshots.sql
CREATE INDEX IF NOT EXISTS ix_vocab_coverage_snapshots_captured_at
  ON public.vocab_coverage_snapshots USING btree (captured_at DESC);

-- from 2026_09_11_practice_sessions.sql. The week strip reads the first of
-- these on every /daily/state, so it is not optional.
CREATE INDEX IF NOT EXISTS ix_practice_sessions_user_day
  ON public.practice_sessions (user_id, local_date)
  WHERE completed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_practice_sessions_user_started
  ON public.practice_sessions (user_id, started_at DESC);
