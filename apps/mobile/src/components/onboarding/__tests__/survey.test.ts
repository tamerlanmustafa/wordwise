/**
 * Welcome-survey catalogue, state machine and submit path (issue #108).
 *
 * The first block is the one that matters most and is the least obvious: the
 * answer keys are a contract with a *Python* service, and nothing at build time
 * checks a TypeScript constant against a backend validator. So this reads the
 * backend's own definition file off disk and compares. Same technique as
 * `components/__tests__/legalCopy.test.ts`, and for the same reason — the
 * failure it guards is silent. A stray option here doesn't crash anything: the
 * server 422s the submission, `surveyApi.submit` swallows it by design, and the
 * answers simply stop arriving with nobody watching.
 */

import fs from 'fs';
import path from 'path';

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  answerSurveyQuestion,
  buildSurveyResponses,
  INITIAL_SURVEY_PROGRESS,
  SKIPPED_ANSWER,
  unanswerSurveyQuestion,
  WELCOME_SURVEY_KEY,
  WELCOME_SURVEY_QUESTIONS,
  WELCOME_SURVEY_VERSION,
} from '../survey';
import { surveyApi, API_BASE_URL } from '../../../services/api';

const REPO = path.join(__dirname, '..', '..', '..', '..', '..', '..');
const DEFINITIONS = path.join(REPO, 'backend', 'src', 'services', 'survey_definitions.json');

type BackendCatalogue = Record<string, Record<string, Record<string, string[]>>>;

function backendCatalogue(): BackendCatalogue {
  return JSON.parse(fs.readFileSync(DEFINITIONS, 'utf8'));
}

describe('the answer keys the backend will accept', () => {
  it('defines the welcome survey at the version this build submits', () => {
    const versions = backendCatalogue()[WELCOME_SURVEY_KEY];
    expect(versions).toBeDefined();
    expect(Object.keys(versions)).toContain(String(WELCOME_SURVEY_VERSION));
  });

  it('matches this catalogue question for question, option for option', () => {
    const backend = backendCatalogue()[WELCOME_SURVEY_KEY][String(WELCOME_SURVEY_VERSION)];

    const mine = Object.fromEntries(
      WELCOME_SURVEY_QUESTIONS.map((q) => [q.key, [...q.answers]]),
    );

    // Compared as whole objects so a rename shows both sides in the diff.
    expect(mine).toEqual(backend);
  });

  it('never sends an option the server has not been told about', () => {
    const backend = backendCatalogue()[WELCOME_SURVEY_KEY][String(WELCOME_SURVEY_VERSION)];
    const responses = buildSurveyResponses(
      Object.fromEntries(WELCOME_SURVEY_QUESTIONS.map((q) => [q.key, q.answers[0]])),
    );

    for (const r of responses) {
      expect(backend[r.question_key]).toContain(r.answer_key);
    }
  });

  it('has a "skipped" sentinel that collides with no real option', () => {
    for (const q of WELCOME_SURVEY_QUESTIONS) {
      expect(q.answers).not.toContain(SKIPPED_ANSWER);
    }
  });
});

describe('catalogue shape', () => {
  it('asks at most four questions', () => {
    // #108's ceiling: completion rate falls off as the survey grows.
    expect(WELCOME_SURVEY_QUESTIONS.length).toBeLessThanOrEqual(4);
  });

  it('gives every question at least two options and no duplicates', () => {
    for (const q of WELCOME_SURVEY_QUESTIONS) {
      expect(q.answers.length).toBeGreaterThanOrEqual(2);
      expect(new Set(q.answers).size).toBe(q.answers.length);
    }
  });

  it('keys every question and option as a stable machine token, never display copy', () => {
    const token = /^[a-z][a-z0-9_]*$/;
    for (const q of WELCOME_SURVEY_QUESTIONS) {
      expect(q.key).toMatch(token);
      for (const a of q.answers) expect(a).toMatch(token);
    }
  });

  it('has translated copy for every question and option in every locale', () => {
    // locales.test.ts already enforces key parity against `en`, but only for
    // keys `en` has. This is the other half: that the catalogue and the copy
    // agree, so adding an option without its string fails here rather than
    // rendering the raw key on someone's phone.
    const localesDir = path.join(REPO, 'apps', 'mobile', 'src', 'i18n', 'locales');
    const missing: string[] = [];

    for (const locale of fs.readdirSync(localesDir)) {
      const ns = JSON.parse(
        fs.readFileSync(path.join(localesDir, locale, 'onboarding.json'), 'utf8'),
      );
      const step = ns.surveyStep ?? {};
      for (const key of ['eyebrow', 'sub', 'skip']) {
        if (!step[key]) missing.push(`${locale}: surveyStep.${key}`);
      }
      for (const q of WELCOME_SURVEY_QUESTIONS) {
        const copy = step.question?.[q.key];
        if (!copy?.title) missing.push(`${locale}: ${q.key}.title`);
        for (const a of q.answers) {
          if (!copy?.option?.[a]) missing.push(`${locale}: ${q.key}.option.${a}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});

describe('the payload', () => {
  it('records a row for every question, using "skipped" for the unanswered', () => {
    expect(buildSurveyResponses({ frustration: 'rarely' })).toEqual([
      { question_key: 'vocab_pain', answer_key: SKIPPED_ANSWER },
      { question_key: 'subtitle_pain', answer_key: SKIPPED_ANSWER },
      { question_key: 'frustration', answer_key: 'rarely' },
      { question_key: 'motivation', answer_key: SKIPPED_ANSWER },
    ]);
  });

  it('turns a survey nobody answered into an explicit all-skipped submission', () => {
    // "Declined" and "never shown" must stay different facts in the data: a
    // skip still posts, so absence of rows means the survey was never reached.
    const responses = buildSurveyResponses({});
    expect(responses).toHaveLength(WELCOME_SURVEY_QUESTIONS.length);
    expect(responses.every((r) => r.answer_key === SKIPPED_ANSWER)).toBe(true);
  });
});

describe('the state machine', () => {
  it('advances one question per answer and reports done on the last', () => {
    let progress = INITIAL_SURVEY_PROGRESS;
    const picks = WELCOME_SURVEY_QUESTIONS.map((q) => q.answers[1]);

    for (let i = 0; i < picks.length; i++) {
      const next = answerSurveyQuestion(progress, picks[i]);
      expect(next.index).toBe(i + 1);
      expect(next.done).toBe(i === picks.length - 1);
      progress = { index: next.index, answers: next.answers };
    }

    expect(buildSurveyResponses(progress.answers).map((r) => r.answer_key)).toEqual(picks);
  });

  it('does not mutate the progress it was handed', () => {
    const before = { index: 0, answers: {} };
    answerSurveyQuestion(before, 'context');
    expect(before).toEqual({ index: 0, answers: {} });
  });

  it('drops the previous answer on back, so re-answering replaces it', () => {
    const first = answerSurveyQuestion(INITIAL_SURVEY_PROGRESS, 'remembering');
    const back = unanswerSurveyQuestion({ index: first.index, answers: first.answers });

    expect(back.exited).toBe(false);
    expect(back.index).toBe(0);
    expect(back.answers).toEqual({});

    const redone = answerSurveyQuestion(back, 'consistency');
    expect(redone.answers).toEqual({ vocab_pain: 'consistency' });
  });

  it('reports exited when back is pressed on the first question', () => {
    expect(unanswerSurveyQuestion(INITIAL_SURVEY_PROGRESS).exited).toBe(true);
  });

  it('cannot run off the end of the catalogue', () => {
    const past = { index: WELCOME_SURVEY_QUESTIONS.length, answers: {} };
    const next = answerSurveyQuestion(past, 'whatever');
    expect(next.done).toBe(true);
    expect(next.answers).toEqual({});
  });
});

describe('surveyApi.submit', () => {
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    await AsyncStorage.clear();
    fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
  });

  it('POSTs the answers with the version the client rendered', async () => {
    fetchMock.mockResolvedValue({ status: 201, ok: true, json: async () => ({ ok: true }) });

    const answers = { vocab_pain: 'context', frustration: 'never' };
    const sent = await surveyApi.submit(
      WELCOME_SURVEY_KEY,
      WELCOME_SURVEY_VERSION,
      buildSurveyResponses(answers),
    );

    expect(sent).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE_URL}/user/surveys/welcome`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      version: WELCOME_SURVEY_VERSION,
      responses: buildSurveyResponses(answers),
    });
  });

  it('resolves false instead of throwing when the network is down', async () => {
    // The caller has already moved to the next onboarding screen — an
    // unhandled rejection here would surface as a red box on a first run.
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(
      surveyApi.submit(WELCOME_SURVEY_KEY, WELCOME_SURVEY_VERSION, buildSurveyResponses({})),
    ).resolves.toBe(false);
  });

  it('resolves false instead of throwing when the server rejects the payload', async () => {
    fetchMock.mockResolvedValue({ status: 422, ok: false, json: async () => ({}), text: async () => '' });
    await expect(
      surveyApi.submit(WELCOME_SURVEY_KEY, WELCOME_SURVEY_VERSION, buildSurveyResponses({})),
    ).resolves.toBe(false);
  });
});
