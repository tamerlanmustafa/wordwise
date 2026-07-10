/**
 * collapseOnScroll — hysteresis gate for the Home "Word of the Hour" card.
 *
 * The card collapses up out of view once the movie feed is scrolled past
 * ENTER, and springs back once the feed returns above EXIT. The gap between
 * the two thresholds is deliberate: a single threshold would flicker the card
 * open/closed on tiny scroll jitters right at the boundary.
 */

/** Collapse the card once the feed is scrolled past this many px. */
export const WORD_CARD_COLLAPSE_ENTER = 32;
/** Re-expand the card once the feed scrolls back above this many px. */
export const WORD_CARD_COLLAPSE_EXIT = 8;

/**
 * Next collapsed state given the current state and the feed's scroll offset.
 * Collapses past ENTER, expands below EXIT, and otherwise holds — so the card
 * stays put in the dead-band between the two thresholds.
 */
export function nextCollapsed(collapsed: boolean, offsetY: number): boolean {
  if (!collapsed && offsetY > WORD_CARD_COLLAPSE_ENTER) return true;
  if (collapsed && offsetY < WORD_CARD_COLLAPSE_EXIT) return false;
  return collapsed;
}
