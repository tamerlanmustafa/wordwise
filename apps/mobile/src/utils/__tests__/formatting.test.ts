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
    expect(scoreToCefr(54)).toBe('B2');
    expect(scoreToCefr(55)).toBe('C1');
    expect(scoreToCefr(69)).toBe('C1');
    expect(scoreToCefr(70)).toBe('C2');
    expect(scoreToCefr(100)).toBe('C2');
  });

  // Bucket boundaries must match backend/src/services/difficulty_scorer.py.
  // If one of these fails after a backend change, fix both sides together.
  it('covers the exact upper/lower bounds of every band', () => {
    const bands: Array<[number, string]> = [
      [24, 'A1'],
      [25, 'A2'],
      [34, 'A2'],
      [35, 'B1'],
      [44, 'B1'],
      [45, 'B2'],
      [54, 'B2'],
      [55, 'C1'],
      [69, 'C1'],
      [70, 'C2'],
    ];
    bands.forEach(([score, expected]) => {
      expect(scoreToCefr(score)).toBe(expected);
    });
  });
});
