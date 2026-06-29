/**
 * Placement quiz logic + data (Launch §A) — web copy.
 *
 * IDENTICAL to apps/mobile/src/components/onboarding/placement.ts. The two
 * are kept in sync by hand (no runtime cross-package import). Mobile carries
 * the unit tests for derivePlacementLevel; keep the algorithm matched.
 */

import { CEFR_LEVELS, type CefrLevel } from '@wordwise/types';

export type PlacementRating = 'know' | 'familiar' | 'unknown';

export interface PlacementWord {
  word: string;
  pos: string;
  level: CefrLevel;
}

export interface PlacementAnswer {
  level: CefrLevel;
  rating: PlacementRating;
}

export const PLACEMENT_WORDS: ReadonlyArray<PlacementWord> = [
  { word: 'house', pos: 'noun', level: 'A1' },
  { word: 'borrow', pos: 'verb', level: 'A2' },
  { word: 'reliable', pos: 'adjective', level: 'B1' },
  { word: 'overwhelm', pos: 'verb', level: 'B2' },
  { word: 'ephemeral', pos: 'adjective', level: 'C1' },
  { word: 'ostensible', pos: 'adjective', level: 'C2' },
];

const RATING_POINTS: Record<PlacementRating, number> = {
  know: 2,
  familiar: 1,
  unknown: 0,
};

export function derivePlacementLevel(answers: ReadonlyArray<PlacementAnswer>): CefrLevel {
  if (answers.length === 0) return 'A1';
  const score = answers.reduce((sum, a) => sum + RATING_POINTS[a.rating], 0);
  const maxScore = answers.length * RATING_POINTS.know;
  const ratio = maxScore === 0 ? 0 : score / maxScore;
  const idx = Math.min(CEFR_LEVELS.length - 1, Math.floor(ratio * CEFR_LEVELS.length));
  return CEFR_LEVELS[idx];
}

export interface DailyGoalOption {
  mins: number;
  label: string;
  sub: string;
}

export const DAILY_GOAL_OPTIONS: ReadonlyArray<DailyGoalOption> = [
  { mins: 3, label: 'Casual', sub: '3 min · 1 lesson a day' },
  { mins: 6, label: 'Regular', sub: '6 min · 2 lessons a day' },
  { mins: 12, label: 'Serious', sub: '12 min · 4 lessons a day' },
  { mins: 20, label: 'Intense', sub: '20 min · 6+ lessons a day' },
];
