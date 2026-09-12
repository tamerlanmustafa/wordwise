/**
 * premiumSheetStore — the one place the app asks someone to subscribe.
 *
 * Mirrors the `confirmStore` + `ConfirmDialog` split: this holds whether the
 * invite is showing and why, and `PremiumSheet` (mounted once at the app root)
 * renders it. Any screen can call `openPremiumSheet()` without importing a
 * component, holding navigation state, or knowing where in the tree it will be
 * drawn — which is what makes it usable from a tile press, a locked freeze
 * slot, a 402, or whatever asks next.
 *
 * ## Why a sheet over the tree rather than a route
 *
 * `PaywallScreen` is a destination: you navigate to it and Back returns you
 * somewhere. That is right when the user went looking for the upgrade. It is
 * wrong for an *interruption* — a user who tapped a practice tile did not ask
 * to go anywhere, and pushing a screen under them loses their scroll position
 * and their place in the path. A sheet leaves the tab behind it intact, so
 * dismissing puts them back exactly where they were with nothing to undo.
 *
 * ## `reason` is not decoration
 *
 * It picks the sentence under the hero. "You've done today's free review" and
 * the generic pitch are different messages to different people, and the
 * existing `paywallSubtitle` already encodes that mapping — so this stores the
 * reason rather than a pre-rendered string, and lets the sheet translate at
 * render time. A string here would also be stale after a language change.
 */
import { create } from 'zustand';

import type { PaywallReason } from '../components/paywallPricing';

interface PremiumSheetState {
  visible: boolean;
  /** Why the sheet opened, for the subtitle. Null is the generic pitch. */
  reason: PaywallReason;
  open: (reason?: PaywallReason) => void;
  close: () => void;
}

export const usePremiumSheetStore = create<PremiumSheetState>((set) => ({
  visible: false,
  reason: null,

  open: (reason = null) => set({ visible: true, reason }),

  /**
   * Hide it.
   *
   * `reason` is deliberately NOT cleared here. The sheet animates out over a
   * few hundred milliseconds and is still on screen the whole time; clearing
   * the reason on the way down would swap the subtitle to the generic one
   * mid-slide, which reads as a glitch. The next `open()` sets it anyway, so
   * stale is harmless and visible-and-wrong is not.
   */
  close: () => set({ visible: false }),
}));

/** Ask someone to subscribe, from anywhere. */
export function openPremiumSheet(reason: PaywallReason = null): void {
  usePremiumSheetStore.getState().open(reason);
}

/** Dismiss it, from anywhere — including from inside a successful purchase. */
export function closePremiumSheet(): void {
  usePremiumSheetStore.getState().close();
}
