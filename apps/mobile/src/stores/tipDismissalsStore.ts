/**
 * tipDismissalsStore — remembers which one-shot educational tips the
 * user has tapped "Don't show again" on. Local-only (AsyncStorage); no
 * backend mirror for v1.
 *
 * Tip keys are short kebab-case identifiers like `spacing_first_repeat`.
 * Once dismissed, a key never re-fires. Tips that DON'T get dismissed
 * also auto-respect the in-memory session lock (callers gate themselves
 * via `shouldShow` + `markShown`) so the user doesn't get the same
 * popup twice in one sitting.
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'tips.dismissed.v1';

interface TipDismissalsState {
  dismissed: Set<string>;
  /** Tips already shown in this app session (in-memory only, resets
   *  on cold start). Prevents repeat-fire even if the user didn't
   *  explicitly dismiss. */
  shownThisSession: Set<string>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** True iff this tip is eligible to fire RIGHT NOW: not persistently
   *  dismissed AND not already shown this session. */
  shouldShow: (key: string) => boolean;
  /** Mark a tip as shown for the current session (in-memory). */
  markShown: (key: string) => void;
  /** Persist a "don't show again" decision. */
  dismiss: (key: string) => Promise<void>;
  /** Forget this account's state. Called on sign-out — these stores are
   *  singletons that outlive the session, so without it the next account
   *  reads the previous one's data straight from memory. */
  reset: () => void;
}

async function load(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

async function save(dismissed: Set<string>): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(Array.from(dismissed)));
  } catch {
    /* best-effort */
  }
}

export const useTipDismissalsStore = create<TipDismissalsState>((set, get) => ({
  dismissed: new Set<string>(),
  shownThisSession: new Set<string>(),
  hydrated: false,

  reset: () =>
    set({
      dismissed: new Set<string>(),
      shownThisSession: new Set<string>(),
      hydrated: false,
    }),

  hydrate: async () => {
    const keys = await load();
    set({ dismissed: new Set(keys), hydrated: true });
  },

  shouldShow: (key) => {
    const s = get();
    return !s.dismissed.has(key) && !s.shownThisSession.has(key);
  },

  markShown: (key) => {
    set((s) => {
      const next = new Set(s.shownThisSession);
      next.add(key);
      return { shownThisSession: next };
    });
  },

  dismiss: async (key) => {
    set((s) => {
      const next = new Set(s.dismissed);
      next.add(key);
      // Persist after the optimistic update.
      void save(next);
      return { dismissed: next };
    });
  },
}));
