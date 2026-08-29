/**
 * useNavBarCollapse — wire a scroller to the Liquid Glass bottom bar so the
 * bar minimizes on a downward browse and returns to full size on an upward one.
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
 *   driven scroll events; without this gate a background tab could minimize
 *   the bar out from under the foreground one.
 */
export function useNavBarCollapse(active = true) {
  const state = useRef<CollapseState>(initialCollapseState);
  const reset = useNavBarStore((s) => s.reset);

  const onScrollOffset = useCallback(
    (y: number) => {
      if (!active) return;
      const store = useNavBarStore.getState();
      // The store owns `collapsed`, not this ref. Tapping a tab expands the
      // bar without this hook hearing about it, so adopt the store's value
      // before folding in the new offset — otherwise the very next scroll
      // event would push our stale `true` straight back and the bar would
      // snap shut again under the user's finger. `run` resets alongside it:
      // travel accumulated before the tap argued for a state the user has
      // since overridden, and letting it carry over would re-trigger instantly.
      const prev =
        state.current.collapsed === store.collapsed
          ? state.current
          : { ...state.current, collapsed: store.collapsed, run: 0 };

      state.current = reduceNavBarCollapse(prev, y);
      store.setCollapsed(state.current.collapsed);
    },
    [active],
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      onScrollOffset(e.nativeEvent.contentOffset.y);
    },
    [onScrollOffset],
  );

  // Leaving the screen (or hiding it behind another tab) must hand the bar
  // back at full size. Otherwise a screen abandoned mid-scroll leaves the next
  // one with a shrunken bar it never asked for.
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
