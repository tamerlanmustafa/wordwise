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
export const UNDO_EDGE = 3;

/** The actions row is as tall as its tallest child — the pill plus its edge
 *  layer. The undo button (46 + 3) is shorter and centres inside it. */
export const ACTIONS_ROW_HEIGHT = PILL_HEIGHT + PILL_EDGE;

// ── The column above the deck ─────────────────────────────────────────────
// Heights and the gap that precedes each, top to bottom. MovieDetailScreen
// and MovieDetailHero style their blocks from these; nothing re-types them.

/** Back-button row: a 34pt circle on its own line under the safe area. */
export const BACK_ROW = { gap: 1, height: 34 };
/** Poster print (5 + 100 + 12 padding, 1pt edge each side) beside the title. */
export const HERO_PLATE = { gap: 12, height: 119 };
/** ✦ For You + six CEFR chips. */
export const FILTER_BAR = { gap: 14, height: 44 };
/** `CARD 23 / 60` · `B2 DECK`. */
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
  FILTER_BAR.gap +
  FILTER_BAR.height +
  DECK_HEADER_ROW.gap +
  DECK_HEADER_ROW.height +
  PROGRESS_BAR.gap +
  PROGRESS_BAR.height;

// ── Inside the deck block ─────────────────────────────────────────────────

/** Gap above the deck zone, inside the deck block. */
export const DECK_GAP_TOP = 14;
/** Gap between the deck zone and the actions row. */
export const ACTIONS_GAP = 18;

/** "Resumed at your bookmark" chip: padding 6×2 + border 1×2 + a 14pt line,
 *  plus its 10pt margin. Shown only until the first advance, so it is an
 *  input — it comes out of the deck's share, not the controls' position. */
export const RESUME_CHIP_BLOCK = 38;

/** Legibility backstop, not a fit constraint. iPhone SE lands at ~0.577 of
 *  its own accord and renders below this only on a screen smaller than any
 *  we ship to — where `zoneHeight` clips the card rather than let the buttons
 *  leave the viewport. */
export const MIN_SCALE = 0.55;

export interface DeckMetricsInput {
  /** Measured height of the deck block: what `flex: 1` left it after the
   *  column above and the bottom bar below. 0 before the first layout pass. */
  available: number;
  /** Whether the resume chip is currently occupying its slot above the deck. */
  resumeChip: boolean;
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

export function deckMetrics({ available, resumeChip }: DeckMetricsInput): DeckMetrics {
  // What is left for the zone once the block's own fixed parts are paid for.
  const forZone = Math.max(
    0,
    available -
      DECK_GAP_TOP -
      (resumeChip ? RESUME_CHIP_BLOCK : 0) -
      ACTIONS_GAP -
      ACTIONS_ROW_HEIGHT,
  );

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
