/**
 * navBarStore — whether the Liquid Glass bottom bar is currently retracted.
 *
 * The bar is rendered once, by App.tsx, but the scrolls that retract it happen
 * inside whichever tab screen is on top. Threading a callback down through
 * App → KeepAlive → screen → its list, for four screens, would mean four props
 * that exist only to carry one boolean upward; a store keeps the bar and the
 * scroller decoupled and matches how the rest of the app shares cross-screen
 * state (see reelBadgeStore, toastStore).
 *
 * Ephemeral by design — nothing persists. A cold start should always show the
 * bar, and so should any tab switch: `reset()` is called on navigation so a
 * screen left mid-scroll never hands the next screen a hidden bar.
 */

import { create } from 'zustand';

interface NavBarState {
  /** True while the bar is retracted by a downward scroll. */
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  /** Force the bar back into view — on tab change, or when a screen that
   *  drives the collapse unmounts. */
  reset: () => void;
}

export const useNavBarStore = create<NavBarState>((set, get) => ({
  collapsed: false,
  // Guarded so an onScroll firing at 60fps only notifies subscribers on an
  // actual flip. zustand would bail out on an identical object anyway, but
  // the reducer runs per scroll event and this keeps the hot path free of
  // needless set() calls.
  setCollapsed: (collapsed) => {
    if (get().collapsed !== collapsed) set({ collapsed });
  },
  reset: () => {
    if (get().collapsed) set({ collapsed: false });
  },
}));
