/**
 * collapseOnScroll — direction-aware gate for anything that hides while the
 * user browses downward and comes back when they scroll up.
 *
 * Two things use it: the Home "Word of the Hour" card, and the Liquid Glass
 * bottom bar. Both want the same shape — collapse on a sustained downward
 * run, reveal on a sustained upward one, absorb momentum jitter in between,
 * and always show at the very top — but with different appetites for how much
 * travel commits each flip, so the thresholds are a parameter.
 *
 * Note the shape of the API: `makeCollapseReducer(thresholds)` returns a
 * *two-argument* reducer rather than `reduceCollapse` taking thresholds as a
 * third argument. That is deliberate. Callers (and tests) drive this with
 * `offsets.reduce(reduceCollapse, start)`, and `Array.prototype.reduce` passes
 * `(acc, value, index, array)` — a third parameter would silently be handed
 * the element *index*, and the thresholds would read as `undefined`. Currying
 * keeps the arity at two and makes that mistake unrepresentable.
 */

export interface CollapseThresholds {
  /** Don't collapse until the scroller is at least this far down. */
  minCollapseY: number;
  /** Sustained downward travel (px) that commits a collapse. */
  collapseRun: number;
  /** Sustained upward travel (px) that reveals again — without needing to
   *  scroll all the way back to the top. */
  revealRun: number;
  /** At/near the very top the target is always shown. */
  topY: number;
}

/** Don't collapse until the feed is at least this far down. */
export const WORD_CARD_MIN_COLLAPSE_Y = 40;
/** Sustained downward travel (px) that commits a collapse. */
export const WORD_CARD_COLLAPSE_RUN = 30;
/** Sustained upward travel (px) that reveals the card again — ~one card row,
 *  so scrolling back up a little brings it back mid-feed. */
export const WORD_CARD_REVEAL_RUN = 120;
/** At/near the very top the card is always shown. */
export const WORD_CARD_TOP_Y = 8;

export const WORD_CARD_THRESHOLDS: CollapseThresholds = {
  minCollapseY: WORD_CARD_MIN_COLLAPSE_Y,
  collapseRun: WORD_CARD_COLLAPSE_RUN,
  revealRun: WORD_CARD_REVEAL_RUN,
  topY: WORD_CARD_TOP_Y,
};

/**
 * The bottom bar retracts less eagerly than the word card and comes back far
 * more eagerly. Hiding navigation is more disruptive than hiding a card, so it
 * takes more downward intent to commit (40 vs 30); but an upward scroll is the
 * gesture people make when they are about to go somewhere else, so the bar is
 * back after ~a third of the card's travel (45 vs 120) rather than making them
 * fish for it. `minCollapseY` clears the first screenful so short lists never
 * hide the bar at all.
 */
export const NAV_BAR_THRESHOLDS: CollapseThresholds = {
  minCollapseY: 60,
  collapseRun: 40,
  revealRun: 45,
  topY: 8,
};

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
 * Build a reducer that folds a new scroll offset into the collapse state.
 * Accumulates travel in the current direction and flips `collapsed` once that
 * run passes the relevant threshold, so a downward browse hides the target and
 * a short upward scroll brings it back without needing to reach the top.
 */
export function makeCollapseReducer(t: CollapseThresholds) {
  return function reduce(state: CollapseState, y: number): CollapseState {
    // Always show at the very top.
    if (y <= t.topY) {
      return { collapsed: false, lastY: y, run: 0 };
    }

    const dy = y - state.lastY;
    let run = state.run;
    if (dy > 0) run = run > 0 ? run + dy : dy; // extend/flip to a downward run
    else if (dy < 0) run = run < 0 ? run + dy : dy; // extend/flip to an upward run

    let collapsed = state.collapsed;
    if (!collapsed && run >= t.collapseRun && y > t.minCollapseY) {
      collapsed = true;
    } else if (collapsed && -run >= t.revealRun) {
      collapsed = false;
    }

    return { collapsed, lastY: y, run };
  };
}

/** The Home "Word of the Hour" card's gate. */
export const reduceCollapse = makeCollapseReducer(WORD_CARD_THRESHOLDS);

/** The Liquid Glass bottom bar's gate. */
export const reduceNavBarCollapse = makeCollapseReducer(NAV_BAR_THRESHOLDS);
