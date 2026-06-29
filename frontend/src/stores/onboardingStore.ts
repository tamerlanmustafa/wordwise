/**
 * onboardingStore — first-run flow state (Launch §A), web copy.
 *
 * Mirrors apps/mobile/src/stores/onboardingStore.ts. Persistence is
 * localStorage (synchronous), so unlike mobile there's no async hydrate —
 * the store initialises straight from storage at module load.
 */

import { create } from 'zustand';
import type { CefrLevel } from '@wordwise/types';

const KEY = 'wordwise.onboarding.v1';

export interface OnboardingCompletion {
  targetLanguage: string;
  startingLevel: CefrLevel;
  dailyGoalMinutes: number;
}

interface PersistShape extends OnboardingCompletion {
  completed: boolean;
}

interface OnboardingState extends Partial<OnboardingCompletion> {
  completed: boolean;
  complete: (payload: OnboardingCompletion) => void;
  reset: () => void;
}

function load(): Partial<PersistShape> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<PersistShape>;
  } catch {
    return {};
  }
}

const initial = load();

export const useOnboardingStore = create<OnboardingState>((set) => ({
  completed: initial.completed === true,
  targetLanguage: initial.targetLanguage,
  startingLevel: initial.startingLevel,
  dailyGoalMinutes: initial.dailyGoalMinutes,

  complete: (payload) => {
    const next: PersistShape = { completed: true, ...payload };
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* best-effort */
    }
    set({ ...next });
  },

  reset: () => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* best-effort */
    }
    set({ completed: false, targetLanguage: undefined, startingLevel: undefined, dailyGoalMinutes: undefined });
  },
}));
