/**
 * navBarMetrics — the bottom bar's geometry, as arithmetic rather than
 * measurement.
 *
 * The old bar was a flex child: it took whatever height its content needed and
 * reported that upward via `onLayout`. It is now an absolute overlay, which
 * changes who needs to know its size — every scroller underneath has to
 * reserve room for it, and it has to reserve the *same* amount whether the bar
 * is shown or retracted. A measured height cannot do that: while retracted it
 * would measure as retracted, every screen would reflow its padding, and the
 * content would visibly jump each time the user scrolled down. So the reserved
 * height is computed and stays constant, and the retract is a pure transform
 * that does not touch layout at all.
 *
 * Two shapes, because only iOS 26 gets the glass treatment:
 *
 *   - `floating: true`  — the Liquid Glass capsule, inset from all three
 *     edges, with content scrolling underneath it.
 *   - `floating: false` — Android and iOS < 26 keep the original bar: full
 *     width, pinned to the bottom, opaque, content stopping right above it.
 *     Same numbers as the pre-glass bar, so nothing moves on those devices.
 *
 * Keeping this here (rather than inline in the component) also means it can be
 * checked on device sizes nobody has to boot — same reasoning as deckMetrics.
 */

/** Icon glyph, matching NavIcon's 22pt box. */
const ICON = 22;
/** Gap between icon and label. */
const GAP = 4;
/** A 10px/800 label's line box. */
const LABEL = 13;

/** Breathing room inside the floating capsule, above icon and below label. */
const CAPSULE_PAD_V = 11;
/** Capsule height — fixed, so the pill radius is stable across devices. */
export const CAPSULE_HEIGHT = ICON + GAP + LABEL + CAPSULE_PAD_V * 2; // 61
/** Inset from the screen's left/right edges. */
export const SIDE_MARGIN = 14;
/** Clear space between the capsule and the content above it. */
export const TOP_GAP = 8;

/** The pinned bar's top padding — unchanged from the original bar. */
const PINNED_PAD_TOP = 8;
/** The pinned bar's minimum bottom padding — unchanged from the original. */
const PINNED_PAD_BOTTOM = 18;

/**
 * Gap under the floating capsule. On a device with a home indicator the full
 * 34pt inset would float the bar conspicuously high, so we sit inside it and
 * let the glass overlap the indicator's outer margin the way iOS 26's own bars
 * do. On a flat-bottomed device (SE) there is no inset to borrow from, so use
 * a plain margin.
 */
export function bottomMarginFor(insetBottom: number): number {
  return insetBottom > 0 ? Math.max(insetBottom - 12, 10) : 12;
}

export interface NavBarMetrics {
  /** Whether this is the floating glass capsule or the pinned opaque bar. */
  floating: boolean;
  /** Height of the bar's own body (capsule, or pinned bar including its
   *  safe-area padding). */
  barHeight: number;
  /** Gap between the bar's underside and the screen edge. Zero when pinned. */
  bottomMargin: number;
  /** Inset from the left/right screen edges. Zero when pinned. */
  sideMargin: number;
  /**
   * Vertical space a scroller must leave free at its bottom so its last row
   * clears the bar. Constant regardless of collapse state — see the note above.
   */
  reservedHeight: number;
  /** How far to slide the bar down to take it fully off screen. */
  hiddenTranslateY: number;
  /** Corner radius. A true pill when floating, square when pinned. */
  radius: number;
  /** Padding inside the bar body, above the icons. */
  padTop: number;
  /** Padding inside the bar body, below the labels. */
  padBottom: number;
}

export function navBarMetrics(insetBottom: number, floating: boolean): NavBarMetrics {
  if (!floating) {
    const padBottom = Math.max(PINNED_PAD_BOTTOM, insetBottom);
    const barHeight = PINNED_PAD_TOP + ICON + GAP + LABEL + padBottom;
    return {
      floating: false,
      barHeight,
      bottomMargin: 0,
      sideMargin: 0,
      reservedHeight: barHeight,
      hiddenTranslateY: barHeight,
      radius: 0,
      padTop: PINNED_PAD_TOP,
      padBottom,
    };
  }

  const bottomMargin = bottomMarginFor(insetBottom);
  return {
    floating: true,
    barHeight: CAPSULE_HEIGHT,
    bottomMargin,
    sideMargin: SIDE_MARGIN,
    reservedHeight: CAPSULE_HEIGHT + bottomMargin + TOP_GAP,
    // A little past its own footprint so the shadow clears the screen too.
    hiddenTranslateY: CAPSULE_HEIGHT + bottomMargin + 12,
    radius: CAPSULE_HEIGHT / 2,
    padTop: CAPSULE_PAD_V,
    padBottom: CAPSULE_PAD_V,
  };
}

/** Vertical inset of the active lens inside the capsule. */
export const LENS_INSET_V = 6;
/** Horizontal inset of the active lens inside its cell. */
export const LENS_INSET_H = 5;

/** A tab cell's measured frame, as reported by its own onLayout. */
export interface CellFrame {
  x: number;
  width: number;
}

/**
 * Where the active-tab lens sits, given the active cell's *measured* frame.
 *
 * Deliberately measured rather than computed as `activeIndex * (rowWidth /
 * tabCount)`. Under RTL, `flexDirection: 'row'` reverses on its own, so tab 0
 * is drawn at the right-hand edge — index arithmetic would put the lens under
 * Profile while the user is on Home, and it would look perfectly correct in
 * every LTR test. Reading the frame back from layout is right in both
 * directions because React Native's layout coordinates are physical
 * (left-origin) regardless of reading direction, which is also what makes the
 * `left: 0` + translateX pairing in the component correct.
 *
 * Returns null before layout (width 0 on the first frame) and when no tab is
 * active — on a deep screen like a movie detail there is no selected tab, and
 * a lens parked under an arbitrary cell would claim the user is somewhere they
 * are not.
 */
export function lensGeometry(cell: CellFrame | undefined | null): CellFrame | null {
  if (!cell || cell.width <= 0) return null;
  // On a very narrow cell the insets could eat the whole width; clamp so the
  // lens degrades to a sliver rather than inverting.
  const width = Math.max(0, cell.width - LENS_INSET_H * 2);
  if (width <= 0) return null;
  return { width, x: cell.x + LENS_INSET_H };
}
