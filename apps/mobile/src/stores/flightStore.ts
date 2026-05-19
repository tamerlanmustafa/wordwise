/**
 * flightStore — coordinates the "poster flies to the reel tab" animation
 * triggered when the user adds a movie to their reel from the home feed.
 *
 * Two concerns:
 *   1. A single in-flight payload (`pending`): the spec for the next
 *      animation to play. Source rect comes from wherever the add was
 *      tapped (measured via measureInWindow); destination rect comes
 *      from `reelTabRect`, reported by GlobalBottomBar.
 *   2. A live `reelTabRect`: window-space rect of the Reel tab icon,
 *      kept up to date by GlobalBottomBar so PosterFlight can target it.
 *
 * The overlay (PosterFlight) reads `pending`, animates, then calls
 * `consume()` to clear it. We use an incrementing `id` so consecutive
 * flights for the same poster path retrigger the effect.
 */

import { create } from 'zustand';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlightSpec {
  id: number;
  posterPath: string | null;
  from: Rect;
}

interface FlightState {
  pending: FlightSpec | null;
  reelTabRect: Rect | null;
  setReelTabRect: (rect: Rect | null) => void;
  fly: (input: { posterPath: string | null; from: Rect }) => void;
  consume: () => void;
}

let _idCounter = 0;

export const useFlightStore = create<FlightState>((set) => ({
  pending: null,
  reelTabRect: null,

  setReelTabRect: (rect) => set({ reelTabRect: rect }),

  fly: ({ posterPath, from }) => {
    _idCounter += 1;
    set({ pending: { id: _idCounter, posterPath, from } });
  },

  consume: () => set({ pending: null }),
}));
