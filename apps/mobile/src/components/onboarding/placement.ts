/**
 * Placement quiz logic + data (Launch §A, step 3–4).
 *
 * A 6-word CEFR self-rating quiz: the user rates one word per band from "never
 * seen it" → "know it well", and `derivePlacementLevel` maps the ratings to a
 * starting CEFR level. Pure + deterministic so it can be unit-tested at the
 * band boundaries (see __tests__/placement.test.ts).
 *
 * Web keeps an identical copy at frontend/src/utils/placement.ts (Metro can't
 * import across packages at runtime). Keep the two in sync.
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

/** One word per band, ascending difficulty — the prototype shows "ephemeral". */
export const PLACEMENT_WORDS: ReadonlyArray<PlacementWord> = [
  { word: 'house', pos: 'noun', level: 'A1' },
  { word: 'borrow', pos: 'verb', level: 'A2' },
  { word: 'reliable', pos: 'adjective', level: 'B1' },
  { word: 'overwhelm', pos: 'verb', level: 'B2' },
  { word: 'ephemeral', pos: 'adjective', level: 'C1' },
  { word: 'ostensible', pos: 'adjective', level: 'C2' },
];

/** Self-rating → points. Familiar is worth half a "known" word. */
const RATING_POINTS: Record<PlacementRating, number> = {
  know: 2,
  familiar: 1,
  unknown: 0,
};

/**
 * Maps placement answers to a starting CEFR level.
 *
 * Each answer scores 0–2 (unknown/familiar/know); the total (0…2·N) is bucketed
 * evenly across the six bands. With the canonical 6 words the buckets are:
 *   0–2 → A1 · 3–4 → A2 · 5–6 → B1 · 7–8 → B2 · 9–10 → C1 · 11–12 → C2
 * No answers (the "Skip — I'm a beginner" escape hatch) → A1.
 */
export function derivePlacementLevel(answers: ReadonlyArray<PlacementAnswer>): CefrLevel {
  if (answers.length === 0) return 'A1';

  const score = answers.reduce((sum, a) => sum + RATING_POINTS[a.rating], 0);
  const maxScore = answers.length * RATING_POINTS.know;
  // Map score → band index. Floor so each band owns an equal-width bucket and
  // only a perfect score reaches the top band.
  const ratio = maxScore === 0 ? 0 : score / maxScore;
  const idx = Math.min(
    CEFR_LEVELS.length - 1,
    Math.floor(ratio * CEFR_LEVELS.length),
  );
  return CEFR_LEVELS[idx];
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
