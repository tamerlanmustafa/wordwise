/**
 * The poor-connection notice, which is a timer and nothing cleverer.
 *
 * A slow connection is not a failure: nothing throws, no status arrives, the
 * request is simply still open. Elapsed time is the only signal the client
 * has, which is why this is a `setTimeout` rather than anything that sounds
 * more sophisticated.
 *
 * The two behaviours worth pinning are both about NOT showing it: it must not
 * appear before the threshold, and it must disappear the moment the load ends
 * — a sticky flag would put "slow connection" above a page that had just
 * loaded instantly, which is worse than saying nothing at all.
 */

import { act } from 'react-test-renderer';

import { renderHook } from '../../test-utils/renderHook';
import { useSlowConnection } from '../useSlowConnection';

describe('useSlowConnection', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('is false while not loading', () => {
    const { result } = renderHook(() => useSlowConnection(false));
    expect(result.current).toBe(false);
  });

  it('is false before the threshold', () => {
    const { result } = renderHook(() => useSlowConnection(true, 6000));
    act(() => {
      jest.advanceTimersByTime(5999);
    });
    expect(result.current).toBe(false);
  });

  it('becomes true once the threshold passes', () => {
    const { result } = renderHook(() => useSlowConnection(true, 6000));
    act(() => {
      jest.advanceTimersByTime(6000);
    });
    expect(result.current).toBe(true);
  });

  it('clears the moment loading ends', () => {
    // The request finally landed, so it takes its own warning away. Nothing
    // else in the app has to remember to clear it.
    let loading = true;
    const { result, rerender } = renderHook(() => useSlowConnection(loading, 6000));
    act(() => {
      jest.advanceTimersByTime(6000);
    });
    expect(result.current).toBe(true);

    loading = false;
    rerender();
    expect(result.current).toBe(false);
  });

  it('does not fire for a load that finished in time', () => {
    let loading = true;
    const { result, rerender } = renderHook(() => useSlowConnection(loading, 6000));
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    loading = false;
    rerender();
    act(() => {
      jest.advanceTimersByTime(10000);
    });
    // The timer from the first load must not survive it — otherwise a screen
    // that loaded quickly grows a slow-connection notice six seconds later.
    expect(result.current).toBe(false);
  });

  it('restarts cleanly on a second load', () => {
    let loading = true;
    const { result, rerender } = renderHook(() => useSlowConnection(loading, 6000));
    act(() => {
      jest.advanceTimersByTime(6000);
    });
    loading = false;
    rerender();
    loading = true;
    rerender();
    expect(result.current).toBe(false);
    act(() => {
      jest.advanceTimersByTime(6000);
    });
    expect(result.current).toBe(true);
  });
});
