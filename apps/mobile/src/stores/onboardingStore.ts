/**
 * onboardingStore — first-run flow state (Launch §A). Persists whether the
 * user has finished onboarding plus the three choices it captures, so the
 * app can gate its entry on `completed` and pre-fill the rest of the app
 * with what the user picked.
 *
 * Modelled on dailyGoalStore.ts: zustand + AsyncStorage behind a `hydrate()`
 * method and a versioned key (`onboarding.v1`).
 *
 *   • `completed`        — true once the user reaches the end of the flow.
 *                          The app root renders OnboardingFlow until this is
 *                          true (after authentication — see core/App.tsx).
 *   • `targetLanguage`   — uppercase translation-API code (e.g. 'ES'); the
 *                          same value the header language picker persists to
 *                          AsyncStorage under `targetLanguage`.
 *   • `startingLevel`    — CEFR band derived from the placement quiz.
 *   • `dailyGoalMinutes` — minutes/day the user committed to. dailyGoalStore
 *                          models the streak as ~1 session/day and has no
 *                          minutes concept, so the chosen minutes live here
 *                          (Settings + reminders read this).
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CefrLevel } from '../types';

const KEY = 'onboarding.v1';

export interface OnboardingCompletion {
  targetLanguage: string;
  startingLevel: CefrLevel;
  dailyGoalMinutes: number;
}

interface OnboardingState extends Partial<OnboardingCompletion> {
  completed: boolean;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** Mark onboarding done and persist the user's choices. */
  complete: (payload: OnboardingCompletion) => Promise<void>;
  /** Update the daily-goal minutes after onboarding (e.g. from Settings). */
  setDailyGoalMinutes: (mins: number) => Promise<void>;
  /** Clear onboarding — used on sign-out and in tests. */
  reset: () => Promise<void>;
}

interface PersistShape extends OnboardingCompletion {
  completed: boolean;
}

async function loadPersisted(): Promise<Partial<PersistShape> | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<PersistShape>;
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

export const useOnboardingStore = create<OnboardingState>((set) => ({
  completed: false,
  targetLanguage: undefined,
  startingLevel: undefined,
  dailyGoalMinutes: undefined,
  hydrated: false,

  hydrate: async () => {
    const persisted = await loadPersisted();
    if (!persisted) {
      set({ completed: false, hydrated: true });
      return;
    }
    set({
      completed: persisted.completed === true,
      targetLanguage: persisted.targetLanguage,
      startingLevel: persisted.startingLevel,
      dailyGoalMinutes: persisted.dailyGoalMinutes,
      hydrated: true,
    });
  },

  complete: async (payload) => {
    const next: PersistShape = { completed: true, ...payload };
    await save(next);
    set({ ...next, hydrated: true });
  },

  setDailyGoalMinutes: async (mins) => {
    set({ dailyGoalMinutes: mins });
    const st = useOnboardingStore.getState();
    // Persist the merged shape so a later hydrate keeps the new goal.
    await save({
      completed: st.completed,
      targetLanguage: st.targetLanguage ?? '',
      startingLevel: st.startingLevel ?? 'A1',
      dailyGoalMinutes: mins,
    });
  },

  reset: async () => {
    try {
      await AsyncStorage.removeItem(KEY);
    } catch {
      /* best-effort */
    }
    set({
      completed: false,
      targetLanguage: undefined,
      startingLevel: undefined,
      dailyGoalMinutes: undefined,
      hydrated: true,
    });
  },
}));
