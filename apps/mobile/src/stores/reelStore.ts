/**
 * reelStore — combined "user picks + suggested" tile list for the
 * Journey Reel screen. Server is the source of truth (via /reel); we
 * keep an in-memory copy for snappy renders.
 *
 * The combined list is bottom-of-reel → top-of-reel: user picks
 * (most-recently-added first) come first, then the curated suggested
 * zone. The screen reads `tiles` for rendering and `userPickCount`
 * to position the zone-boundary chips and the ＋ Add a film tile.
 */

import { create } from 'zustand';
import { reelApi, type ReelTile } from '../services/api';

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
      set({ tiles, userPickCount: countUserPicks(tiles), hydrated: true });
    } catch (e) {
      console.warn('[reelStore] hydrate failed:', e);
      set({ hydrated: true });
    } finally {
      set({ loading: false });
    }
  },

  add: async (input) => {
    if (get().has(input.tmdb_id)) return;

    try {
      await reelApi.add(input);
      // Server is authoritative on ordering (user picks DESC by added_at,
      // suggested may also have shifted to exclude the new pick). Refetch.
      const { tiles } = await reelApi.list();
      set({ tiles, userPickCount: countUserPicks(tiles) });
    } catch (e) {
      console.warn('[reelStore] add failed:', e);
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

  reset: () => set({ tiles: [], userPickCount: 0, hydrated: false, loading: false }),
}));
