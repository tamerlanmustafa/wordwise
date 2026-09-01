/**
 * edgeSwipeBack — pure gesture logic for the interactive back swipe.
 *
 * Dragging in from the *leading* screen edge pulls the current screen aside
 * and, past a threshold, navigates back — the gesture every iOS app and most
 * Android apps ship. Kept free of React/Animated so the thresholds are
 * unit-testable in isolation, exactly like `swipeDecision` (which owns the
 * home-feed row swipe) and `collapseOnScroll`.
 *
 * Everything here is expressed in *logical* pixels: `startX` is the distance
 * from the leading edge and `dx` is positive when the finger travels toward the
 * trailing edge, in both reading directions. SwipeBackView converts from
 * PanResponder's physical coordinates with `directionSign` before calling in —
 * see i18n/rtl for why that conversion cannot be skipped.
 */

import { SWIPE_COMMIT_VELOCITY, SWIPE_H_BIAS } from './swipeDecision';

/**
 * How far in from the leading edge a drag must *start* to count as a back
 * swipe. Deliberately narrow: everything inside a screen — the word-card deck,
 * the mix bar, horizontal carousels — also wants horizontal drags, and the edge
 * zone is what keeps this gesture from stealing theirs. 28px is roughly the
 * iOS system value and about a thumb's width.
 */
export const EDGE_ZONE_WIDTH = 28;

/** Minimum inward travel before the swipe claims the gesture from the screen. */
export const EDGE_CLAIM_DX = 8;

/**
 * Fraction of the screen width the drag must cover to commit on release.
 * Below it the screen springs back and nothing navigates.
 */
export const EDGE_COMMIT_FRACTION = 0.32;

/** Floor for the commit distance, so the gesture doesn't get sloppy on a
 *  narrow device where 32% is only ~100px. */
export const EDGE_COMMIT_MIN_DX = 72;

/** True when a touch that began at `startX` started close enough to the
 *  leading edge to be a back swipe rather than an in-screen drag. */
export function isEdgeStart(startX: number): boolean {
  return startX >= 0 && startX <= EDGE_ZONE_WIDTH;
}

/**
 * Distance of a physical touch from the *leading* edge.
 *
 * PanResponder reports absolute screen coordinates, which Yoga never mirrors:
 * under RTL the leading edge is the right-hand one, so x has to be measured
 * from the other side or the gesture would live on the wrong edge of an Arabic
 * build.
 */
export function leadingEdgeDistance(
  physicalStartX: number,
  screenWidth: number,
  rtl: boolean,
): number {
  return rtl ? screenWidth - physicalStartX : physicalStartX;
}

/**
 * Whether the back swipe should claim the gesture. Requires an edge start, some
 * inward travel, and a mostly-horizontal direction — a vertical drag from the
 * edge still scrolls the screen underneath. Reuses `SWIPE_H_BIAS` so "how
 * horizontal is horizontal" means one thing app-wide.
 */
export function shouldClaimEdgeSwipe(startX: number, dx: number, dy: number): boolean {
  if (!isEdgeStart(startX)) return false;
  if (dx <= EDGE_CLAIM_DX) return false;
  return dx > Math.abs(dy) * SWIPE_H_BIAS;
}

/** Distance (px) that commits the back navigation on this screen width. */
export function edgeCommitDistance(screenWidth: number): number {
  return Math.max(EDGE_COMMIT_MIN_DX, screenWidth * EDGE_COMMIT_FRACTION);
}

/**
 * Whether releasing here navigates back. Commits on a long-enough drag OR a
 * flick faster than `SWIPE_COMMIT_VELOCITY` — the same flick speed the feed
 * rows and the word-card deck use, so "fast enough to mean it" is one number.
 * A flick still needs to have travelled past the claim threshold, so a twitch
 * at the edge can't navigate.
 */
export function edgeSwipeCommits(dx: number, vx: number, screenWidth: number): boolean {
  if (dx <= EDGE_CLAIM_DX) return false;
  if (dx >= edgeCommitDistance(screenWidth)) return true;
  return vx >= SWIPE_COMMIT_VELOCITY;
}
