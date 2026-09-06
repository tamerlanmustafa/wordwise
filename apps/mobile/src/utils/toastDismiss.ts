/**
 * toastDismiss — pure gesture + stacking logic for the global toast host.
 *
 * Kept free of React/Animated for the same reason `swipeDecision` is: the
 * thresholds are the part worth testing, and the repo has no component render
 * library (see CLAUDE.md). `components/common/Toast` owns only the Animated
 * wiring and calls into these.
 *
 * A toast is dismissable in three directions, not one. It is anchored to the
 * top of the screen, so *up* is the direction that reads as "put it back where
 * it came from" — but a toast is also a thing lying across your content, and
 * the reflex for that is to sweep it sideways. Supporting only one of those
 * makes the other feel broken rather than absent.
 *
 * Down is deliberately not a dismissal: the toast enters downward, so a drag
 * down is the gesture that most looks like pulling it *further* out. It rubber
 * bands instead, which is the standard way to say "this axis has an end".
 */

/** Which way a released drag threw the toast. */
export type ToastDismissDirection = 'up' | 'start' | 'end';

/** Travel (px) that dismisses on release. Smaller than a card swipe's 110:
 *  the toast is a transient notice that is already leaving on its own, so the
 *  cost of dismissing one you meant to keep is a few seconds of missed text,
 *  while the cost of a swipe that does not take is a second swipe. */
export const TOAST_DISMISS_DX = 64;
/** Upward travel that dismisses. Tighter than the horizontal threshold — the
 *  toast has only its own height to travel before it is off-screen anyway. */
export const TOAST_DISMISS_DY = 32;
/** …or a flick faster than this (px per ms, PanResponder's vx/vy unit).
 *  Matches SWIPE_COMMIT_VELOCITY: one flick speed means "commit" everywhere. */
export const TOAST_DISMISS_VELOCITY = 0.5;
/** Movement (px) before the toast claims the gesture from anything under it.
 *  Low, because nothing scrolls beneath a toast — the only competing gesture is
 *  a tap on its own action button, and a tap does not move. */
export const TOAST_CLAIM = 6;

/** How far a downward drag can actually pull the toast, however hard you pull.
 *  The resistance is what tells you the axis is closed. */
export const TOAST_RUBBER_BAND = 12;

/**
 * Whether the toast should claim a drag. Any direction — unlike a feed row,
 * which must let vertical scrolls through.
 */
export function shouldClaimToastDrag(dx: number, dy: number): boolean {
  return Math.abs(dx) > TOAST_CLAIM || Math.abs(dy) > TOAST_CLAIM;
}

/**
 * Direction a release dismisses toward, or null to spring back.
 *
 * The dominant axis decides first: a drag that is mostly sideways is a
 * sideways dismissal even if it drifted upward past the (smaller) vertical
 * threshold, which is otherwise easy to trip with a diagonal thumb sweep.
 *
 * `dx` is in *logical* units — positive means toward the trailing edge, in both
 * reading directions. The caller converts from physical pixels, the same
 * contract SwipeableRow uses; a toast that dismisses toward the wrong edge
 * under RTL flies out through the side it was anchored to.
 */
export function toastDismissOnRelease(
  dx: number,
  dy: number,
  vx: number,
  vy: number,
): ToastDismissDirection | null {
  const horizontal = Math.abs(dx) >= Math.abs(dy);

  if (horizontal) {
    const committed = Math.abs(dx) > TOAST_DISMISS_DX || Math.abs(vx) > TOAST_DISMISS_VELOCITY;
    if (!committed) return null;
    const dir = dx !== 0 ? dx : vx;
    if (dir === 0) return null;
    return dir > 0 ? 'end' : 'start';
  }

  // Upward only: dy is negative going up, and a downward throw is not a
  // dismissal however fast it was.
  const committed = -dy > TOAST_DISMISS_DY || -vy > TOAST_DISMISS_VELOCITY;
  return committed ? 'up' : null;
}

/**
 * Resistance curve for a downward drag. Approaches TOAST_RUBBER_BAND without
 * reaching it, so the toast keeps responding to the finger — a hard clamp
 * feels like the gesture died rather than like the axis is closed.
 */
export function rubberBand(dy: number): number {
  if (dy <= 0) return dy;
  return (dy * TOAST_RUBBER_BAND) / (dy + TOAST_RUBBER_BAND);
}
