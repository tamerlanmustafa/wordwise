/**
 * The last known streak panel, carried to today.
 *
 * Measured before: the first tap of Practice after a cold start drew
 * "0 DAYS · 0/0 FREEZES" over seven empty circles until `/daily/state`
 * answered, then snapped to the real 41. The panel now opens on the account's
 * last answer — and because this is a once-a-day app, that answer is usually
 * from yesterday. These tests pin how it is carried forward without inventing
 * anything: the counts are the last known ones, the calendar is today's.
 */

import type { DailyState, WeekDay } from '../../../services/api';
import { carryForward, localIsoDate, weekDatesFor, type StreakSnapshot } from '../streakSnapshot';

const day = (date: string, state: WeekDay['state'], is_today = false): WeekDay => ({ date, state, is_today });

/** The account as it was last seen: Tuesday 15 Sept, streak 41, Mon done. */
const tuesday = (): DailyState => ({
  today_done: true,
  streak: 41,
  longest_streak: 41,
  freezes_held: 3,
  freezes_equipped: 1,
  last_session_date: '2026-09-15',
  repair_window_active: false,
  auto_granted_weekly: true,
  auto_consumed: 2,
  unlocked_cosmetics: [],
  auto_armed: 1,
  week: [
    day('2026-09-14', 'done'),
    day('2026-09-15', 'done', true),
    day('2026-09-16', 'future'),
    day('2026-09-17', 'future'),
    day('2026-09-18', 'future'),
    day('2026-09-19', 'future'),
    day('2026-09-20', 'future'),
  ],
});

const snap = (fetchedOn: string, state = tuesday()): StreakSnapshot => ({ state, fetchedOn });

describe('weekDatesFor', () => {
  it('is the Monday–Sunday containing the day, Monday first like the server', () => {
    expect(weekDatesFor('2026-09-16')).toEqual([
      '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20',
    ]);
  });

  it('starts on the day itself when that day is a Monday', () => {
    expect(weekDatesFor('2026-09-14')[0]).toBe('2026-09-14');
  });

  it('ends on the day itself when that day is a Sunday', () => {
    expect(weekDatesFor('2026-09-20')).toEqual([
      '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20',
    ]);
  });

  it('crosses a month and a year boundary correctly', () => {
    expect(weekDatesFor('2026-10-01').slice(0, 4)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01']);
    expect(weekDatesFor('2027-01-01')[0]).toBe('2026-12-28');
  });

  it('returns nothing for a date it cannot read', () => {
    expect(weekDatesFor('nope')).toEqual([]);
  });
});

describe('localIsoDate', () => {
  it('uses the local calendar, not UTC', () => {
    // 23:30 local on the 14th is the 14th here, whatever UTC says.
    expect(localIsoDate(new Date(2026, 8, 14, 23, 30))).toBe('2026-09-14');
    expect(localIsoDate(new Date(2026, 8, 14, 0, 5))).toBe('2026-09-14');
  });
});

describe('carryForward — the same day', () => {
  it('returns the snapshot untouched', () => {
    const s = snap('2026-09-15');
    expect(carryForward(s, '2026-09-15')).toBe(s.state);
  });
});

describe('carryForward — a later day in the same week', () => {
  const out = carryForward(snap('2026-09-15'), '2026-09-17');

  it('keeps the last known streak and freezes', () => {
    // The whole point: 41, not 0, on the first frame.
    expect(out.streak).toBe(41);
    expect(out.freezes_held).toBe(3);
    expect(out.freezes_equipped).toBe(1);
  });

  it('moves the today ring to today', () => {
    expect(out.week?.filter((d) => d.is_today).map((d) => d.date)).toEqual(['2026-09-17']);
  });

  it('keeps the days it knew', () => {
    expect(out.week?.[0]).toEqual(day('2026-09-14', 'done'));
    expect(out.week?.[1]).toEqual(day('2026-09-15', 'done'));
  });

  it('calls a day that was future then and past now missed', () => {
    // Wednesday was "future" when the snapshot was taken. Nothing this phone
    // knows happened on it — the live answer corrects it if something did.
    expect(out.week?.[2]).toEqual(day('2026-09-16', 'missed'));
  });

  it('draws today open and later days future', () => {
    expect(out.week?.[3]).toEqual(day('2026-09-17', 'missed', true));
    expect(out.week?.slice(4).every((d) => d.state === 'future' && !d.is_today)).toBe(true);
  });

  it('starts the new day undone', () => {
    // Yesterday's `true` carried forward would read as "today's lesson is
    // used up" before the user had taken it.
    expect(out.today_done).toBe(false);
  });

  it('never replays the events of the response it copied', () => {
    // Those drive toasts ("a freeze covered yesterday"); a copy must not
    // announce them again on the next launch.
    expect(out.auto_consumed).toBe(0);
    expect(out.auto_granted_weekly).toBe(false);
    expect(out.auto_armed).toBe(0);
  });
});

describe('carryForward — a new week', () => {
  const out = carryForward(snap('2026-09-15'), '2026-09-23');

  it('draws this week’s dates, not last week’s', () => {
    expect(out.week?.map((d) => d.date)).toEqual(weekDatesFor('2026-09-23'));
  });

  it('knows nothing about this week’s earlier days, and says missed', () => {
    expect(out.week?.slice(0, 2).map((d) => d.state)).toEqual(['missed', 'missed']);
  });

  it('still opens on the last known counts', () => {
    expect(out.streak).toBe(41);
  });
});

describe('carryForward — an older server with no week', () => {
  it('still builds today’s week', () => {
    const state = { ...tuesday(), week: undefined };
    const out = carryForward(snap('2026-09-15', state), '2026-09-16');
    expect(out.week).toHaveLength(7);
    expect(out.week?.find((d) => d.is_today)?.date).toBe('2026-09-16');
  });
});
