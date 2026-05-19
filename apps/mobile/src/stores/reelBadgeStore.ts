/**
 * reelBadgeStore — tracks the "newly added since last reel visit" count
 * that surfaces as a small red number badge on the Reel tab in the
 * GlobalBottomBar. Bumped by AddToReelChip on a successful add,
 * cleared by App.tsx when the user navigates to the journey screen.
 *
 * Ephemeral by design — nothing persists; the badge resets on cold
 * start because the goal is "things you added in this session you
 * haven't looked at yet," not "lifetime unread."
 */

import { create } from 'zustand';

interface ReelBadgeState {
  count: number;
  bump: () => void;
  /** Decrement by 1, never below zero. Called when the user undoes a
   *  recent add via the chip toggle so the badge stays consistent. */
  unbump: () => void;
  clear: () => void;
}

export const useReelBadgeStore = create<ReelBadgeState>((set, get) => ({
  count: 0,
  bump: () => set({ count: get().count + 1 }),
  unbump: () => set({ count: Math.max(0, get().count - 1) }),
  clear: () => set({ count: 0 }),
}));
