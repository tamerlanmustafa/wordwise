/**
 * useNavBarCollapse — the scroll → minimize wiring for the bottom bar.
 *
 * The reducer itself is covered in utils/__tests__/collapseOnScroll.test.ts.
 * What is tested here is the wiring around it: the KeepAlive gate, the reset
 * on leaving a screen, and — the reason this file exists — that the hook
 * defers to the store rather than its own copy of `collapsed`, so tapping a
 * tab to expand the bar isn't immediately undone by the next scroll frame.
 */

import { renderHook, cleanupHooks, act } from '../../test-utils/renderHook';
import { useNavBarCollapse } from '../useNavBarCollapse';
import { useNavBarStore } from '../../stores/navBarStore';
import { NAV_BAR_THRESHOLDS } from '../../utils/collapseOnScroll';

const T = NAV_BAR_THRESHOLDS;
/** An offset far enough down, in one jump, to commit a minimize. */
const DEEP = T.minCollapseY + T.collapseRun + 50;

const collapsed = () => useNavBarStore.getState().collapsed;

beforeEach(() => {
  useNavBarStore.setState({ collapsed: false });
});

afterEach(cleanupHooks);

describe('scroll drives the bar', () => {
  it('minimizes on a sustained downward scroll', () => {
    const { result } = renderHook(() => useNavBarCollapse(true));
    act(() => {
      result.current.onScrollOffset(0);
      result.current.onScrollOffset(DEEP);
    });
    expect(collapsed()).toBe(true);
  });

  it('restores full size on a scroll back up', () => {
    const { result } = renderHook(() => useNavBarCollapse(true));
    act(() => {
      result.current.onScrollOffset(0);
      result.current.onScrollOffset(DEEP);
      result.current.onScrollOffset(DEEP - T.revealRun - 1);
    });
    expect(collapsed()).toBe(false);
  });

  it('accepts a raw scroll event as well as a bare offset', () => {
    const { result } = renderHook(() => useNavBarCollapse(true));
    act(() => {
      result.current.onScroll({ nativeEvent: { contentOffset: { y: 0 } } } as never);
      result.current.onScroll({ nativeEvent: { contentOffset: { y: DEEP } } } as never);
    });
    expect(collapsed()).toBe(true);
  });
});

describe('tapping a tab to expand', () => {
  // The regression this file was written for. The bar is minimized, the user
  // taps a tab (which calls reset()), and then keeps scrolling in the same
  // direction. If the hook trusted its own `collapsed` ref it would push the
  // stale `true` back on the very next frame and the bar would snap shut
  // under the user's finger.
  it('is not undone by the next scroll frame in the same direction', () => {
    const { result } = renderHook(() => useNavBarCollapse(true));

    act(() => {
      result.current.onScrollOffset(0);
      result.current.onScrollOffset(DEEP);
    });
    expect(collapsed()).toBe(true);

    // User taps a tab — the bar expands.
    act(() => useNavBarStore.getState().reset());
    expect(collapsed()).toBe(false);

    // …and the scroll continues gently downward, as a finger resting on a
    // list does. A few points of drift must not re-minimize it.
    act(() => {
      result.current.onScrollOffset(DEEP + 5);
      result.current.onScrollOffset(DEEP + 9);
    });
    expect(collapsed()).toBe(false);
  });

  it('still minimizes again once the user genuinely browses down further', () => {
    // Expanding by tap must not disable the behaviour permanently — only
    // discard the travel that had accumulated before the tap.
    const { result } = renderHook(() => useNavBarCollapse(true));
    act(() => {
      result.current.onScrollOffset(0);
      result.current.onScrollOffset(DEEP);
    });
    act(() => useNavBarStore.getState().reset());

    act(() => {
      result.current.onScrollOffset(DEEP + T.collapseRun + 20);
    });
    expect(collapsed()).toBe(true);
  });
});

describe('KeepAlive gating', () => {
  it('ignores scrolls from a screen that is not the visible tab', () => {
    // Hidden tabs stay mounted and can still emit scroll events; a background
    // screen must not shrink the bar under the foreground one.
    const { result } = renderHook(() => useNavBarCollapse(false));
    act(() => {
      result.current.onScrollOffset(0);
      result.current.onScrollOffset(DEEP);
    });
    expect(collapsed()).toBe(false);
  });

  it('hands the bar back at full size when the screen unmounts', () => {
    const { result, unmount } = renderHook(() => useNavBarCollapse(true));
    act(() => {
      result.current.onScrollOffset(0);
      result.current.onScrollOffset(DEEP);
    });
    expect(collapsed()).toBe(true);

    unmount();
    expect(collapsed()).toBe(false);
  });
});

describe('identity', () => {
  it('returns a stable object so lists do not re-render every frame', () => {
    const { result, rerender } = renderHook(() => useNavBarCollapse(true));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
