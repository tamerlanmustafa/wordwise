/**
 * reelStore — the user's personal reel queue ("My Movies").
 *
 * Mirrors apps/mobile/src/stores/reelStore.ts. Persistence swapped from
 * AsyncStorage → localStorage so the seed-done flag survives reload.
 *
 * Tiles are ordered most-recently-added first.
 */

import { create } from 'zustand';
import { reelApi, type ReelTile } from '../services/reelApi';

// Sticky flag: once the user has been seeded a starter reel (or has
// added their own first movie), we never auto-seed again. Without
// this, a user who deliberately empties their reel would get fresh
// starter movies on the next hydrate.
const SEED_DONE_KEY = 'journey.reelSeedDone.v1';

function readSeedDone(): boolean {
  try {
    return window.localStorage.getItem(SEED_DONE_KEY) === '1';
  } catch {
    return false;
  }
}
function writeSeedDone() {
  try {
    window.localStorage.setItem(SEED_DONE_KEY, '1');
  } catch {
    /* ignore quota / disabled */
  }
}

interface ReelState {
  tiles: ReelTile[];
  userPickCount: number;
  hydrated: boolean;
  loading: boolean;
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

  hydrate: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const { tiles } = await reelApi.list();
      const seedDone = readSeedDone();
      if (tiles.length === 0 && !seedDone) {
        // First-launch bootstrap: ask the server to seed starter movies
        // in the user's CEFR band. We only attempt this when the user
        // has never been seeded before; otherwise an empty reel is a
        // deliberate choice (the user emptied it).
        try {
          const { tiles: seeded } = await reelApi.seed();
          writeSeedDone();
          set({
            tiles: seeded,
            userPickCount: countUserPicks(seeded),
            hydrated: true,
          });
          return;
        } catch (seedErr) {
          console.warn('[reelStore] seed failed:', seedErr);
        }
      } else if (tiles.length > 0 && !seedDone) {
        // Existing user (had movies before this flag existed) — mark
        // the seed as done so we don't seed over their current reel
        // if they ever empty it.
        writeSeedDone();
      }
      set({
        tiles,
        userPickCount: countUserPicks(tiles),
        hydrated: true,
      });
    } catch (e) {
      console.warn('[reelStore] hydrate failed:', e);
      set({ hydrated: true });
    } finally {
      set({ loading: false });
    }
  },

  add: async (input) => {
    if (get().has(input.tmdb_id)) return;

    // Optimistic insert at the top of the reel.
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
      writeSeedDone();
      const { tiles } = await reelApi.list();
      set({ tiles, userPickCount: countUserPicks(tiles) });
    } catch (e) {
      console.warn('[reelStore] add failed, rolling back:', e);
      set({ tiles: before, userPickCount: countUserPicks(before) });
    }
  },

  remove: async (tmdbId) => {
    const before = get().tiles;
    set({
      tiles: before.filter(
        (t) => !(t.tmdb_id === tmdbId && t.source === 'user'),
      ),
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

  reset: () =>
    set({ tiles: [], userPickCount: 0, hydrated: false, loading: false }),
}));
