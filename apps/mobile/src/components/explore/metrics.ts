/**
 * Explore feed geometry, derived from the actual viewport.
 *
 * The design was measured on one tall phone (~770pt of usable height above
 * the tab bar), and the original implementation hard-coded those pixels: a
 * 285pt rail sitting 132pt up, a 150pt card lift, a 76pt rail lane. On a
 * 4.7" phone that block claims ~420pt of a ~477pt card, leaving almost
 * nothing for the word, and the lift can push it off the top of the screen.
 *
 * So the numbers become ratios of the measured card area, clamped so they
 * never exceed the design on a large screen or collapse on a small one.
 * On the reference device the ratios reproduce the original values; below
 * it, everything shrinks together and the rail stays proportional to the
 * panel it must align with.
 *
 * Pure on purpose — the layout is a function of the viewport, so it can be
 * tested without rendering anything.
 */

/** Below this usable height a phone is "compact" (roughly 4.7"/5.5" class),
 *  and the fixed chrome gets trimmed rather than eating the card. */
const COMPACT_VIEWPORT = 620;

/** Share of the card area the action rail occupies. 285/662 on the
 *  reference device. */
const RAIL_HEIGHT_RATIO = 0.43;

/** Share of the card area between the rail's bottom and the card's.
 *  132/662 on the reference device. */
const RAIL_BOTTOM_RATIO = 0.2;

/** How far the lifting group rises, as a share of the rail's height —
 *  the rail and the panel are the same height, so tying the lift to it
 *  keeps the word clearing the panel by the same margin everywhere. */
const LIFT_RATIO = 0.53;

/** Share of the screen width reserved as the rail's lane, so card text
 *  never runs under the glyphs. */
const RAIL_LANE_RATIO = 0.2;

export interface ExploreMetricsInput {
  /** Measured height available to the screen, i.e. above the tab bar. */
  viewport: number;
  /** Screen width, for the rail lane. */
  width: number;
  /** Safe-area top inset. */
  topInset: number;
}

export interface ExploreMetrics {
  /** Clears the Dynamic Island / status bar. */
  topSpacer: number;
  /** Reserved so the surface never reflows when a toast comes and goes. */
  toastStrip: number;
  /** One card = one viewport. */
  cardHeight: number;
  railHeight: number;
  railBottom: number;
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
}: ExploreMetricsInput): ExploreMetrics {
  const compact = viewport < COMPACT_VIEWPORT;

  // A device reporting a deeper inset (Dynamic Island) always wins over the
  // design floor — clearing the hardware matters more than the mockup.
  const topSpacer = Math.max(topInset, compact ? 44 : 62);
  const toastStrip = compact ? 38 : 46;
  const cardHeight = Math.max(0, viewport - topSpacer - toastStrip);

  // The rail must fit inside the card area with room left for the word, so
  // both its height and its offset are clamped against the card, not just
  // against absolute pixels.
  const railHeight = scale(cardHeight * RAIL_HEIGHT_RATIO, 190, 285);
  const railBottom = scale(cardHeight * RAIL_BOTTOM_RATIO, 88, 132);
  const cardLift = scale(railHeight * LIFT_RATIO, 96, 150);
  const railLane = scale(width * RAIL_LANE_RATIO, 66, 84);

  return {
    topSpacer,
    toastStrip,
    cardHeight,
    railHeight,
    railBottom,
    railEnd: compact ? 6 : 10,
    railLane,
    cardLift,
  };
}
