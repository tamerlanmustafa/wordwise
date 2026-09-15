/**
 * sheetDismiss — pure drag logic for pulling a bottom sheet closed.
 *
 * Kept free of React and Animated for the reason `toastDismiss` is: the
 * thresholds are the part worth testing, and the suite has no render library
 * (see CLAUDE.md). `components/premium/PremiumSheet` owns the Animated wiring
 * and calls into these.
 *
 * Down closes. The sheet came up from the bottom edge, so pulling it back down
 * is the gesture that reads as "put it away", and the one the system sheets on
 * both platforms answer to. Up only rubber-bands: the sheet is already as tall
 * as it gets, and a drag that went nowhere at all would feel broken rather than
 * finished.
 *
 * A release closes on distance or on speed. Distance alone fails a quick
 * flick; speed alone fails a slow, deliberate pull. A flick back up at the end
 * of a long pull keeps the sheet open, because the last thing the finger said
 * was "no".
 */

/** Movement (px) before the sheet claims a drag from the button under the
 *  finger. Low, because nothing inside the sheet scrolls: the only competing
 *  gesture is a tap, and a tap does not travel. */
export const SHEET_CLAIM = 6;

/** Downward travel that closes on release, as a share of the sheet's height… */
export const SHEET_DISMISS_FRACTION = 0.25;
/** …capped, so a tall sheet does not ask for a long pull. Also the threshold
 *  before the sheet has measured itself. */
export const SHEET_DISMISS_DY = 120;

/** A flick faster than this (px per ms, PanResponder's vy unit) decides on its
 *  own, whatever the distance. The same commit speed as a card swipe and a
 *  toast: one flick speed means "commit" everywhere. */
export const SHEET_DISMISS_VELOCITY = 0.5;

/** How far an upward drag can lift the sheet, however hard you pull. The
 *  resistance is what tells you the axis has an end. */
export const SHEET_RUBBER_BAND = 16;

/** Whether the sheet should claim a drag: mostly vertical, and past the slop. */
export function shouldClaimSheetDrag(dx: number, dy: number): boolean {
  return Math.abs(dy) > SHEET_CLAIM && Math.abs(dy) > Math.abs(dx);
}

/** Whether a release closes the sheet. `sheetHeight` is 0 until it has laid out. */
export function sheetDismissOnRelease(dy: number, vy: number, sheetHeight: number): boolean {
  if (vy < -SHEET_DISMISS_VELOCITY) return false;
  if (vy > SHEET_DISMISS_VELOCITY && dy > 0) return true;
  const threshold =
    sheetHeight > 0
      ? Math.min(SHEET_DISMISS_DY, sheetHeight * SHEET_DISMISS_FRACTION)
      : SHEET_DISMISS_DY;
  return dy > threshold;
}

/**
 * Where the sheet sits for a drag of `dy`: under the finger going down, and
 * against a resistance going up that approaches SHEET_RUBBER_BAND without
 * reaching it, so the sheet keeps answering the finger. A hard clamp feels like
 * the gesture died.
 */
export function sheetDragOffset(dy: number): number {
  if (dy >= 0) return dy;
  const up = -dy;
  return -(up * SHEET_RUBBER_BAND) / (up + SHEET_RUBBER_BAND);
}
