import {
  derivePlacementLevel,
  isPlacementDecided,
  PLACEMENT_WORDS,
  DAILY_GOAL_OPTIONS,
  type PlacementAnswer,
  type PlacementRating,
} from '../placement';
import { CEFR_LEVELS } from '../../../types';

// Answer the quiz in order, rating both words of each listed band the same
// way. Stops after the listed bands, so a partial list = a partial quiz.
const rateBands = (ratings: ReadonlyArray<PlacementRating>): PlacementAnswer[] =>
  PLACEMENT_WORDS.slice(0, ratings.length * 2).map((w, i) => ({
    level: w.level,
    rating: ratings[Math.floor(i / 2)],
  }));

// Build a full answer set where every word gets the same rating.
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

  it('all "familiar" → A1 — never defining a word demonstrates no band (#81)', () => {
    // The old flat sum placed this user at B2 despite them not being able to
    // define "house". A band needs at least one confident "know" to pass.
    expect(derivePlacementLevel(allRated('familiar'))).toBe('A1');
  });

  it('knows everything through B1, nothing above → B1, not B2 (#81)', () => {
    // The old flat sum bucketed 12/24 points into B2 — one band above
    // anything the user actually demonstrated.
    expect(
      derivePlacementLevel(rateBands(['know', 'know', 'know', 'unknown', 'unknown', 'unknown'])),
    ).toBe('B1');
  });

  it('a "know" + "familiar" pair passes a band', () => {
    const answers = PLACEMENT_WORDS.slice(0, 8).map((w, i) => ({
      level: w.level,
      rating: (i % 2 === 0 ? 'know' : 'familiar') as PlacementRating,
    }));
    expect(derivePlacementLevel(answers)).toBe('B2');
  });

  it('bridges one unlucky band when the band above it still passes', () => {
    // A2 missed (never met "borrow"/"luggage") but B1 and B2 solid → B2.
    expect(
      derivePlacementLevel(rateBands(['know', 'unknown', 'know', 'know', 'unknown', 'unknown'])),
    ).toBe('B2');
  });

  it('two consecutive failed bands end the climb — claiming only hard words stays low', () => {
    expect(
      derivePlacementLevel(rateBands(['know', 'unknown', 'unknown', 'know', 'know', 'know'])),
    ).toBe('A1');
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

describe('isPlacementDecided', () => {
  it('a full answer set is always decided', () => {
    expect(isPlacementDecided(allRated('know'))).toBe(true);
  });

  it('stays open while a strong finish could still raise the level', () => {
    // Two unknown bands can be climbed past only via a bridge, so after the
    // A2 pair the B-band words still matter.
    expect(isPlacementDecided(rateBands(['know', 'unknown']))).toBe(false);
  });

  it('ends a beginner\'s quiz once two bands in a row are out of reach (#81)', () => {
    // A2 hard-failed and the first B1 word unknown → B1 can no longer pass,
    // no bridge is possible, and the C-band words can't change the result.
    const answers = [
      ...rateBands(['know', 'unknown']),
      { level: 'B1', rating: 'unknown' },
    ] as PlacementAnswer[];
    expect(isPlacementDecided(answers)).toBe(true);
    expect(derivePlacementLevel(answers)).toBe('A1');
  });

  it('an all-"know" run stays open to the very last word', () => {
    const answers = allRated('know');
    expect(isPlacementDecided(answers.slice(0, answers.length - 1))).toBe(false);
  });

  it('the early-stopped level matches finishing the quiz with the rest unknown', () => {
    const truncated = [
      ...rateBands(['know', 'unknown']),
      { level: 'B1', rating: 'unknown' },
    ] as PlacementAnswer[];
    const completed = [
      ...truncated,
      ...PLACEMENT_WORDS.slice(truncated.length).map((w) => ({
        level: w.level,
        rating: 'unknown' as PlacementRating,
      })),
    ];
    expect(derivePlacementLevel(truncated)).toBe(derivePlacementLevel(completed));
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
