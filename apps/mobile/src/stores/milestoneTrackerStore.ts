/**
 * milestoneTrackerStore — local memory of which milestone slugs the
 * user has already "seen" (i.e. been celebrated for). Used to detect
 * NEW unlocks in the backend's `unlocked_cosmetics` list so we only
 * fire the celebration modal once per milestone.
 *
 * Storage: AsyncStorage, single key holding a JSON string[]. Local-only;
 * if the user reinstalls they'll re-see celebrations for milestones
 * they already hold — acceptable for v1 (a recurring "you have Box
 * Office" is a feature, not a bug).
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'milestones.seen.v1';

interface MilestoneTrackerState {
  seen: Set<string>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** Returns the slugs in `current` that the user hasn't seen yet
   *  (preserving order). Does NOT mark them seen — call `markSeen`
   *  separately so the caller can defer (e.g. after the user actually
   *  dismisses the modal). */
  newSince: (current: readonly string[]) => string[];
  /** Add slugs to the seen set + persist. Safe to call with already-seen
   *  values; idempotent. */
  markSeen: (slugs: readonly string[]) => Promise<void>;
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
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

async function save(seen: Set<string>): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(Array.from(seen)));
  } catch {
    /* best-effort */
  }
}

export const useMilestoneTrackerStore = create<MilestoneTrackerState>(
  (set, get) => ({
    seen: new Set<string>(),
    hydrated: false,

    reset: () => set({ seen: new Set<string>(), hydrated: false }),

    hydrate: async () => {
      const list = await load();
      set({ seen: new Set(list), hydrated: true });
    },

    newSince: (current) => {
      const s = get().seen;
      return current.filter((slug) => !s.has(slug));
    },

    markSeen: async (slugs) => {
      if (slugs.length === 0) return;
      const next = new Set(get().seen);
      slugs.forEach((s) => next.add(s));
      set({ seen: next });
      await save(next);
    },
  })
);
