/**
 * addFilmStore — request bus for the "add a film → analyze" flow (Add-a-film
 * §B). A screen calls `request(film)` to kick off the branded analyzing
 * checklist + reel-ready overlay (rendered globally by AddFilmFlow); the
 * overlay consumes `pending`, clears it, and owns the rest.
 *
 * Kept intentionally tiny + timer-free (pacing lives in the component). Not
 * persisted — it's a transient request.
 */

import { create } from 'zustand';

export interface AddFilmInput {
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  year: number | null;
}

interface AddFilmState {
  pending: AddFilmInput | null;
  /** Ask the global overlay to add + analyze this film. */
  request: (film: AddFilmInput) => void;
  /** The overlay clears the request once it has taken ownership. */
  clear: () => void;
}

export const useAddFilmStore = create<AddFilmState>((set) => ({
  pending: null,
  request: (film) => set({ pending: film }),
  clear: () => set({ pending: null }),
}));

/** Convenience: request from non-React code without subscribing. */
export function requestAddFilm(film: AddFilmInput): void {
  useAddFilmStore.getState().request(film);
}
