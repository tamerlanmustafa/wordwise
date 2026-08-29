/**
 * useNavBarCollapse — wire a scroller to the Liquid Glass bottom bar so the
 * bar retracts on a downward browse and returns on an upward one.
 *
 * Spread the result onto any ScrollView / FlatList:
 *
 *     const navScroll = useNavBarCollapse(active);
 *     <ScrollView {...navScroll}>
 *
 * or, for lists that already surface a plain offset (RankedMovieList's
 * `onScrollOffset`), use `onScrollOffset` and ignore the rest.
 *
 * The direction state lives in a ref, not in React state: it updates on every
 * scroll frame and only the *flip* matters to anyone. Keeping it out of state
 * means a 60fps scroll causes zero re-renders of the screen driving it — only
 * the bar itself re-renders, and only when `collapsed` actually changes.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import {
  initialCollapseState,
  reduceNavBarCollapse,
  type CollapseState,
} from '../utils/collapseOnScroll';
import { useNavBarStore } from '../stores/navBarStore';

/**
 * @param active Whether the calling screen is the visible tab. Screens are
 *   kept mounted by KeepAlive, so a hidden screen can still receive layout
 *   driven scroll events; without this gate a background tab could retract
 *   the bar out from under the foreground one.
 */
export function useNavBarCollapse(active = true) {
  const state = useRef<CollapseState>(initialCollapseState);
  const setCollapsed = useNavBarStore((s) => s.setCollapsed);
  const reset = useNavBarStore((s) => s.reset);

  const onScrollOffset = useCallback(
    (y: number) => {
      if (!active) return;
      state.current = reduceNavBarCollapse(state.current, y);
      setCollapsed(state.current.collapsed);
    },
    [active, setCollapsed],
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      onScrollOffset(e.nativeEvent.contentOffset.y);
    },
    [onScrollOffset],
  );

  // Leaving the screen (or hiding it behind another tab) must hand the bar
  // back. Otherwise a screen abandoned mid-scroll leaves the next one with no
  // navigation until the user happens to scroll up.
  useEffect(() => {
    if (!active) {
      state.current = initialCollapseState;
      reset();
    }
    return () => {
      state.current = initialCollapseState;
      reset();
    };
  }, [active, reset]);

  // Memoised: callers spread this onto a list, and Home folds `onScrollOffset`
  // into a useCallback. A fresh object every render would invalidate both and
  // re-render the list on every parent render.
  return useMemo(
    () => ({ onScroll, onScrollOffset, scrollEventThrottle: 16 }),
    [onScroll, onScrollOffset],
  );
}
