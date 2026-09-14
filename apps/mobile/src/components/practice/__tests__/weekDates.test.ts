/**
 * The date inside each circle of the streak week.
 *
 * Two ways this goes wrong without looking wrong:
 *
 *  • Off by one day, in half the world. `new Date('2026-09-14')` is UTC
 *    midnight, so `getDate()` west of Greenwich answers 13. Every circle in the
 *    Americas would carry yesterday's number beside today's state — a mismatch
 *    that reads as "the streak is wrong", not as a labelling bug.
 *  • Unreadable on its own fill. White on gold is ~2:1, gold ink on a gold
 *    today-that-is-done vanishes, and a number inside the old frozen circle
 *    inherited the circle's 45% opacity.
 */

import fs from 'fs';
import path from 'path';

import { dayNumberTone, dayOfMonth } from '../weekDates';

describe('dayOfMonth', () => {
  it('reads the day straight out of the server’s date', () => {
    expect(dayOfMonth('2026-09-14')).toBe('14');
    expect(dayOfMonth('2026-09-01')).toBe('1'); // no leading zero in a circle
    expect(dayOfMonth('2026-08-31')).toBe('31');
  });

  it('handles a week that crosses a month boundary', () => {
    // Mon–Sun can be 29, 30, 31, 1, 2, 3, 4 — the numbers must simply follow
    // the dates, not a counter that assumes one month.
    const week = ['2026-08-31', '2026-09-01', '2026-09-02'];
    expect(week.map(dayOfMonth)).toEqual(['31', '1', '2']);
  });

  it('never goes through Date, so no timezone can shift it', () => {
    // The trap, pinned structurally: the only way to be immune to the device's
    // offset is not to parse a calendar date as an instant at all.
    const src = fs
      .readFileSync(path.join(__dirname, '..', 'weekDates.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).not.toMatch(/new Date|Date\.parse/);
  });

  it('shows Western digits, matching the rest of the panel', () => {
    expect(dayOfMonth('2026-09-14')).toMatch(/^[0-9]+$/);
  });

  it('draws nothing rather than nonsense for a bad date', () => {
    // An empty circle, not "NaN" or "0".
    expect(dayOfMonth(undefined)).toBeNull();
    expect(dayOfMonth(null)).toBeNull();
    expect(dayOfMonth('')).toBeNull();
    expect(dayOfMonth('14')).toBeNull();
    expect(dayOfMonth('2026-9-14')).toBeNull();
    expect(dayOfMonth('2026-09-00')).toBeNull();
    expect(dayOfMonth('2026-13-14')).toBeNull();
    expect(dayOfMonth('2026-09-14T00:00:00Z')).toBeNull();
  });
});

describe('dayNumberTone', () => {
  it('uses dark ink on a practised day', () => {
    expect(dayNumberTone({ state: 'done', is_today: false })).toBe('onGold');
  });

  it('lets the fill win over today', () => {
    // Today AND done sits on solid gold, where gold "today" ink would vanish.
    expect(dayNumberTone({ state: 'done', is_today: true })).toBe('onGold');
    expect(dayNumberTone({ state: 'frozen', is_today: true })).toBe('onFrozen');
  });

  it('marks today in gold while it is still open', () => {
    expect(dayNumberTone({ state: 'missed', is_today: true })).toBe('today');
  });

  it('keeps missed and future days quiet', () => {
    expect(dayNumberTone({ state: 'missed', is_today: false })).toBe('faint');
    expect(dayNumberTone({ state: 'future', is_today: false })).toBe('faint');
  });

  it('has an answer before the server does', () => {
    expect(dayNumberTone(undefined)).toBe('faint');
  });
});
