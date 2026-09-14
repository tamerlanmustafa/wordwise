/**
 * weekDates — the day-of-month drawn inside each circle of the streak week.
 *
 * Pure, and kept out of `StreakWeek` so the two decisions that can quietly go
 * wrong are testable without rendering anything: which number a day shows,
 * and what colour that number needs to stay readable on its circle.
 */

import type { WeekDay } from '../../services/api';

/**
 * The day of the month for a server `YYYY-MM-DD`, as the string to draw.
 *
 * ## Read from the string, never through `new Date`
 *
 * `new Date('2026-09-14')` parses a bare date as **UTC midnight**. Asked for
 * `getDate()` in any timezone west of Greenwich, it answers 13 — so every
 * circle in the Americas would be labelled with yesterday's date, one day off
 * from the state the server drew it with. The server already sends the date in
 * the user's own calendar (`streak_service.build_week` uses their timezone);
 * the only correct move on the client is not to convert it again.
 *
 * Western digits in every locale, deliberately: the rest of this panel's
 * numbers (the streak, the freeze count) are Western digits, and the Arabic
 * locale rule in this app is that numerals stay Western.
 *
 * Returns null for anything that is not a real calendar day, so a malformed or
 * missing date draws an empty circle rather than "NaN" or "0".
 */
export function dayOfMonth(date: string | null | undefined): string | null {
  if (typeof date !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return String(day);
}

/** Which ink a day's number is drawn in. */
export type DayNumberTone =
  /** On the solid gold of a practised day — dark ink, never white on gold. */
  | 'onGold'
  /** On a freeze-covered day's muted fill — ordinary text colour. */
  | 'onFrozen'
  /** Today, not yet practised — gold, to match its ring. */
  | 'today'
  /** A day that went by empty, or has not come yet. */
  | 'faint';

/**
 * Pick the ink for a day's number.
 *
 * Fill first, then today: a day that is both today AND done sits on solid
 * gold, where gold ink would vanish — so the fill decides, and "today" only
 * applies to a day with nothing painted inside its ring.
 */
export function dayNumberTone(day: Pick<WeekDay, 'state' | 'is_today'> | undefined): DayNumberTone {
  if (day?.state === 'done') return 'onGold';
  if (day?.state === 'frozen') return 'onFrozen';
  if (day?.is_today) return 'today';
  return 'faint';
}
