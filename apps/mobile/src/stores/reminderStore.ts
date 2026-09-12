/**
 * reminderStore — the one notification WordWise sends.
 *
 * Holds whether the daily practice reminder is on and what time it fires, and
 * owns the only call that re-arms it. Everything else in the app asks this
 * store rather than talking to `expo-notifications` directly, so there is a
 * single place where "when should we nudge?" is decided.
 *
 * ## Why the store re-arms rather than the screens
 *
 * Two moments have to re-arm it: app launch, and changing the setting. Wiring
 * `expo-notifications` into both is how the *last* reminder feature broke — `App.tsx` scheduled on every
 * launch without consulting the stored preference, so switching it off lasted
 * until the next cold start, and the toggle was eventually deleted rather than
 * fixed. One entry point, which reads the preference itself, cannot drift from
 * the preference.
 *
 * ## The copy lives with the caller
 *
 * `reschedule` takes the title and body rather than importing i18n, because a
 * store is not a place `t()` belongs: the notification has to be written in the
 * language the user reads, and that is only knowable inside a component. It
 * also means the store stays testable without an i18n runtime.
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  cancelPracticeReminders,
  schedulePracticeReminders,
} from '../services/notifications';

const KEY = 'reminders.practice.v1';

/** Early evening: late enough that a normal day has happened, early enough
 *  that there is still time to act on it before the local day rolls over. */
export const DEFAULT_HOUR = 20;
export const DEFAULT_MINUTE = 0;

/** The hours worth offering. A minute-accurate picker is a decision nobody
 *  wants to make about a reminder; whole hours across the plausible range is
 *  the whole useful space. */
export const REMINDER_HOURS = [7, 8, 9, 12, 17, 18, 19, 20, 21, 22] as const;

export interface ReminderCopy {
  title: string;
  body: string;
}

interface ReminderState {
  enabled: boolean;
  hour: number;
  minute: number;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setEnabled: (on: boolean, copy: ReminderCopy) => Promise<void>;
  setHour: (hour: number, copy: ReminderCopy) => Promise<void>;
  /**
   * Re-arm from the stored preference. Safe to call at any time and as often
   * as you like — it cancels before it schedules.
   *
   * Called on launch and when the setting changes, and that is the whole list.
   * The trigger repeats on its own, so there is nothing to re-arm after a
   * lesson: the OS fires it again tomorrow whatever the app does.
   */
  reschedule: (copy: ReminderCopy) => Promise<void>;
}

async function persist(state: { enabled: boolean; hour: number; minute: number }) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* best-effort — a lost preference costs a reminder, not data */
  }
}

export const useReminderStore = create<ReminderState>((set, get) => ({
  // Off by default. An app that starts sending notifications because you
  // installed it has answered a question nobody asked it.
  enabled: false,
  hour: DEFAULT_HOUR,
  minute: DEFAULT_MINUTE,
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<ReminderState>;
        set({
          enabled: typeof p.enabled === 'boolean' ? p.enabled : false,
          hour: typeof p.hour === 'number' ? p.hour : DEFAULT_HOUR,
          minute: typeof p.minute === 'number' ? p.minute : DEFAULT_MINUTE,
        });
      }
    } catch {
      /* fall through to the defaults */
    }
    set({ hydrated: true });
  },

  setEnabled: async (on, copy) => {
    set({ enabled: on });
    void persist({ ...get(), enabled: on });
    if (on) await get().reschedule(copy);
    else await cancelPracticeReminders();
  },

  setHour: async (hour, copy) => {
    set({ hour });
    void persist({ ...get(), hour });
    if (get().enabled) await get().reschedule(copy);
  },

  reschedule: async (copy) => {
    const { enabled, hour, minute, hydrated } = get();
    // Before hydration the in-memory value is the default (off), not the
    // user's answer. Scheduling from it would cancel a reminder the user had
    // switched on, every single launch — the exact bug that killed the last
    // attempt at this feature, in the opposite direction.
    if (!hydrated) return;
    if (!enabled) {
      await cancelPracticeReminders();
      return;
    }
    await schedulePracticeReminders(hour, minute, copy);
  },
}));
