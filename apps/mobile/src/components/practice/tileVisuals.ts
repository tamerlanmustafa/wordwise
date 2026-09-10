/**
 * tileVisuals — what a practice tile looks like, given only its state.
 *
 * Pulled out of the component because it is the whole design now. Colour
 * carries the state — green behind you, gold under your feet, stone ahead —
 * and this is the mapping, kept as a pure function with tests rather than
 * three nested ternaries inside a render.
 *
 * ## The two depth values
 *
 * A tile is a stair tread, and the thing that makes a stack of treads read as
 * a *flight* is not the riser under each one — it is the shadow the step above
 * casts down onto the step below, plus the lit front lip of the tread catching
 * the light that shadow is blocking. Both are per-state, because a tile in
 * shadow ahead of you and a tile lit under your feet are not equally exposed:
 *
 *   • `band`   — how black the occlusion band across the top of the tread is.
 *                Heaviest on the road ahead (which should recede), lightest on
 *                the tile in focus (which should not).
 *   • `nosing` — how bright the lit lip along the tread's front edge is. The
 *                exact inverse, and for the same reason.
 *
 * They are stored as alphas rather than colours because the path multiplies
 * both by one `depth` dial (see `TilePill`), and because the band is always
 * black and the nosing always white — a cast shadow and a caught highlight are
 * not palette decisions.
 *
 * ## One palette, both appearances
 *
 * The tiles do not follow the theme. Stone, gold and green are the same
 * colours on a cream page as on a black one, taken from `themes.dark` — the
 * appearance they were designed against and the only one they were ever tuned
 * in.
 *
 * That is a decision about *what a tile is* rather than about contrast. The
 * flight is an object sitting on the page, like a photograph or a poster is,
 * and a photograph does not invert when the room lights come on. The path
 * around it still themes: the backdrop, the streak pills and the bottom bar
 * all follow the appearance, and the flight reads as something placed on top
 * of them.
 *
 * It also makes the depth values honest again. `band` and `nosing` are alphas,
 * and black at alpha `a` over a face is arithmetically `face × (1 - a)` — a
 * fixed *proportion* of whatever it lands on, not a fixed amount of darkness.
 * When the faces differed by theme the same alpha was two different shadows,
 * and 0.85 over the light theme's cream was a black smear rather than a cast
 * edge. With one set of faces there is one set of alphas, and they mean the
 * same thing wherever they land.
 *
 * ## Marks
 *
 * Separate from the colour, and deliberately quiet: a groove cut into the
 * tread rather than a glyph printed on it. See {@link tileMark} for which
 * state gets which, and `TileMarks` for how a groove is drawn.
 *
 * The one flat glyph left is the alarm on `repair`, which is not a position on
 * the path but an interruption to it.
 */

import { shade, themes } from '../../theme/tokens';
import type { PracticeTileState } from './PracticeTile';

/**
 * The two depth cues, per state. `locked` > `completed` > `active` on the band
 * (the road ahead recedes hardest, the tile under your feet least), and the
 * exact inverse on the nosing. A test pins that ordering, so a future re-tune
 * can move the numbers but not the meaning.
 */
const DEPTH: Record<PracticeTileState, { band: number; nosing: number }> = {
  // Lit like the focused tile — it is asking for the same thing.
  repair: { band: 0.4, nosing: 0.5 },
  completed: { band: 0.55, nosing: 0.28 },
  active: { band: 0.4, nosing: 0.5 },
  // The heaviest band and the barely-there nosing are what make the road
  // ahead recede.
  locked: { band: 0.85, nosing: 0.09 },
};

/**
 * The tile palette, fixed to the dark theme in both appearances.
 *
 * Read from `themes.dark` rather than copied out of it, so retuning the dark
 * palette's green retunes the tiles with it — they are not a separate design,
 * they are that one, used everywhere.
 */
const TILE_PALETTE = themes.dark;

/**
 * How much darker than its own face a groove's floor sits.
 *
 * Lives here rather than next to the check it was written for, because the
 * lesson number now shares it: both are cut into the same stone by the same
 * light, and two constants that must agree are one constant. `TileMarks`
 * imports it — the other direction would be a cycle, since this file is what
 * `TileMarks` asks for its inks.
 */
export const CHECK_FLOOR_DARKEN = 0.14;

/**
 * How much darker the completed tile's *number* is cut than its check.
 *
 * Deliberately not `CHECK_FLOOR_DARKEN`, and the difference is optical rather
 * than aesthetic: ink depth buys contrast in proportion to how much of it is
 * on the surface, and a 12pt numeral puts a fraction of the check's 2.9-wide
 * stroke on the tread. Matched to the check the two looked identical in the
 * palette and nothing alike on a phone — the number read on gold and on stone
 * and vanished on green, because green is the one face the shallow darkening
 * barely moves. This is the depth at which all three states read alike.
 *
 * The lesson generalises past this tile: the same colour at two stroke widths
 * is two different contrasts, so a value tuned on a thick mark cannot be
 * inherited by a thin one.
 */
const DONE_NUMBER_DARKEN = 0.34;

export interface TileVisual {
  /** Flat colour of the tile's face. */
  face: string;
  /** The edge below the face — the riser. Always darker than the face; that
   *  difference *is* the thickness. `TilePill` grades it darker still toward
   *  the foot, so the riser falls away rather than sitting flat. */
  edge: string;
  /** Alpha of the black occlusion band across the top of the tread — the
   *  shadow the step above casts down onto this one. */
  band: number;
  /** Alpha of the white nosing along the tread's front lip. */
  nosing: number;
  /**
   * Floor colour for text cut into the tread — the lesson number, and START.
   *
   * The tile's own face in shadow rather than a palette entry of its own,
   * which is what keeps an engraved numeral reading as part of the stone. Per
   * state because the faces are nowhere near each other in lightness: the same
   * ink that is legible on gold disappears on the locked tile's stone, and a
   * groove on a near-black face has no room to go darker at all — there the
   * lit lower lip is doing the work, exactly as it does for the lock.
   */
  markInk: string;
  /** Centre glyph, or null for a bare face. */
  glyph: 'alarm' | null;
  /** Slightly receded, for tiles the user has already walked past. */
  faded: boolean;
}

/**
 * Takes no palette and no scheme, and that absence is the point: a practice
 * tile looks the same in both appearances, so there is nothing for a caller to
 * get wrong by passing the wrong one.
 */
export function tileVisual(state: PracticeTileState): TileVisual {
  const tc = TILE_PALETTE;
  const depth = DEPTH[state] ?? DEPTH.locked;
  switch (state) {
    case 'repair':
      // Lit like the focused tile, because it is asking for the same thing:
      // a tile the user is meant to act on now, not one to walk past.
      return {
        face: tc.error,
        edge: tc.nodeRepairEdge,
        band: depth.band,
        nosing: depth.nosing,
        markInk: shade(tc.error, -0.4),
        glyph: 'alarm',
        faded: false,
      };
    case 'completed':
      return {
        face: tc.nodeDone,
        edge: tc.nodeDoneEdge,
        band: depth.band,
        nosing: depth.nosing,
        markInk: shade(tc.nodeDone, -DONE_NUMBER_DARKEN),
        glyph: null,
        faded: true,
      };
    case 'active':
      return {
        face: tc.gold,
        edge: tc.nodeGoldEdge,
        band: depth.band,
        nosing: depth.nosing,
        // Shared with the START label on this same tile — `goldDeep` is the
        // palette's dark-text-on-gold, which is exactly this job.
        markInk: tc.goldDeep,
        glyph: null,
        faded: false,
      };
    case 'locked':
    default:
      // Locked tiles keep full opacity: their colours are already dim, and
      // fading them on top of that made the road ahead disappear rather than
      // recede. The band and the nosing do the receding instead, which reads
      // as distance rather than as transparency.
      return {
        face: tc.nodeLocked,
        edge: tc.nodeLockedEdge,
        band: depth.band,
        nosing: depth.nosing,
        // Deeper than the others because the locked face is the darkest, and
        // a shallow darkening of near-black is no groove at all. On the dark
        // theme this bottoms out and the lit lower lip carries the numeral —
        // the same trade the lock makes two lines down the tread.
        markInk: shade(tc.nodeLocked, -0.45),
        glyph: null,
        faded: false,
      };
  }
}

/** The groove cut into a tread, or null for a bare one. */
export type TileMark = 'check' | 'start' | 'lock' | null;

export interface TileMarkOptions {
  /** The one locked tile directly above the active one. */
  nextUp?: boolean;
  /** When false, only `nextUp` carries a lock and the rest of the road ahead
   *  stays bare. */
  marksOnAllLocked?: boolean;
}

/**
 * Which mark a tile carries.
 *
 * Split from {@link tileVisual} because a mark is not purely a function of
 * state: whether a locked tile shows its lock is a decision about the *path* —
 * how loud the road ahead should be — and the path is what knows it. Keeping
 * that policy out of the colour mapping is what stops `tileVisual` from
 * needing to be told about the cursor.
 */
export function tileMark(
  state: PracticeTileState,
  { nextUp = false, marksOnAllLocked = true }: TileMarkOptions = {},
): TileMark {
  switch (state) {
    case 'completed':
      return 'check';
    case 'active':
      return 'start';
    case 'locked':
      return marksOnAllLocked || nextUp ? 'lock' : null;
    // `repair` already carries the alarm. A second mark on the one tile that
    // is an interruption rather than a position would say it twice.
    default:
      return null;
  }
}
