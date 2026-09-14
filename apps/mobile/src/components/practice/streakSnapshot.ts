/**
 * streakSnapshot — the last known streak panel, carried forward to today.
 *
 * ## The bug
 *
 * The Practice header asked `/daily/state` on mount and drew what it had in the
 * meantime — which was nothing, rendered as facts. Measured on the first tap of
 * Practice after a cold start (local API, so the fastest case there is):
 *
 *     +2143ms  "0 DAYS", unlit flame, "0/0 FREEZES", seven empty circles
 *     +2263ms  still the same
 *     +2296ms  "41 DAYS", lit flame, "0/3 FREEZES", the dated week
 *
 * A streak of 41 announced as 0, then corrected. On a real network that window
 * is the round trip, not 150ms.
 *
 * ## The fix, and why it is not just "cache the response"
 *
 * The last response is kept per account and loaded before the tab is ever
 * tapped, so the first frame is the panel the user last saw. But this is a
 * once-a-day app: the snapshot is usually from YESTERDAY, and replaying it
 * verbatim would put the today ring on yesterday's circle and keep yesterday's
 * `today_done` — which also gates the free tier's lesson.
 *
 * So a snapshot from an earlier day is carried forward to today's calendar:
 * the counts are the last known ones, days that have already happened keep
 * the states they had, today is open, and later days are future. Everything
 * here is either something the server already told us or the calendar itself;
 * nothing is invented. The live response replaces it moments later, and any
 * real change it brings — a freeze spent overnight — arrives with its toast.
 */

import type { DailyState, WeekDay } from '../../services/api';

/** What is persisted: the response, and the local calendar day it described. */
export interface StreakSnapshot {
  state: DailyState;
  /** YYYY-MM-DD, local, when the response was received. */
  fetchedOn: string;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Local calendar date of `now`, as YYYY-MM-DD. Components, not UTC. */
export function localIsoDate(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * The Monday–Sunday that contains `today`, as seven YYYY-MM-DD strings.
 *
 * Built from local date components — `new Date(y, m - 1, d)` — and never from
 * a parsed string: `new Date('2026-09-14')` is UTC midnight and would land the
 * week a day early anywhere west of Greenwich. Monday-first, matching the
 * server's `week_bounds`.
 */
export function weekDatesFor(today: string): string[] {
  const match = ISO.exec(today);
  if (!match) return [];
  const base = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const mondayOffset = (base.getDay() + 6) % 7; // Mon=0 … Sun=6
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - mondayOffset + i);
    return localIsoDate(d);
  });
}

/**
 * The snapshot as it should read on `today`.
 *
 * Same day: returned untouched — it is simply the last answer.
 *
 * A later day: the week is rebuilt for today's calendar. A day the snapshot
 * knew keeps its state, unless it was `future` then and is in the past now, in
 * which case it is `missed` (nothing was recorded on it, as far as this phone
 * knows). A day it never saw is `missed` before today and `future` after.
 * Today is open. Plain ISO strings compare correctly as dates.
 */
export function carryForward(snapshot: StreakSnapshot, today: string): DailyState {
  const { state, fetchedOn } = snapshot;
  if (fetchedOn === today) return state;

  const known = new Map<string, WeekDay>((state.week ?? []).map((d) => [d.date, d]));
  const week: WeekDay[] = weekDatesFor(today).map((date) => {
    if (date > today) return { date, state: 'future', is_today: false };
    if (date === today) return { date, state: 'missed', is_today: true };
    const was = known.get(date);
    const settled = was && was.state !== 'future' ? was.state : 'missed';
    return { date, state: settled, is_today: false };
  });

  return {
    ...state,
    week,
    // A new day starts undone. Carrying yesterday's `true` forward would also
    // tell a free user their lesson is used up before they have taken it.
    today_done: false,
    // These report events in the response that carried them, and must never be
    // replayed from a copy.
    auto_consumed: 0,
    auto_granted_weekly: false,
    ...(state.auto_armed !== undefined ? { auto_armed: 0 } : {}),
  };
}
