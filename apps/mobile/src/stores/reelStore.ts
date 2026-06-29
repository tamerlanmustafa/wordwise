/**
 * reelStore — the user's personal reel queue. The reel is purely
 * user-curated; the server has no suggested zone. New users get a
 * starter set via POST /reel/seed on first hydrate (auto-called when
 * hydrate finds an empty list).
 *
 * Tiles are ordered bottom-of-reel → top-of-reel by added_at DESC, so
 * the most-recently-added movie sits at idx 0 (closest to the user).
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reelApi, type ReelTile } from '../services/api';
import { showToast } from './toastStore';

// Sticky flag: once the user has been seeded a starter reel (or has
// added their own first movie), we never auto-seed again. Without
// this, a user who deliberately empties their reel would get fresh
// starter movies on the next hydrate.
const SEED_DONE_KEY = 'journey.reelSeedDone.v1';

interface ReelState {
  tiles: ReelTile[];
  userPickCount: number;
  hydrated: boolean;
  loading: boolean;
  // True when the last hydrate failed to reach the server (e.g. network
  // error or an auth failure that even a token refresh couldn't fix). The
  // UI must treat this differently from a genuinely empty reel — an empty
  // `tiles` here means "we don't know", not "you have no movies".
  loadError: boolean;
  hydrate: () => Promise<void>;
  add: (input: {
    tmdb_id: number;
    title: string;
    poster_path: string | null;
    year: number | null;
  }) => Promise<void>;
  remove: (tmdbId: number) => Promise<void>;
  has: (tmdbId: number) => boolean;
  reset: () => void;
}

function countUserPicks(tiles: ReelTile[]): number {
  return tiles.reduce((n, t) => n + (t.source === 'user' ? 1 : 0), 0);
}

export const useReelStore = create<ReelState>((set, get) => ({
  tiles: [],
  userPickCount: 0,
  hydrated: false,
  loading: false,
  loadError: false,

  hydrate: async () => {
    if (get().loading) return;
    set({ loading: true, loadError: false });
    try {
      const { tiles } = await reelApi.list();
      const seedDone = await AsyncStorage.getItem(SEED_DONE_KEY);
      if (tiles.length === 0 && !seedDone) {
        // First-launch bootstrap: ask the server to seed starter movies
        // in the user's CEFR band. We only attempt this when the user
        // has never been seeded before; otherwise an empty reel is a
        // deliberate choice (the user emptied it).
        try {
          const { tiles: seeded } = await reelApi.seed();
          await AsyncStorage.setItem(SEED_DONE_KEY, '1');
          set({ tiles: seeded, userPickCount: countUserPicks(seeded), hydrated: true });
          return;
        } catch (seedErr) {
          console.warn('[reelStore] seed failed:', seedErr);
        }
      } else if (tiles.length > 0 && !seedDone) {
        // Existing user (had movies before this flag existed) — mark
        // the seed as done so we don't seed over their current reel
        // if they ever empty it.
        AsyncStorage.setItem(SEED_DONE_KEY, '1').catch(() => {});
      }
      set({ tiles, userPickCount: countUserPicks(tiles), hydrated: true });
    } catch (e) {
      // Mark the load as failed rather than leaving an empty `tiles` that
      // looks identical to "you have no movies". `hydrated` still flips to
      // true so screens stop showing spinners, but `loadError` lets them
      // offer a retry instead of lying about an empty reel.
      console.warn('[reelStore] hydrate failed:', e);
      set({ hydrated: true, loadError: true });
    } finally {
      set({ loading: false });
    }
  },

  add: async (input) => {
    if (get().has(input.tmdb_id)) return;

    // Optimistic insert at the top of the reel so the home → reel
    // animation has something to land on immediately.
    const optimisticTile: ReelTile = {
      tmdb_id: input.tmdb_id,
      title: input.title,
      poster_path: input.poster_path,
      year: input.year,
      source: 'user',
    };
    const before = get().tiles;
    set({
      tiles: [optimisticTile, ...before],
      userPickCount: get().userPickCount + 1,
    });

    try {
      await reelApi.add(input);
      // A successful manual add also counts as "user has a reel" — set
      // the flag so we never auto-seed over their explicit choices.
      AsyncStorage.setItem(SEED_DONE_KEY, '1').catch(() => {});
      const { tiles } = await reelApi.list();
      set({ tiles, userPickCount: countUserPicks(tiles) });
      showToast({ message: `${input.title} added to your reel`, tone: 'success' });
    } catch (e) {
      console.warn('[reelStore] add failed, rolling back:', e);
      set({ tiles: before, userPickCount: countUserPicks(before) });
      showToast({ message: "Couldn't add that film — try again", tone: 'error' });
    }
  },

  remove: async (tmdbId) => {
    const before = get().tiles;
    set({
      tiles: before.filter((t) => !(t.tmdb_id === tmdbId && t.source === 'user')),
      userPickCount: Math.max(0, get().userPickCount - 1),
    });
    try {
      await reelApi.remove(tmdbId);
      const { tiles } = await reelApi.list();
      set({ tiles, userPickCount: countUserPicks(tiles) });
    } catch (e) {
      console.warn('[reelStore] remove failed, rolling back:', e);
      set({ tiles: before, userPickCount: countUserPicks(before) });
    }
  },

  has: (tmdbId) =>
    get().tiles.some((t) => t.tmdb_id === tmdbId && t.source === 'user'),

  reset: () => set({ tiles: [], userPickCount: 0, hydrated: false, loading: false, loadError: false }),
}));
