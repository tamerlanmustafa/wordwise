/**
 * Watch Later store — frontend-only for now (Phase 1). Persists a list of
 * movies the user wants to prep for, keyed by our internal `movieId`. The
 * Journey screen reads this store to generate per-movie sections.
 *
 * Phase 2 will swap the AsyncStorage layer for a real backend endpoint
 * (`/user/movies/watch-later`), but this keeps the shape the same so the
 * consuming components don't have to change.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface WatchLaterMovie {
  movieId: number;               // internal Movie.id
  tmdbId?: number;
  title: string;
  posterPath: string | null;     // TMDB poster_path (e.g. "/abc.jpg")
  backdropPath: string | null;   // TMDB backdrop_path, used behind journey sections
  addedAt: number;               // unix ms
}

interface WatchLaterState {
  movies: WatchLaterMovie[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  has: (movieId: number) => boolean;
  add: (movie: Omit<WatchLaterMovie, 'addedAt'>) => Promise<void>;
  remove: (movieId: number) => Promise<void>;
  toggle: (movie: Omit<WatchLaterMovie, 'addedAt'>) => Promise<void>;
}

const STORAGE_KEY = 'watchLater.movies.v1';

async function persist(movies: WatchLaterMovie[]) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(movies));
  } catch (e) {
    console.warn('[watchLaterStore] persist failed:', e);
  }
}

export const useWatchLaterStore = create<WatchLaterState>((set, get) => ({
  movies: [],
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as WatchLaterMovie[];
        set({ movies: parsed, hydrated: true });
        return;
      }
    } catch (e) {
      console.warn('[watchLaterStore] hydrate failed:', e);
    }
    set({ hydrated: true });
  },

  has: (movieId) => get().movies.some((m) => m.movieId === movieId),

  add: async (movie) => {
    const { movies } = get();
    if (movies.some((m) => m.movieId === movie.movieId)) return;
    const next: WatchLaterMovie[] = [...movies, { ...movie, addedAt: Date.now() }];
    set({ movies: next });
    await persist(next);
  },

  remove: async (movieId) => {
    const next = get().movies.filter((m) => m.movieId !== movieId);
    set({ movies: next });
    await persist(next);
  },

  toggle: async (movie) => {
    const state = get();
    if (state.has(movie.movieId)) {
      await state.remove(movie.movieId);
    } else {
      await state.add(movie);
    }
  },
}));
