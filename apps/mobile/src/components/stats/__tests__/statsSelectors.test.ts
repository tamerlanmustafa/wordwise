import {
  comprehensionByLevel,
  intensityForCount,
  calendarIntensity,
  type LevelWord,
} from '../statsSelectors';
import { CEFR_LEVELS } from '../../../types';

describe('comprehensionByLevel', () => {
  it('returns all six bands in order even with no words', () => {
    const res = comprehensionByLevel([]);
    expect(res.map((r) => r.level)).toEqual([...CEFR_LEVELS]);
    expect(res.every((r) => r.pct === 0 && r.total === 0)).toBe(true);
  });

  it('computes whole-percent mastered per band', () => {
    const words: LevelWord[] = [
      { cefr_level: 'B1', mastered: true },
      { cefr_level: 'B1', mastered: true },
      { cefr_level: 'B1', mastered: false },
      { cefr_level: 'B1', mastered: false }, // 2/4 = 50%
      { cefr_level: 'A1', mastered: true }, // 1/1 = 100%
    ];
    const byLevel = Object.fromEntries(comprehensionByLevel(words).map((r) => [r.level, r.pct]));
    expect(byLevel.B1).toBe(50);
    expect(byLevel.A1).toBe(100);
    expect(byLevel.C2).toBe(0);
  });

  it('rounds to the nearest whole percent', () => {
    const words: LevelWord[] = [
      { cefr_level: 'A2', mastered: true },
      { cefr_level: 'A2', mastered: false },
      { cefr_level: 'A2', mastered: false }, // 1/3 = 33.33 → 33
    ];
    expect(comprehensionByLevel(words).find((r) => r.level === 'A2')!.pct).toBe(33);
  });
});

describe('intensityForCount', () => {
  it('buckets counts into 0–3', () => {
    expect(intensityForCount(0)).toBe(0);
    expect(intensityForCount(1)).toBe(1);
    expect(intensityForCount(2)).toBe(1);
    expect(intensityForCount(3)).toBe(2);
    expect(intensityForCount(5)).toBe(2);
    expect(intensityForCount(6)).toBe(3);
    expect(intensityForCount(99)).toBe(3);
  });
});

describe('calendarIntensity', () => {
  const today = new Date(2026, 5, 28); // 2026-06-28 (local)

  it('produces a weeks×7 grid ending today', () => {
    const grid = calendarIntensity({}, today, 5);
    expect(grid).toHaveLength(35);
    expect(grid.every((v) => v === 0)).toBe(true);
  });

  it('places today at the last index with its intensity', () => {
    const grid = calendarIntensity({ '2026-06-28': 7 }, today, 5);
    expect(grid[grid.length - 1]).toBe(3);
  });

  it('maps an earlier day to the right offset', () => {
    // Yesterday = second-to-last cell.
    const grid = calendarIntensity({ '2026-06-27': 2 }, today, 5);
    expect(grid[grid.length - 2]).toBe(1);
  });

  it('honors a custom week count', () => {
    expect(calendarIntensity({}, today, 3)).toHaveLength(21);
  });
});
