/**
 * collapseOnScroll — direction-aware gate for the Home "Word of the Hour" card.
 *
 * The card collapses up out of view as the movie feed is scrolled *down*, and
 * springs back as soon as the user scrolls *up* by about a row — they don't
 * have to scroll all the way back to the top to see it again. Small jitter and
 * momentum wobble are absorbed by requiring a sustained run in one direction
 * before flipping (COLLAPSE_RUN / REVEAL_RUN), plus the card is always shown
 * at the very top (TOP_Y).
 */

/** Don't collapse until the feed is at least this far down. */
export const WORD_CARD_MIN_COLLAPSE_Y = 40;
/** Sustained downward travel (px) that commits a collapse. */
export const WORD_CARD_COLLAPSE_RUN = 30;
/** Sustained upward travel (px) that reveals the card again — ~one card row,
 *  so scrolling back up a little brings it back mid-feed. */
export const WORD_CARD_REVEAL_RUN = 120;
/** At/near the very top the card is always shown. */
export const WORD_CARD_TOP_Y = 8;

export interface CollapseState {
  collapsed: boolean;
  /** Last scroll offset seen, to derive the per-event delta. */
  lastY: number;
  /** Signed run of travel in the current scroll direction (+down / -up),
   *  reset whenever the direction flips. */
  run: number;
}

export const initialCollapseState: CollapseState = { collapsed: false, lastY: 0, run: 0 };

/**
 * Fold a new scroll offset into the collapse state. Accumulates travel in the
 * current direction and flips `collapsed` once that run passes the relevant
 * threshold, so a downward browse hides the card and a short upward scroll
 * brings it back without needing to reach the top.
 */
export function reduceCollapse(state: CollapseState, y: number): CollapseState {
  // Always show the card at the very top.
  if (y <= WORD_CARD_TOP_Y) {
    return { collapsed: false, lastY: y, run: 0 };
  }

  const dy = y - state.lastY;
  let run = state.run;
  if (dy > 0) run = run > 0 ? run + dy : dy; // extend/flip to a downward run
  else if (dy < 0) run = run < 0 ? run + dy : dy; // extend/flip to an upward run

  let collapsed = state.collapsed;
  if (!collapsed && run >= WORD_CARD_COLLAPSE_RUN && y > WORD_CARD_MIN_COLLAPSE_Y) {
    collapsed = true;
  } else if (collapsed && -run >= WORD_CARD_REVEAL_RUN) {
    collapsed = false;
  }

  return { collapsed, lastY: y, run };
}
