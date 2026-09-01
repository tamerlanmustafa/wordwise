/**
 * useBottomBarInset — the vertical space a surface must leave free at its
 * bottom so its last row clears the GlobalBottomBar.
 *
 * The bar is an absolute overlay (see `navBarMetrics`), so nothing below it in
 * the tree loses height to it: every surface has to reserve the room itself.
 * App.tsx already prop-drills `bottomOffset={barHeight}` into the four tab
 * screens, and that stays the right shape for them — they pad by the number
 * the bar itself reported.
 *
 * Deep screens are the case this exists for. A sticky footer inside the quiz
 * sits three or four components below that plumbing (App → ReviewScreen →
 * MCQCard → the CTA bar), and threading a prop through each hop to reach one
 * `paddingBottom` buys nothing: the reported height is arithmetic, not a
 * measurement, so recomputing it from the same two inputs gives the identical
 * number — and gives it on the first frame rather than one layout pass late.
 */

import { useMemo } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { navBarMetrics } from '../components/navBarMetrics';
import { useGlassAvailable } from './useGlassAvailable';

export function useBottomBarInset(): number {
  const insets = useSafeAreaInsets();
  const glass = useGlassAvailable();
  return useMemo(
    () => navBarMetrics(insets.bottom, glass).reservedHeight,
    [insets.bottom, glass],
  );
}
