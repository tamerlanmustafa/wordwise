/**
 * pathCentering — where the Practice path scrolls to, and when to offer a way
 * back.
 *
 * The tab opens with the active tile in the middle of the part of the scroller
 * the user can actually see. "Visible" excludes the bottom bar: it is drawn
 * over the scroller rather than beside it (see CLAUDE.md, "Every screen clears
 * the bottom bar"), so the middle of the scroller's own box is lower than the
 * middle of what is on screen by half the bar.
 *
 * Pure, so the arithmetic is tested without a device. The one input that has
 * to be measured is the scroller's height; everything about the path itself is
 * a constant (see `activeTileCenterY`).
 */

export interface PathViewport {
  /** The scroller's own height. 0 until it has laid out. */
  height: number;
  /** How much of its bottom the bar covers. */
  bottomObstruction: number;
}

function visibleHeight(v: PathViewport): number {
  return Math.max(0, v.height - v.bottomObstruction);
}

/**
 * The scroll offset that puts a point of the content — the active tile's
 * centre — in the middle of the visible area. Never negative: a path too short
 * to reach the middle rests at the top rather than asking for an offset the
 * scroller cannot take.
 */
export function centeredOffset(centerY: number, v: PathViewport): number {
  return Math.max(0, centerY - visibleHeight(v) / 2);
}

/**
 * Bottom padding for the scroll content, so the active tile can reach the
 * middle even with little or nothing below it.
 *
 * A returning user has a whole buffer of completed tiles under the active one
 * and needs only the usual clearance. A new user has none, and without this
 * the scroller would stop with the active tile pinned near the bottom — the
 * offset `centeredOffset` asks for would be past the end of the content.
 *
 * @param belowCenter content below the tile's centre, excluding this padding
 * @param minimum     the padding the screen would use anyway
 */
export function bottomRunway(belowCenter: number, v: PathViewport, minimum: number): number {
  if (v.height <= 0) return minimum;
  const needed = visibleHeight(v) / 2 + v.bottomObstruction - belowCenter;
  return Math.max(minimum, Math.ceil(needed));
}

/** Where the active tile is, relative to what is on screen. */
export type TileSide = 'above' | 'below' | null;

/**
 * Which side of the visible area the active tile has left by, or null while
 * any of it is still on screen.
 *
 * "Entirely out of view" rather than "not centred": the way back is for a user
 * who has lost the tile, not one who nudged the path a little. `above` means
 * they scrolled down into their history; `below` means they climbed up the
 * road ahead.
 */
export function activeTileSide(
  scrollY: number,
  centerY: number,
  tileHeight: number,
  v: PathViewport,
): TileSide {
  if (v.height <= 0) return null;
  const top = centerY - tileHeight / 2;
  const bottom = centerY + tileHeight / 2;
  if (bottom <= scrollY) return 'above';
  if (top >= scrollY + visibleHeight(v)) return 'below';
  return null;
}
