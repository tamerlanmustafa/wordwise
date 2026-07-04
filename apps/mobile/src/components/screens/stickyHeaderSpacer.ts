/**
 * Interpolation ranges for the sticky-tabs spacer on MovieDetailScreen.
 *
 * The movie hero extends behind the status bar, so when the tabs header
 * sticks to the top of the viewport it needs `insetTop` of headroom to
 * clear the notch / dynamic island. Padding the header unconditionally
 * leaves a status-bar-sized gap between the overview and the tabs in the
 * resting position, so instead a spacer above the tabs grows from
 * 0 → insetTop over the last `insetTop` points of scroll before the
 * header pins (scroll offset `headerY`). Net effect: the tabs visually
 * dock at `insetTop` from the screen top and never jump.
 *
 * Returns null when no spacer is needed: no top inset (e.g. Android
 * without a cutout) or the header position hasn't been measured yet.
 */
export function stickySpacerRange(
  insetTop: number,
  headerY: number,
): { inputRange: [number, number]; outputRange: [number, number] } | null {
  if (insetTop <= 0 || headerY <= insetTop) return null;
  return {
    inputRange: [headerY - insetTop, headerY],
    outputRange: [0, insetTop],
  };
}
