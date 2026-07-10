/**
 * Watched / Not-interested API — home-feed actions (web parity with the
 * mobile swipe). Mirrors apps/mobile/src/services/api.ts → watchedApi.
 * Backed by the shared `apiClient` (axios) which handles auth + refresh.
 *
 * Endpoints: backend/src/routes/movies.py
 *   GET    /movies/watched        → list the Watched films
 *   POST   /movies/watched        → mark watched
 *   DELETE /movies/watched/{id}   → un-watch
 *   GET    /movies/hidden         → hidden tmdb ids (web filters client-side)
 *   POST   /movies/hidden         → hide ("not interested")
 *   DELETE /movies/hidden/{id}    → un-hide
 */

import { apiClient } from './api';

export interface WatchedMovie {
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  year: number | null;
}

export const watchedApi = {
  listWatched: async (): Promise<WatchedMovie[]> => {
    const res = await apiClient.get<{ movies: WatchedMovie[] }>('/movies/watched');
    return res.data.movies;
  },

  markWatched: async (input: WatchedMovie): Promise<WatchedMovie> => {
    const res = await apiClient.post<WatchedMovie>('/movies/watched', input);
    return res.data;
  },

  unmarkWatched: async (tmdbId: number): Promise<void> => {
    await apiClient.delete(`/movies/watched/${tmdbId}`);
  },

  /** Hidden ("not interested") tmdb ids — the web feed (TMDB top-rated)
   *  filters these client-side since it doesn't use the CEFR query. */
  listHiddenIds: async (): Promise<number[]> => {
    const res = await apiClient.get<{ tmdb_ids: number[] }>('/movies/hidden');
    return res.data.tmdb_ids;
  },

  hide: async (tmdbId: number): Promise<void> => {
    await apiClient.post('/movies/hidden', { tmdb_id: tmdbId });
  },

  unhide: async (tmdbId: number): Promise<void> => {
    await apiClient.delete(`/movies/hidden/${tmdbId}`);
  },
};
