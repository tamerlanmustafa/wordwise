/**
 * Reel API — the user's "My Movies" library.
 *
 * Mirrors apps/mobile/src/services/api.ts → reelApi so screens ported
 * from mobile can swap import paths only. Backed by the shared
 * `apiClient` (axios) which handles auth + token refresh.
 *
 * Endpoints: backend/src/routes/reel.py
 *   GET    /reel?cursor&limit       → list
 *   POST   /reel                    → add
 *   DELETE /reel/{tmdb_id}          → remove
 *   POST   /reel/seed               → idempotent first-launch seed
 */

import { apiClient } from './api';

export type ReelTileSource = 'user' | 'suggested';

export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export interface ReelTile {
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  year: number | null;
  source: ReelTileSource;
  status?: 'unstudied' | 'studied' | 'mastered';
  comprehensibility_percent?: number;
  cefr_level?: CefrLevel | null;
  /** Internal Movie.id when we have a matching catalog row. */
  movie_id?: number | null;
}

export interface ReelListResponse {
  tiles: ReelTile[];
  has_more: boolean;
}

export interface ReelSeedResponse {
  seeded: number;
  tiles: ReelTile[];
}

export const reelApi = {
  list: async (cursor = 0, limit = 60): Promise<ReelListResponse> => {
    const res = await apiClient.get<ReelListResponse>(
      `/reel?cursor=${cursor}&limit=${limit}`,
    );
    return res.data;
  },

  add: async (input: {
    tmdb_id: number;
    title: string;
    poster_path: string | null;
    year: number | null;
  }): Promise<ReelTile> => {
    const res = await apiClient.post<ReelTile>(`/reel`, input);
    return res.data;
  },

  remove: async (tmdbId: number): Promise<void> => {
    await apiClient.delete(`/reel/${tmdbId}`);
  },

  /** Idempotent first-launch bootstrap. Returns the user's reel; if it
   *  was empty, the server seeds a starter set in their CEFR band first. */
  seed: async (): Promise<ReelSeedResponse> => {
    const res = await apiClient.post<ReelSeedResponse>(`/reel/seed`);
    return res.data;
  },
};
