/**
 * reelStore — per-user list of TMDB movies displayed as tile covers on
 * the Journey Reel screen. Server is the source of truth (synced via
 * /reel endpoints); we keep an in-memory copy for snappy renders.
 *
 * Order is purely add-order: position is assigned server-side as
 * max(position)+1 on insert.
 */

import { create } from 'zustand';
import { reelApi, type ReelMovieItem } from '../services/api';

interface ReelState {
  movies: ReelMovieItem[];
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

export const useReelStore = create<ReelState>((set, get) => ({
  movies: [],
  hydrated: false,
  loading: false,

  hydrate: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const movies = await reelApi.list();
      set({ movies, hydrated: true });
    } catch (e) {
      console.warn('[reelStore] hydrate failed:', e);
      set({ hydrated: true });
    } finally {
      set({ loading: false });
    }
  },

  add: async (input) => {
    if (get().has(input.tmdb_id)) return;

    // Optimistic insert at end with a tentative position.
    const tentativePos = get().movies.length;
    const optimistic: ReelMovieItem = {
      tmdb_id: input.tmdb_id,
      position: tentativePos,
      title: input.title,
      poster_path: input.poster_path,
      year: input.year,
    };
    set({ movies: [...get().movies, optimistic] });

    try {
      const saved = await reelApi.add(input);
      set({
        movies: get()
          .movies.map((m) => (m.tmdb_id === saved.tmdb_id ? saved : m))
          .sort((a, b) => a.position - b.position),
      });
    } catch (e) {
      console.warn('[reelStore] add failed, rolling back:', e);
      set({ movies: get().movies.filter((m) => m.tmdb_id !== input.tmdb_id) });
    }
  },

  remove: async (tmdbId) => {
    const before = get().movies;
    set({ movies: before.filter((m) => m.tmdb_id !== tmdbId) });
    try {
      await reelApi.remove(tmdbId);
      // Re-fetch so positions stay in sync with the server's repack.
      const fresh = await reelApi.list();
      set({ movies: fresh });
    } catch (e) {
      console.warn('[reelStore] remove failed, rolling back:', e);
      set({ movies: before });
    }
  },

  has: (tmdbId) => get().movies.some((m) => m.tmdb_id === tmdbId),

  reset: () => set({ movies: [], hydrated: false, loading: false }),
}));
