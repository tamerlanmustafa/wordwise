import { formatVoteCount, scoreToCefr } from '../formatting';

describe('formatVoteCount', () => {
  it('returns the raw count under 1000', () => {
    expect(formatVoteCount(0)).toBe('0');
    expect(formatVoteCount(1)).toBe('1');
    expect(formatVoteCount(999)).toBe('999');
  });

  it('formats thousands with one decimal and a "k" suffix', () => {
    expect(formatVoteCount(1000)).toBe('1.0k');
    expect(formatVoteCount(1499)).toBe('1.5k');
    expect(formatVoteCount(12345)).toBe('12.3k');
    expect(formatVoteCount(1000000)).toBe('1000.0k');
  });
});

describe('scoreToCefr', () => {
  it('returns null when score is missing', () => {
    expect(scoreToCefr(null)).toBeNull();
    expect(scoreToCefr(undefined)).toBeNull();
  });

  it('maps scores to the correct CEFR band', () => {
    expect(scoreToCefr(0)).toBe('A1');
    expect(scoreToCefr(24)).toBe('A1');
    expect(scoreToCefr(25)).toBe('A2');
    expect(scoreToCefr(34)).toBe('A2');
    expect(scoreToCefr(35)).toBe('B1');
    expect(scoreToCefr(44)).toBe('B1');
    expect(scoreToCefr(45)).toBe('B2');
    expect(scoreToCefr(52)).toBe('B2');
    expect(scoreToCefr(53)).toBe('C1');
    expect(scoreToCefr(57)).toBe('C1');
    expect(scoreToCefr(58)).toBe('C2');
    expect(scoreToCefr(100)).toBe('C2');
  });

  // These numbers are a MIRROR of `CEFR_SCORE_RANGES` in
  // backend/src/services/movie_cefr.py, which is what actually decides which
  // films are on a level's shelf. This copy only decides what the card prints,
  // so a drift shows up as a B1 shelf full of cards labelled B2. If one of
  // these fails after a backend change, move both sides together.
  //
  // Recalibrated 2026-09-03: the old C2 floor of 70 sat above the hardest film
  // in the catalogue (72), so the C2 shelf held 7 films.
  it('covers the exact upper/lower bounds of every band', () => {
    const bands: Array<[number, string]> = [
      [24, 'A1'],
      [25, 'A2'],
      [34, 'A2'],
      [35, 'B1'],
      [44, 'B1'],
      [45, 'B2'],
      [52, 'B2'],
      [53, 'C1'],
      [57, 'C1'],
      [58, 'C2'],
    ];
    bands.forEach(([score, expected]) => {
      expect(scoreToCefr(score)).toBe(expected);
    });
  });
});
