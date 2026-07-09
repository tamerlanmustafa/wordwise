import {
  derivePlacementLevel,
  PLACEMENT_WORDS,
  DAILY_GOAL_OPTIONS,
  type PlacementAnswer,
  type PlacementRating,
} from '../placement';
import { CEFR_LEVELS } from '../../../types';

// Build a full 6-answer set where every word gets the same rating.
const allRated = (rating: PlacementRating): PlacementAnswer[] =>
  PLACEMENT_WORDS.map((w) => ({ level: w.level, rating }));

describe('derivePlacementLevel', () => {
  it('no answers (skip — I\'m a beginner) → A1', () => {
    expect(derivePlacementLevel([])).toBe('A1');
  });

  it('all "unknown" → A1 (bottom band)', () => {
    expect(derivePlacementLevel(allRated('unknown'))).toBe('A1');
  });

  it('all "know" → C2 (top band)', () => {
    expect(derivePlacementLevel(allRated('know'))).toBe('C2');
  });

  it('all "familiar" lands mid-scale (B2)', () => {
    // 6 × 1 / 12 = 0.5 → floor(0.5 × 6) = 3 → CEFR_LEVELS[3] === B2
    expect(derivePlacementLevel(allRated('familiar'))).toBe('B2');
  });

  it('is monotonic — more knowledge never lowers the level', () => {
    const levels = (['unknown', 'familiar', 'know'] as PlacementRating[]).map((r) =>
      CEFR_LEVELS.indexOf(derivePlacementLevel(allRated(r))),
    );
    expect(levels[0]).toBeLessThanOrEqual(levels[1]);
    expect(levels[1]).toBeLessThanOrEqual(levels[2]);
  });

  it('always returns a valid CEFR band for any mix', () => {
    const mixed: PlacementAnswer[] = [
      { level: 'A1', rating: 'know' },
      { level: 'A2', rating: 'know' },
      { level: 'B1', rating: 'familiar' },
      { level: 'B2', rating: 'unknown' },
      { level: 'C1', rating: 'unknown' },
      { level: 'C2', rating: 'unknown' },
    ];
    expect(CEFR_LEVELS).toContain(derivePlacementLevel(mixed));
  });
});

describe('placement data', () => {
  it('ships exactly two words per CEFR band, in ascending order (#81)', () => {
    // Two per band halves the one-lucky-word variance of the original quiz
    // while keeping it quick; scoring scales with list length automatically.
    expect(PLACEMENT_WORDS.map((w) => w.level)).toEqual(
      CEFR_LEVELS.flatMap((level) => [level, level]),
    );
  });

  it('offers the four daily-goal tiers from the prototype', () => {
    expect(DAILY_GOAL_OPTIONS.map((g) => g.mins)).toEqual([3, 6, 12, 20]);
  });
});
