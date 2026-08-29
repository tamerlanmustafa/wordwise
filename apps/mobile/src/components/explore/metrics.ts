/**
 * Explore feed geometry, derived from the actual viewport.
 *
 * The design was measured on one tall phone (~770pt of usable height above
 * the tab bar), and the original implementation hard-coded those pixels: a
 * 285pt rail, a 150pt card lift, a 76pt rail lane. On a 4.7" phone that block
 * claims ~420pt of a ~477pt card, leaving almost nothing for the word, and the
 * lift can push it off the top of the screen.
 *
 * So the numbers become ratios of the measured card area, clamped so they
 * never exceed the design on a large screen or collapse on a small one.
 * On the reference device the ratios reproduce the original values; below
 * it, everything shrinks together and the rail stays proportional to the
 * panel it must align with.
 *
 * Pure on purpose — the layout is a function of the viewport, so it can be
 * tested without rendering anything.
 *
 * The load-bearing property is that the bands it returns *tile* the container
 * the screen measured: topSpacer + cardHeight + toastStrip + barSpacer is the
 * viewport, exactly. One card is one card-height, so any slack left in that sum
 * becomes a window onto the next card, and the feed stops being one word per
 * screen.
 *
 * The rail's horizontal position is likewise not a free choice: it is centred
 * on the last tab of the bottom bar, so `railEnd` is derived from the bar's
 * cell grid (`lastTabCentreFromEnd`) rather than being a taste-based inset.
 */

import { lastTabCentreFromEnd } from '../navBarMetrics';

/** Below this usable height a phone is "compact" (roughly 4.7"/5.5" class),
 *  and the fixed chrome gets trimmed rather than eating the card. */
const COMPACT_VIEWPORT = 620;

/** Share of the card area the action rail occupies. 285/662 on the
 *  reference device. */
const RAIL_HEIGHT_RATIO = 0.43;

/**
 * Clear space between the rail's bottom edge (the Share label) and the top of
 * the bottom bar's strip.
 *
 * The rail used to float at a *share of the card* — 132pt up on the reference
 * phone — which left it stranded in the middle of nowhere once the bar became a
 * floating capsule. It is now anchored to the bar, so this is a plain gap
 * rather than a ratio: the rail and the bar are two pieces of chrome stacked at
 * the bottom edge, and the distance between them should read the same on every
 * screen instead of growing with the phone.
 */
const RAIL_GAP = 12;
/** The same gap, trimmed on a compact screen — matches `railEnd`. */
const RAIL_GAP_COMPACT = 8;

/** How far the lifting group rises, as a share of the rail's height —
 *  the rail and the panel are the same height, so tying the lift to it
 *  keeps the word clearing the panel by the same margin everywhere. */
const LIFT_RATIO = 0.53;

/** Share of the screen width reserved as the rail's lane, so card text
 *  never runs under the glyphs. A floor — the lane also has to clear the
 *  rail's real extent, see `railLane` below. */
const RAIL_LANE_RATIO = 0.2;

/** Width of one rail button. ActionRail's `item` style reads this, so the
 *  column's width is stated once and the lane maths cannot drift from it. */
export const RAIL_ITEM_WIDTH = 56;

/** Clear space between the rail's inner edge and the card's text. */
const RAIL_LANE_GUTTER = 8;

export interface ExploreMetricsInput {
  /**
   * Measured height of the screen's own container — the whole thing, including
   * the strip the floating bottom bar hovers over.
   *
   * This is deliberately the *container*, not some pre-trimmed number the
   * caller worked out itself. When the bar became a floating overlay the caller
   * subtracted the bar's height here and then laid the parts back into the full
   * container, so the parts summed to less than the box they filled — and a
   * FlatList given a window taller than its item shows the top of the next one.
   * Feeding the raw container in and letting `barSpacer` come back out keeps
   * that subtraction in one place, where the test can assert it.
   */
  viewport: number;
  /** Screen width, for the rail lane. */
  width: number;
  /** Safe-area top inset. */
  topInset: number;
  /**
   * Height the floating bottom bar reserves. Explore is a snap pager, so the
   * card stops above the bar rather than running under it (see ExploreScreen).
   * Zero on the pinned bar, and before the bar has reported its height.
   */
  bottomOffset?: number;
  /**
   * The bottom bar's own side inset — `SIDE_MARGIN` for the floating capsule,
   * 0 for the pinned bar. Needed because the rail is aligned to the last tab,
   * and where that tab sits depends on how far the bar is inset from the edge.
   */
  barSideMargin?: number;
}

export interface ExploreMetrics {
  /** Clears the Dynamic Island / status bar. */
  topSpacer: number;
  /** Reserved so the surface never reflows when a toast comes and goes. */
  toastStrip: number;
  /** Clears the floating bottom bar. Mirrors `topSpacer` at the other end, so
   *  the four bands laid out by the screen add up to the container exactly. */
  barSpacer: number;
  /** One card = one viewport. */
  cardHeight: number;
  railHeight: number;
  /**
   * The rail's bottom edge, measured from the bottom of the *whole screen* —
   * not from the card, which stops a toast strip short of it. The rail and the
   * panels are overlays on the root for exactly this reason: they are pinned to
   * the bottom bar, so they must share its frame of reference.
   */
  railBottom: number;
  /**
   * The rail's inset from the logical end edge, chosen so its 56pt button
   * column is centred on the last tab of the bar below it. The rail and that
   * tab read as one vertical column, so a few points out looks like a mistake.
   */
  railEnd: number;
  /** Card's end padding and the panel's end inset — the rail's lane. */
  railLane: number;
  /** translateY applied to the card's lifting group when a panel opens. */
  cardLift: number;
}

/** Clamp, then round to a whole pixel. Rounding matters here: the rail and
 *  the panel must line up exactly, and a subpixel height leaves a blurred
 *  hairline where their edges meet. */
function scale(value: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(value, min), max));
}

export function exploreMetrics({
  viewport,
  width,
  topInset,
  bottomOffset = 0,
  barSideMargin = 0,
}: ExploreMetricsInput): ExploreMetrics {
  // The bar's strip is spoken for before anything else is sized, so a phone
  // whose *usable* height is compact gets the compact chrome even though its
  // screen is not.
  const barSpacer = Math.max(0, Math.min(bottomOffset, viewport));
  const usable = viewport - barSpacer;
  const compact = usable < COMPACT_VIEWPORT;

  // A device reporting a deeper inset (Dynamic Island) always wins over the
  // design floor — clearing the hardware matters more than the mockup.
  const topSpacer = Math.max(topInset, compact ? 44 : 62);
  const toastStrip = compact ? 38 : 46;
  const cardHeight = Math.max(0, usable - topSpacer - toastStrip);

  // The rail's height still scales with the card — it must leave the word
  // room — but its position is the bar's, not the card's.
  const railHeight = scale(cardHeight * RAIL_HEIGHT_RATIO, 190, 285);
  const railBottom = barSpacer + (compact ? RAIL_GAP_COMPACT : RAIL_GAP);
  const cardLift = scale(railHeight * LIFT_RATIO, 96, 150);

  // Centre the button column on the last tab. Floored at 0 so a freakishly
  // narrow screen pulls the rail flush to the edge rather than off it.
  const railEnd = Math.max(
    0,
    Math.round(lastTabCentreFromEnd(width, barSideMargin) - RAIL_ITEM_WIDTH / 2),
  );

  // The lane has to clear the rail wherever the alignment puts it, so the
  // ratio is only a floor. Deriving it from `railEnd` rather than hoping a
  // 20%-of-width guess still covers the column keeps the two from drifting
  // apart the next time either moves.
  const railLane = Math.max(
    scale(width * RAIL_LANE_RATIO, 66, 84),
    railEnd + RAIL_ITEM_WIDTH + RAIL_LANE_GUTTER,
  );

  return {
    topSpacer,
    toastStrip,
    barSpacer,
    cardHeight,
    railHeight,
    railBottom,
    railEnd,
    railLane,
    cardLift,
  };
}
