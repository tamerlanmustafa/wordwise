/**
 * tileVisuals — what a practice tile looks like, given only its state.
 *
 * Pulled out of the component because it is the whole design now. The path
 * used to say everything twice: a check glyph on completed tiles and a START
 * callout on the active one, layered on colours that already made both
 * obvious. And because every lesson is the same lesson, every tile carried
 * the same speech bubble — a glyph that distinguished nothing, sitting on the
 * one surface the design is actually about.
 *
 * So colour carries the state on its own: green behind you, gold under your
 * feet, stone ahead. Nothing is labelled. That puts real weight on this
 * mapping being right, which is why it is a pure function with tests rather
 * than three nested ternaries inside a render.
 *
 * The one surviving glyph is the alarm on `repair`, which is not a position
 * on the path but an interruption to it.
 */

import type { ThemeColors } from '../../theme/tokens';
import type { PracticeTileState } from './PracticeTile';

export interface TileVisual {
  /** Base colour of the coin's face. `TileCoin` lights the top and shades the
   *  bottom from this one token, so a state needs exactly one colour to get
   *  its full three-tone ramp. */
  face: string;
  /** The extruded lip below the face. Always darker than the face — that
   *  difference *is* the thickness of the coin. */
  edge: string;
  /** Matte surface: no specular gloss, minimal rim. */
  matte: boolean;
  /** Centre glyph, or null for a bare face. */
  glyph: 'alarm' | null;
  /** Slightly receded, for tiles the user has already walked past. */
  faded: boolean;
}

export function tileVisual(state: PracticeTileState, tc: ThemeColors): TileVisual {
  switch (state) {
    case 'repair':
      return { face: tc.error, edge: tc.nodeRepairEdge, matte: false, glyph: 'alarm', faded: false };
    case 'completed':
      return { face: tc.nodeDone, edge: tc.nodeDoneEdge, matte: false, glyph: null, faded: true };
    case 'active':
      return { face: tc.gold, edge: tc.nodeGoldEdge, matte: false, glyph: null, faded: false };
    case 'locked':
    default:
      // Locked tiles keep full opacity despite being matte: their colours are
      // already dim, and fading them on top of that made the road ahead
      // disappear rather than recede.
      return { face: tc.nodeLocked, edge: tc.nodeLockedEdge, matte: true, glyph: null, faded: false };
  }
}
