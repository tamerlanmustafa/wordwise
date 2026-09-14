/**
 * streakSnapshotStore — the last `/daily/state` this account saw, in memory
 * before the Practice tab is ever opened.
 *
 * Exists so the streak panel's first frame is the panel the user last saw,
 * rather than "0 DAYS · 0/0 FREEZES" over seven empty circles for as long as a
 * round trip takes. See `components/practice/streakSnapshot` for the measured
 * bug and for how a snapshot from an earlier day is carried to today.
 *
 * ## Why a store, and why it hydrates at launch
 *
 * The Practice tab mounts lazily, on its first tap. A disk read started THERE
 * would still resolve a frame after the first paint — the same flash, shorter.
 * So App hydrates this at launch alongside the other account stores, and by
 * the time anyone can reach the tab the snapshot is already in memory. A store
 * rather than a module variable so that the rare tap that does beat the disk
 * read still re-renders the moment it lands.
 *
 * ## Account-scoped, by construction
 *
 * Persisted through `swrCache`, whose `swr_` prefix is an account-key family in
 * `services/accountState` — so sign-out deletes it from disk, and `reset` (in
 * `resetAccountStores`) drops it from memory. The next account to sign in on
 * this phone must not open Practice to someone else's streak.
 */

import { create } from 'zustand';

import type { DailyState } from '../services/api';
import { readCache, writeCache } from '../services/swrCache';
import { localIsoDate, type StreakSnapshot } from '../components/practice/streakSnapshot';

const SNAPSHOT_KEY = 'practice.streakSnapshot.v1';

/**
 * How long a snapshot is worth showing at all.
 *
 * Carrying forward is honest for a day or a week — the counts are the last
 * known ones and the calendar does the rest. After a month away the number is
 * more likely to mislead than to help, and a loading placeholder is the
 * truthful thing to draw.
 */
const SNAPSHOT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

interface StreakSnapshotState {
  snapshot: StreakSnapshot | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** Record a fresh response: in memory now, on disk without waiting. */
  remember: (state: DailyState, now?: Date) => void;
  reset: () => void;
}

export const useStreakSnapshotStore = create<StreakSnapshotState>((set, get) => ({
  snapshot: null,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const cached = await readCache<StreakSnapshot>(SNAPSHOT_KEY, SNAPSHOT_TTL_MS);
    // A live response may have landed while the disk read was in flight; it
    // is newer by definition, so the disk copy must not replace it.
    const valid =
      cached && typeof cached.fetchedOn === 'string' && cached.state && typeof cached.state.streak === 'number';
    set({ hydrated: true, ...(valid && !get().snapshot ? { snapshot: cached } : {}) });
  },

  remember: (state, now = new Date()) => {
    const snapshot: StreakSnapshot = { state, fetchedOn: localIsoDate(now) };
    set({ snapshot, hydrated: true });
    void writeCache(SNAPSHOT_KEY, snapshot);
  },

  reset: () => set({ snapshot: null, hydrated: false }),
}));
