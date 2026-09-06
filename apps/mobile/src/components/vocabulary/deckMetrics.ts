/**
 * Movie-detail column budget, and the deck's share of it.
 *
 * The screen used to scroll: a `ScrollView` with a sticky tabs header, a
 * constant-height deck block, and a hard-coded 110pt of padding underneath.
 * The movie's identity collapsed after 40pt of scrolling, and the deck's
 * controls sat wherever the leftover space happened to end — which grows with
 * the phone, so on a tall device they were out of thumb reach.
 *
 * It is now one fixed viewport. Every block has a stated height, the deck zone
 * is the only elastic one, and it takes what is left over by SCALING — never
 * by editing the card's slot constants, which are the card's contract
 * (see cardLayout). A uniformly scaled deck is still the mockup; a deck with
 * re-tuned slots is a different design.
 *
 * The layout itself is driven by flexbox and one `onLayout`, not by adding
 * these numbers up: `available` is measured, so the bottom bar, the safe-area
 * insets and any future block all count themselves. The block constants below
 * are what the fixed blocks are actually styled with — one named place, so a
 * test can prove the budget seats on a given device instead of that only
 * turning up on hardware.
 *
 * Pure on purpose, same as explore/metrics: testable without rendering.
 */

import { DECK_ZONE_HEIGHT } from './cardLayout';

// ── The controls' own dimensions (unchanged; owned here so the geometry
//    below and WordCardDeck's styles cannot drift apart) ──────────────────

/** Tactile action buttons (Ledger mockup): a hard-edged "3D" shadow drawn as
 *  an offset edge layer; pressing translates the face down onto it. */
export const PILL_WIDTH = 136;
export const PILL_HEIGHT = 52;
export const PILL_EDGE = 4;
export const PILL_EDGE_PRESSED_DROP = 3;
export const UNDO_SIZE = 46;

/** The actions row is as tall as its tallest child — the pill plus its edge
 *  layer. The step-back button is a flat 46pt circle and centres inside it. */
export const ACTIONS_ROW_HEIGHT = PILL_HEIGHT + PILL_EDGE;

// ── The column above the deck ─────────────────────────────────────────────
// Heights and the gap that precedes each, top to bottom. MovieDetailScreen
// and MovieDetailHero style their blocks from these; nothing re-types them.

/** Back-button row: a 34pt circle on its own line under the safe area. */
export const BACK_ROW = { gap: 1, height: 34 };
/**
 * The title block under the back row.
 *
 * 86, not the poster's 100. This was the poster's height because the poster
 * was the tallest thing in the block; with it gone the block only has to hold
 * what the film's own lines need — the band chip and its match rate (19 plus a
 * 7pt gap) over two title lines at the larger tier (2 x 29), and 4pt of
 * breathing room under it. The 14pt difference goes to the deck rather than
 * staying in the column as empty space, which is the same trade the poster's
 * paper frame made when that was dropped.
 */
export const HERO_PLATE = { gap: 12, height: 86 };
/** For You + six CEFR chips. */
export const FILTER_BAR = { gap: 14, height: 44 };
/** The screen is For You only, so the level chips have nothing to switch
 *  between and the bar is hidden — code kept, flip to true to bring it back.
 *  It is declared here rather than in the screen because the bar is a block in
 *  the column budget: hiding it hands its 58pt to the card, and the budget
 *  below has to agree with what is actually rendered or `deckBlockHeightFor`
 *  starts describing a screen that does not exist. */
export const SHOW_LEVEL_FILTER_BAR: boolean = false;
/** `CARD 23 / 60`. */
export const DECK_HEADER_ROW = { gap: 12, height: 13 };
/** Thin progress rule under the deck header. */
export const PROGRESS_BAR = { gap: 7, height: 3 };

/** Everything between the safe-area top and the deck block. Add `insets.top`
 *  for the full chrome above the deck. */
export const COLUMN_ABOVE_DECK =
  BACK_ROW.gap +
  BACK_ROW.height +
  HERO_PLATE.gap +
  HERO_PLATE.height +
  (SHOW_LEVEL_FILTER_BAR ? FILTER_BAR.gap + FILTER_BAR.height : 0) +
  DECK_HEADER_ROW.gap +
  DECK_HEADER_ROW.height +
  PROGRESS_BAR.gap +
  PROGRESS_BAR.height;

// ── Inside the deck block ─────────────────────────────────────────────────

/** Gap above the deck zone, inside the deck block. */
export const DECK_GAP_TOP = 14;
/** Gap between the deck zone and the actions row. */
export const ACTIONS_GAP = 18;

/** Legibility backstop, not a fit constraint. iPhone SE lands at ~0.577 of
 *  its own accord and renders below this only on a screen smaller than any
 *  we ship to — where `zoneHeight` clips the card rather than let the buttons
 *  leave the viewport. */
export const MIN_SCALE = 0.55;

/** The deck's resting inset from each side of its container. */
export const DECK_SIDE_MARGIN = 18;

/**
 * How close a *scaled* deck may come to the screen edge.
 *
 * The film-edge sprockets sit at x = 6..14 (`FilmEdgeBackdrop`: `left: 6`,
 * `width: 8`), and they are the real boundary of the content lane — the card
 * may run up to them and must not run over them. At rest the card sits at 18
 * and clears them by 4; a scaled card is allowed the extra 4, because on a
 * device that is scaling at all the alternative is a visibly narrow card with
 * empty gutters between it and the film edge.
 */
export const DECK_EDGE_INSET = 14;

/**
 * The floor iOS keeps under the solved margin.
 *
 * It was applied on both platforms and was the reason the S24's card stayed
 * inset: the exact answer there is about 4, so a floor of 8 *raised* the
 * margin and pushed the card further in than the solve asked for. The real
 * constraint is only that the box must not exceed its parent, which 0 already
 * guarantees — 8 was caution with no failure behind it.
 */
export const DECK_MIN_SIDE_MARGIN = 8;

/**
 * The deck's side inset, given its container width and the vertical scale.
 *
 * The scale exists to fit the card *vertically*: its slots are fixed heights,
 * so a short viewport shrinks the whole zone rather than re-cutting it. But
 * `transform: scale` is uniform, so a card scaled for a shorter screen also
 * comes in off both sides — and on a device that had plenty of width, that
 * width is simply left empty. A Samsung S24 beside an iPhone shows it plainly:
 * shorter viewport, so a scale under 1, so a narrower card with unused gutters.
 *
 * So the inset is solved for rather than chosen. Widening the pre-transform box
 * makes the post-transform card land where we want it:
 *
 *     rendered inset = m + (width - 2m)(1 - scale) / 2
 *
 * Set that equal to the target and solve for `m`. Clamped to [0, resting]: 0
 * because a box wider than its parent stops receiving touches on Android, and
 * the resting margin because a scaled card should never sit *further* in than
 * an unscaled one.
 *
 * `reclaim` is the caller's platform decision, not this function's. Android
 * aims at the sprockets; iOS keeps the resting inset as its target and a
 * floor under it, which is the behaviour already on that platform and which
 * has been looked at on a device and signed off. The maths is identical — only
 * the two numbers differ — so this stays one function with one test.
 */
export function deckSideMargin(width: number, scale: number, reclaim: boolean): number {
  if (width <= 0 || scale >= 1) return DECK_SIDE_MARGIN;
  const target = reclaim ? DECK_EDGE_INSET : DECK_SIDE_MARGIN;
  const floor = reclaim ? 0 : DECK_MIN_SIDE_MARGIN;
  const solved = (target - (width * (1 - scale)) / 2) / scale;
  return Math.max(floor, Math.min(DECK_SIDE_MARGIN, solved));
}

export interface DeckMetricsInput {
  /** Measured height of the deck block: what `flex: 1` left it after the
   *  column above and the bottom bar below. 0 before the first layout pass.
   *
   *  Nothing else belongs in here. The resume chip used to be a second input
   *  because it claimed a 38pt block above the deck, and on a fixed screen
   *  that came straight out of the card: it cropped the card on an iPhone SE
   *  and made the 16 Pro's card jump 9.3% larger the moment it vanished. It
   *  floats over the deck now and costs the budget nothing. */
  available: number;
}

export interface DeckMetrics {
  /** Uniform scale for the deck zone, applied about its top edge. */
  scale: number;
  /** Laid-out height of the deck zone — `DECK_ZONE_HEIGHT * scale`, capped so
   *  the actions row can never be pushed out of the viewport. */
  zoneHeight: number;
  /** True while the deck is rendering smaller than the mockup. */
  scaled: boolean;
  /** True in the pathological case where even the floor does not fit and the
   *  card is being cropped. Nothing we ship to should reach this. */
  cropped: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export function deckMetrics({ available }: DeckMetricsInput): DeckMetrics {
  // What is left for the zone once the block's own fixed parts are paid for.
  const forZone = Math.max(0, available - DECK_GAP_TOP - ACTIONS_GAP - ACTIONS_ROW_HEIGHT);

  const scale = clamp(forZone / DECK_ZONE_HEIGHT, MIN_SCALE, 1);
  const wanted = Math.round(DECK_ZONE_HEIGHT * scale);
  // The cap is what makes "the buttons never leave the viewport" true by
  // construction rather than by trusting the arithmetic above. Floored, not
  // rounded: `available` arrives from onLayout as a fraction, and rounding up
  // into it is exactly the half-pixel that pushes the row out.
  const zoneHeight = Math.min(wanted, Math.floor(forZone));

  return {
    scale,
    zoneHeight,
    scaled: scale < 1,
    cropped: zoneHeight < wanted,
  };
}

/** Height the deck block gets on a device, for tests and for reasoning about
 *  a new phone without booting one. `barHeight` is GlobalBottomBar's, which
 *  owns the home-indicator inset on this screen. */
export function deckBlockHeightFor({
  screenHeight,
  topInset,
  barHeight,
}: {
  screenHeight: number;
  topInset: number;
  barHeight: number;
}): number {
  return Math.max(0, screenHeight - barHeight - topInset - COLUMN_ABOVE_DECK);
}
