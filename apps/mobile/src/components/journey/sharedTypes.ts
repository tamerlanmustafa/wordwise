/**
 * Stable type re-exports for journey-adjacent components.
 *
 * The v0.7 redesign archives JourneyScreen.tsx (the zigzag reel) but
 * `MoviePreviewPayload` is still consumed by MyMoviesScreen, PracticeScreen,
 * MoviePreviewHub and App.tsx. Re-housing it here means archiving the
 * reel doesn't ripple through every screen.
 *
 * `NodeLevel` lives in `./JourneyNode` and is still in use by
 * QuizJourneyScreen (the per-movie quiz path), so we re-export it
 * here as a convenience without moving its definition.
 */

import type { ReelTile } from '../../services/api';

export type { NodeLevel } from './JourneyNode';

import type { NodeLevel } from './JourneyNode';

export interface MoviePreviewPayload {
  tileIndex: number;
  level: NodeLevel;
  tile: ReelTile;
}
