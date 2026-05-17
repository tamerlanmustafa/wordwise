/**
 * dailyGoalStore — tracks the daily-3 commitment that anchors the
 * Journey Reel habit loop. Three pieces of state, all persisted:
 *
 *   • `date`      — the local-calendar date the counter is for
 *                   (YYYY-MM-DD). Auto-rolls at the first interaction
 *                   on a new day.
 *   • `done`      — sets completed today (0..3 caps the goal; bonus
 *                   sets push `done` past 3 but don't change pip math).
 *   • `streak`    — consecutive days the user has hit done >= 3. Bumps
 *                   when the 3rd set lands and the previous day was
 *                   either streak day or yesterday's streak day.
 *   • `lastHitDate` — last YYYY-MM-DD the user hit goal. Drives the
 *                   streak-continuation check independent of `date`
 *                   so a skipped day breaks the streak even if the
 *                   user opens the app a week later.
 *
 * The store is intentionally simple — no backend mirror. Streak math
 * happens in the bump function so the screen reads ready-to-render
 * values.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface DailyState {
  date: string;            // local YYYY-MM-DD
  done: number;            // sets completed today
  streak: number;          // consecutive daily-hit-3 days
  lastHitDate: string | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** Increment today's count. Returns the new state so the caller can
   *  decide whether to show the daily-wall modal (done === 3). */
  bump: () => { done: number; streak: number; justHit3: boolean };
}

const KEY = 'journey.dailyGoal.v1';
export const DAILY_GOAL = 3;

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function yesterdayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

interface PersistShape {
  date: string;
  done: number;
  streak: number;
  lastHitDate: string | null;
}

async function loadPersisted(): Promise<PersistShape | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistShape>;
    if (typeof parsed.date !== 'string' || typeof parsed.done !== 'number') return null;
    return {
      date: parsed.date,
      done: parsed.done,
      streak: typeof parsed.streak === 'number' ? parsed.streak : 0,
      lastHitDate: typeof parsed.lastHitDate === 'string' ? parsed.lastHitDate : null,
    };
  } catch {
    return null;
  }
}

async function save(s: PersistShape): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* best-effort */
  }
}

export const useDailyGoalStore = create<DailyState>((set, get) => ({
  date: todayLocal(),
  done: 0,
  streak: 0,
  lastHitDate: null,
  hydrated: false,

  hydrate: async () => {
    const today = todayLocal();
    const persisted = await loadPersisted();
    if (!persisted) {
      set({ date: today, done: 0, streak: 0, lastHitDate: null, hydrated: true });
      return;
    }
    // Day roll: if persisted day != today, reset `done` to 0 and
    // possibly reset `streak` (broken if the user skipped a day).
    if (persisted.date === today) {
      set({ ...persisted, hydrated: true });
      return;
    }
    const skipped =
      !persisted.lastHitDate ||
      persisted.lastHitDate !== persisted.date ||
      yesterdayOf(today) !== persisted.lastHitDate;
    const next: PersistShape = {
      date: today,
      done: 0,
      streak: skipped ? 0 : persisted.streak,
      lastHitDate: persisted.lastHitDate,
    };
    await save(next);
    set({ ...next, hydrated: true });
  },

  bump: () => {
    const today = todayLocal();
    const state = get();
    // Defensive day roll inside bump in case the user crossed midnight
    // mid-session; hydrate may not have fired since.
    const base: PersistShape = state.date === today
      ? { date: state.date, done: state.done, streak: state.streak, lastHitDate: state.lastHitDate }
      : { date: today, done: 0, streak: state.streak, lastHitDate: state.lastHitDate };

    const newDone = base.done + 1;
    const justHit3 = base.done < DAILY_GOAL && newDone >= DAILY_GOAL;
    let newStreak = base.streak;
    let newLastHit = base.lastHitDate;
    if (justHit3) {
      // Streak continues if yesterday was the prior lastHitDate, or if
      // today already was (idempotent). Otherwise this starts fresh
      // at 1 — the user just hit goal today after a gap.
      const continues =
        base.lastHitDate === today ||
        base.lastHitDate === yesterdayOf(today);
      newStreak = continues ? base.streak + 1 : 1;
      newLastHit = today;
    }
    const next: PersistShape = {
      date: today,
      done: newDone,
      streak: newStreak,
      lastHitDate: newLastHit,
    };
    save(next);
    set(next);
    return { done: newDone, streak: newStreak, justHit3 };
  },
}));
