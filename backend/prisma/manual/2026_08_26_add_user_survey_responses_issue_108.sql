-- Issue #108 — the onboarding welcome survey needs somewhere to put answers.
--
-- WordWise infers everything else about a learner from behaviour: SRS
-- outcomes, quiz latency, which words get tapped. Nothing in the schema
-- records what the user *says* — why they are here, what they find hard. This
-- table is the first self-reported signal (LEARNING_DATA_PLAN.md §3.4), and it
-- exists to be joined against those behavioural cohorts later.
--
-- Shape: one row per (user, survey, version, question). Long, not wide.
--
--   A column-per-question table would need an ALTER for every question added
--   and would have no place to put the version, so the answers to "v1 Q3" and
--   "v2 Q3" would land in the same column and quietly merge into one
--   meaningless distribution. Rows keyed by question_key + survey_version make
--   an evolving questionnaire an append, and make every analysis a GROUP BY.
--
-- Enums, never free text. `answer_key` is validated against
-- src/services/survey_definitions.json before insert, so this table cannot
-- accumulate a name, an email or anything else a free-text box invites — the
-- first thing §5's anonymisation pipeline would otherwise have to strip out of
-- a research dataset.
--
-- Three states are distinguishable, which is the point of storing a skip:
--
--   no rows for the user      the survey was never shown (old install,
--                             onboarding abandoned before it)
--   answer_key = 'skipped'    shown and declined — itself a signal
--   anything else             a real answer
--
-- The unique index is load-bearing, not hygiene. The client posts
-- fire-and-forget from the onboarding screen, so a flaky network or a reinstall
-- that reruns onboarding re-posts the same answers. `ON CONFLICT DO NOTHING`
-- against this index makes the retry a no-op, so `GROUP BY answer_key` counts
-- users rather than attempts. First answer wins: what someone told us the first
-- time is the cleaner research fact than whatever they picked on a re-run.
--
-- Deliberately no second index. The reads are analytical (GROUP BY
-- question_key, answer_key) over a table with at most one row per user per
-- question — a few rows per account. A covering index for those would cost
-- more in writes than the scan it saves, and the whole relation fits in cache
-- for a long time yet.
--
-- ON DELETE CASCADE matters for compliance, not tidiness: DELETE /auth/me
-- (App Store 5.1.1(v), Play data-deletion) deletes the users row and relies on
-- every user-owned relation cascading. A survey table without it would leave
-- self-reported personal data behind after an account deletion.
--
-- Additive — a brand-new table nothing selects yet — so the normal ordering
-- applies (prisma/manual/README.md rule 3): run this BEFORE merging the code.
-- The API selects this table the moment the new build deploys.
--
--   railway connect Postgres        # or: psql "$DATABASE_PUBLIC_URL"
--   \i backend/prisma/manual/2026_08_26_add_user_survey_responses_issue_108.sql
--
-- Idempotent: every statement is IF NOT EXISTS, so it can be replayed.

CREATE TABLE IF NOT EXISTS user_survey_responses (
    id             serial       PRIMARY KEY,
    user_id        integer      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    survey_key     varchar(40)  NOT NULL,
    survey_version integer      NOT NULL,
    question_key   varchar(40)  NOT NULL,
    answer_key     varchar(40)  NOT NULL,
    answered_at    timestamptz  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_survey_responses_answer_key
    ON user_survey_responses (user_id, survey_key, survey_version, question_key);

COMMENT ON TABLE user_survey_responses IS
    'Issue #108: self-reported survey answers, one row per user per question '
    'per survey version. Answer keys are enums validated against '
    'src/services/survey_definitions.json — never free text.';

COMMENT ON COLUMN user_survey_responses.survey_version IS
    'Issue #108: which version of the questionnaire the client was rendering. '
    'Client-supplied and validated, not stamped server-side, so an old build '
    'still answering v1 after v2 ships is labelled v1 rather than mislabelled.';

COMMENT ON COLUMN user_survey_responses.answer_key IS
    'Issue #108: the chosen option, or the literal ''skipped''. Absence of a '
    'row means the question was never shown, which is a different fact.';
