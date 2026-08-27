/**
 * Welcome-survey catalogue + state machine (issue #108).
 *
 * The one moment a first-run user expects to answer questions is onboarding,
 * and this is the only thing WordWise asks rather than infers: what they find
 * hard about vocabulary, how subtitles feel, how often they get frustrated,
 * and why they're here. Everything else about a learner is derived from
 * behaviour (SRS outcomes, quiz latency, word taps).
 *
 * ## The keys are a contract with the backend
 *
 * The answers are stored as enums so a research dataset can never accumulate
 * free text, which means these exact strings have to exist on the server too —
 * `backend/src/services/survey_definitions.json`. That file is the source of
 * truth for validation, and `__tests__/survey.test.ts` reads it off disk and
 * fails if this catalogue drifts from it. The drift is otherwise silent: an
 * option added here alone makes the server 422 the whole submission, and the
 * caller posts fire-and-forget, so the answers would just stop arriving with
 * nothing anywhere reporting it. Adding or renaming an option means editing
 * both files and bumping `WELCOME_SURVEY_VERSION`.
 *
 * ## Why the state lives here and not in the component
 *
 * `OnboardingFlow` renders one question at a time (same shape as the placement
 * quiz), so "answer", "go back" and "skip" are branch logic, not layout. Mobile
 * tests never render components (CLAUDE.md), so the branching is pure functions
 * over a plain `SurveyProgress` value and the component only holds it in state.
 */

/** Survey identifier — the `{survey_key}` path segment on the backend. */
export const WELCOME_SURVEY_KEY = 'welcome';

/**
 * Which questionnaire this build renders. Submitted with the answers and stored
 * on the row, so re-wording or re-optioning the survey is a version bump rather
 * than a silent merge of two different questions into one distribution.
 */
export const WELCOME_SURVEY_VERSION = 1;

/**
 * Recorded for any question the user didn't answer. A `skipped` row and *no*
 * row mean different things — declined versus never shown — and the analysis
 * needs to tell them apart, so a skip still writes.
 */
export const SKIPPED_ANSWER = 'skipped';

export interface SurveyQuestion {
  /** Stable key stored in `question_key`. Never a display string. */
  readonly key: string;
  /** Stable option keys stored in `answer_key`, in the order they render. */
  readonly answers: readonly string[];
}

/**
 * Four questions, which is the ceiling #108 sets: completion rate falls off as
 * a welcome survey grows, and the rest is meant to be gathered later via
 * in-app pulses rather than all at once here.
 *
 * `motivation` is deliberately *not* the existing `GoalStep` — that one asks
 * for a daily minutes target, this one asks why the user is learning at all.
 */
export const WELCOME_SURVEY_QUESTIONS: readonly SurveyQuestion[] = [
  {
    key: 'vocab_pain',
    answers: ['remembering', 'context', 'pronunciation', 'which_words', 'consistency'],
  },
  {
    key: 'subtitle_pain',
    answers: ['too_fast', 'constant_pausing', 'fine_want_vocab', 'not_yet'],
  },
  {
    key: 'frustration',
    answers: ['every_session', 'sometimes', 'rarely', 'never'],
  },
  {
    key: 'motivation',
    answers: ['travel', 'career', 'films_tv', 'exam', 'people', 'fun'],
  },
];

/** `question_key` → `answer_key`, for the questions answered so far. */
export type SurveyAnswers = Readonly<Record<string, string>>;

/** One row of the submitted payload. Snake_case — this crosses the wire. */
export interface SurveyResponse {
  question_key: string;
  answer_key: string;
}

export interface SurveyProgress {
  /** Index of the question currently on screen. */
  readonly index: number;
  readonly answers: SurveyAnswers;
}

export const INITIAL_SURVEY_PROGRESS: SurveyProgress = { index: 0, answers: {} };

/**
 * Every question gets a row, whether or not the user answered it — unanswered
 * ones as `skipped`. That is what makes "shown and declined" visible in the
 * data at all; posting only the answered ones would make a full skip
 * indistinguishable from a user who never reached the survey.
 */
export function buildSurveyResponses(answers: SurveyAnswers): SurveyResponse[] {
  return WELCOME_SURVEY_QUESTIONS.map((q) => ({
    question_key: q.key,
    answer_key: answers[q.key] ?? SKIPPED_ANSWER,
  }));
}

export interface SurveyAdvance extends SurveyProgress {
  /** True once the last question is answered — the flow moves on and submits. */
  readonly done: boolean;
}

/** Record an answer and move to the next question. */
export function answerSurveyQuestion(progress: SurveyProgress, answerKey: string): SurveyAdvance {
  const question = WELCOME_SURVEY_QUESTIONS[progress.index];
  // Defensive: an index past the end can only mean a caller bug, and silently
  // writing `undefined` as a question_key would fail validation server-side
  // and lose the whole submission rather than this one answer.
  if (!question) return { ...progress, done: true };

  const answers = { ...progress.answers, [question.key]: answerKey };
  const index = progress.index + 1;
  return { index, answers, done: index >= WELCOME_SURVEY_QUESTIONS.length };
}

export interface SurveyRetreat extends SurveyProgress {
  /** True when back was pressed on the first question — leave the survey. */
  readonly exited: boolean;
}

/**
 * Step back one question, discarding that question's answer so re-answering
 * replaces it rather than leaving the first choice stored.
 */
export function unanswerSurveyQuestion(progress: SurveyProgress): SurveyRetreat {
  if (progress.index <= 0) return { ...progress, exited: true };

  const index = progress.index - 1;
  const answers = { ...progress.answers };
  delete answers[WELCOME_SURVEY_QUESTIONS[index].key];
  return { index, answers, exited: false };
}
