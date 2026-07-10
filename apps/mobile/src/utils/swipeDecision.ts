/**
 * swipeDecision — pure gesture logic for the home-feed swipeable movie cards.
 *
 * Swipe right ("Seen it") → Watched list; swipe left → "Not interested".
 * Kept free of React/Animated so the thresholds are unit-testable in isolation
 * (same approach as collapseOnScroll). The SwipeableRow component owns only the
 * Animated wiring and calls into these.
 */

export type SwipeAction = 'watched' | 'notInterested';

/** Horizontal travel (px) that commits an action on release. */
export const SWIPE_COMMIT_DX = 110;
/** …or a flick faster than this (px per ms — PanResponder's vx unit) commits
 *  even on a shorter drag, so a quick flick still registers. */
export const SWIPE_COMMIT_VELOCITY = 0.5;
/** Minimum horizontal travel (px) before a drag is treated as a swipe rather
 *  than a vertical list scroll. Kept small so a horizontal intent is caught
 *  early, before the FlashList's scroll takes over. */
export const SWIPE_CLAIM_DX = 8;
/** How much the horizontal component must beat the vertical one to count as a
 *  swipe. <1 biases toward horizontal (forgives the vertical drift in a real
 *  thumb swipe), so left/right isn't stolen by the scroll. At 0.65 a drag up
 *  to ~57° off horizontal still swipes; steeper drags scroll. */
export const SWIPE_H_BIAS = 0.65;

/**
 * Whether the row should claim the gesture from the vertical list. True once
 * the drag has moved horizontally past SWIPE_CLAIM_DX and is more horizontal
 * than vertical (allowing for drift via SWIPE_H_BIAS). Clearly-vertical drags
 * fall through so the FlashList still scrolls.
 */
export function shouldClaimHorizontal(dx: number, dy: number): boolean {
  return Math.abs(dx) > SWIPE_CLAIM_DX && Math.abs(dx) > Math.abs(dy) * SWIPE_H_BIAS;
}

/**
 * Action a release commits to, or null to snap the card back. Commits when the
 * card was dragged far enough OR flicked fast enough; the horizontal direction
 * picks the action (right → watched, left → notInterested).
 */
export function swipeActionOnRelease(dx: number, vx: number): SwipeAction | null {
  const committed = Math.abs(dx) > SWIPE_COMMIT_DX || Math.abs(vx) > SWIPE_COMMIT_VELOCITY;
  if (!committed) return null;
  // Prefer the drag direction; fall back to the flick direction if the card
  // somehow released at dx exactly 0.
  const dir = dx !== 0 ? dx : vx;
  if (dir === 0) return null;
  return dir > 0 ? 'watched' : 'notInterested';
}
