/**
 * Placement quiz logic + data (Launch §A, step 3–4).
 *
 * A CEFR self-rating quiz: the user rates two words per band from "never seen
 * it" → "know it well", and `derivePlacementLevel` maps the ratings to a
 * starting CEFR level via frontier scoring (see below). `isPlacementDecided`
 * lets the flow end the quiz early once no remaining answer can change the
 * result. Pure + deterministic so it can be unit-tested at the band
 * boundaries (see __tests__/placement.test.ts).
 *
 * frontend/src/utils/placement.ts is a stale web copy of the pre-#81
 * algorithm; the web app is frozen (see CLAUDE.md), so it is intentionally
 * not kept in sync.
 */

import { CEFR_LEVELS, type CefrLevel } from '../../types';

export type PlacementRating = 'know' | 'familiar' | 'unknown';

export interface PlacementWord {
  /** The word shown on the card. */
  word: string;
  /** Part of speech, shown under the word (italic, like the prototype). */
  pos: string;
  /** The CEFR band this word belongs to. */
  level: CefrLevel;
}

export interface PlacementAnswer {
  level: CefrLevel;
  rating: PlacementRating;
}

/**
 * Two words per band, ascending difficulty (issue #81): a single word per band
 * made the result swing a full level on one lucky/unlucky word. Doubling the
 * sample halves that variance while keeping the quiz ~30 seconds; the scoring
 * below scales with list length automatically.
 */
export const PLACEMENT_WORDS: ReadonlyArray<PlacementWord> = [
  { word: 'house', pos: 'noun', level: 'A1' },
  { word: 'water', pos: 'noun', level: 'A1' },
  { word: 'borrow', pos: 'verb', level: 'A2' },
  { word: 'luggage', pos: 'noun', level: 'A2' },
  { word: 'reliable', pos: 'adjective', level: 'B1' },
  { word: 'persuade', pos: 'verb', level: 'B1' },
  { word: 'overwhelm', pos: 'verb', level: 'B2' },
  { word: 'deteriorate', pos: 'verb', level: 'B2' },
  { word: 'ephemeral', pos: 'adjective', level: 'C1' },
  { word: 'meticulous', pos: 'adjective', level: 'C1' },
  { word: 'ostensible', pos: 'adjective', level: 'C2' },
  { word: 'perfunctory', pos: 'adjective', level: 'C2' },
];

/** Self-rating → points. Familiar is worth half a "known" word. */
const RATING_POINTS: Record<PlacementRating, number> = {
  know: 2,
  familiar: 1,
  unknown: 0,
};

/**
 * Points (of 4 per two-word band) needed to count a band as demonstrated:
 * a "know" plus at least a "familiar". Two half-hearted "familiar"s alone
 * don't pass — self-rating inflates, so each band demands one confident word.
 */
const BAND_PASS_POINTS = 3;

/** Per-band points, indexed like CEFR_LEVELS. Unanswered words score 0. */
const bandScores = (answers: ReadonlyArray<PlacementAnswer>): number[] =>
  CEFR_LEVELS.map((level) =>
    answers.reduce((sum, a) => (a.level === level ? sum + RATING_POINTS[a.rating] : sum), 0),
  );

/**
 * Maps placement answers to a starting CEFR level via frontier scoring
 * (issue #81). The old flat sum ignored *where* knowledge sat on the
 * difficulty ramp: knowing everything up to B1 (and nothing above) placed
 * B2, and rating every word "familiar" — without defining a single one —
 * also placed B2.
 *
 * Instead, each band is either demonstrated (≥ BAND_PASS_POINTS) or not, and
 * the level is the top of the unbroken run of demonstrated bands from A1.
 * One failed band may be bridged when the band above it still passes (two
 * fixed words per band means one unlucky pair shouldn't cap the result), but
 * two consecutive failed bands end the climb — claiming only hard words
 * can't place high. No answers (the "Skip — I'm a beginner" escape hatch)
 * or nothing demonstrated → A1.
 */
export function derivePlacementLevel(answers: ReadonlyArray<PlacementAnswer>): CefrLevel {
  const passed = bandScores(answers).map((s) => s >= BAND_PASS_POINTS);

  let levelIdx = 0;
  let bridged = false;
  for (let i = 0; i < CEFR_LEVELS.length; i++) {
    if (passed[i]) {
      levelIdx = i;
    } else if (!bridged && passed[i + 1]) {
      bridged = true; // skip one unlucky band; the next pass keeps the climb alive
    } else {
      break;
    }
  }
  return CEFR_LEVELS[levelIdx];
}

/**
 * True once the remaining (unanswered) words can no longer change the derived
 * level, so the flow can end the quiz early — a beginner shouldn't have to
 * rate "perfunctory" after hard-failing two bands in a row. Answers map
 * positionally onto `words`; the check completes the rest once all-"know"
 * and once all-"unknown" (scoring is monotonic per answer, so those bracket
 * every possible completion) and is decided when both agree.
 */
export function isPlacementDecided(
  answers: ReadonlyArray<PlacementAnswer>,
  words: ReadonlyArray<PlacementWord> = PLACEMENT_WORDS,
): boolean {
  if (answers.length >= words.length) return true;

  const completedWith = (rating: PlacementRating): CefrLevel =>
    derivePlacementLevel([
      ...answers,
      ...words.slice(answers.length).map((w) => ({ level: w.level, rating })),
    ]);
  return completedWith('know') === completedWith('unknown');
}

export interface DailyGoalOption {
  mins: number;
  label: string;
  sub: string;
}

/** Daily-goal options (prototype GOALS). Persisted via onboardingStore. */
export const DAILY_GOAL_OPTIONS: ReadonlyArray<DailyGoalOption> = [
  { mins: 3, label: 'Casual', sub: '3 min · 1 lesson a day' },
  { mins: 6, label: 'Regular', sub: '6 min · 2 lessons a day' },
  { mins: 12, label: 'Serious', sub: '12 min · 4 lessons a day' },
  { mins: 20, label: 'Intense', sub: '20 min · 6+ lessons a day' },
];
