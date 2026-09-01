/**
 * useBottomBarInset — the room a sticky footer has to leave for the floating
 * tab bar.
 *
 * The bug this guards is invisible in any single-device test: the quiz CTA
 * was padded by a hardcoded 24pt, which clears nothing on a phone whose
 * capsule alone is 61pt tall. So the assertions are all "taller than the bar",
 * checked across the inset range we ship on, rather than one expected number.
 *
 * `react-native-safe-area-context` is mocked because `useSafeAreaInsets`
 * throws outside a SafeAreaProvider, and `renderHook` deliberately mounts no
 * provider tree. The glass half is already false under jest (see jest.setup),
 * so the default run exercises the pinned-bar geometry.
 */

import { CAPSULE_HEIGHT, navBarMetrics } from '../../components/navBarMetrics';
import { cleanupHooks, renderHook } from '../../test-utils/renderHook';

// `mock`-prefixed so the jest.mock factory may close over it.
let mockInsetBottom = 0;

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: mockInsetBottom, left: 0, right: 0 }),
}));

// Required after the mock so the hook picks it up.
const { useBottomBarInset } = require('../useBottomBarInset') as typeof import('../useBottomBarInset');

/** Bottom safe-area insets across the range we ship on. */
const INSETS = [
  0, // iPhone SE, most Android
  16, // Android gesture nav
  34, // most modern iPhones
];

describe('useBottomBarInset', () => {
  afterEach(() => {
    mockInsetBottom = 0;
    cleanupHooks();
  });

  it('agrees with navBarMetrics rather than keeping a second copy of the maths', () => {
    // Screens pad by the number the bar itself reports; a footer padding by a
    // separately-derived number would drift the moment either changed.
    for (const inset of INSETS) {
      mockInsetBottom = inset;
      const { result } = renderHook(() => useBottomBarInset());
      expect(result.current).toBe(navBarMetrics(inset, false).reservedHeight);
      cleanupHooks();
    }
  });

  it('always leaves more room than the bar is tall, on every device shape', () => {
    for (const inset of INSETS) {
      mockInsetBottom = inset;
      const { result } = renderHook(() => useBottomBarInset());
      expect(result.current).toBeGreaterThan(navBarMetrics(inset, false).barHeight - 1);
      cleanupHooks();
    }
  });

  it('clears the glass capsule too — the shape the old 24pt padding hid under', () => {
    // Jest reports no glass, so assert against the arithmetic directly: the
    // floating capsule is 61pt before any margin, and the sticky CTA that
    // padded by 24 sat squarely underneath it.
    for (const inset of INSETS) {
      expect(navBarMetrics(inset, true).reservedHeight).toBeGreaterThan(CAPSULE_HEIGHT);
      expect(navBarMetrics(inset, true).reservedHeight).toBeGreaterThan(24);
    }
  });

  it('follows the inset when it changes under a mounted screen', () => {
    // Rotating the device, or an Android nav-mode switch, changes the inset
    // while the quiz is open. A value captured once at mount would strand the
    // button under the bar for the rest of the session.
    mockInsetBottom = 0;
    const { result, rerender } = renderHook(() => useBottomBarInset());
    const flat = result.current;

    mockInsetBottom = 34;
    rerender();
    expect(result.current).toBeGreaterThan(flat);
  });
});
