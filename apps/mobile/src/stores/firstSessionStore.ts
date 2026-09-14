/**
 * firstSessionStore — whether this install had been opened before this launch.
 *
 * The film feed's ad slot is held back for the very first session, so a new
 * reader's first look at the app is the product and not an ad box. The answer
 * lives in AsyncStorage, and the feed used to read it when its tab mounted.
 *
 * ## Why it is read at launch
 *
 * That read answers after the tab's first frame. So for a free reader the feed
 * drew once with no ad slot, then the slot arrived and shoved every card below
 * it down — measured after a cold start: one frame at the top, then the list
 * 48pt lower. Nothing about the answer changes between launch and the tap, so
 * App reads it at launch and the feed takes it synchronously.
 *
 * `openedBefore` is fixed for the session on purpose. Marking this visit writes
 * disk only: the ad starts on the NEXT launch, never appearing under a reader
 * part-way through the one they are in.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'has_opened_before';

interface FirstSessionState {
  hydrated: boolean;
  /** The install had been opened before this launch. */
  openedBefore: boolean;
  /** Read the flag. Idempotent — every caller shares the one read. */
  hydrate: () => Promise<void>;
  /** Record this visit for next launch. Leaves `openedBefore` alone. */
  markOpened: () => Promise<void>;
  /** Test-only — forget the read. */
  _reset: () => void;
}

let reading: Promise<void> | null = null;

export const useFirstSessionStore = create<FirstSessionState>((set, get) => ({
  hydrated: false,
  openedBefore: false,

  hydrate: () => {
    reading ??= (async () => {
      try {
        set({ openedBefore: !!(await AsyncStorage.getItem(KEY)), hydrated: true });
      } catch {
        // Unreadable storage reads as a first session: no ad is the safe
        // direction to be wrong in.
        set({ hydrated: true });
      }
    })();
    return reading;
  },

  markOpened: async () => {
    // After the read, never before it — writing first would make this launch
    // read as a returning one.
    await get().hydrate();
    if (get().openedBefore) return;
    try {
      await AsyncStorage.setItem(KEY, '1');
    } catch {
      /* best-effort: the worst case is one more session without the slot */
    }
  },

  _reset: () => {
    reading = null;
    set({ hydrated: false, openedBefore: false });
  },
}));
