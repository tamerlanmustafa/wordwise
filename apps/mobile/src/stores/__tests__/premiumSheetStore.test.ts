/**
 * The upgrade invite, and the exits nobody demos.
 *
 * Opening a sheet is the path you build and screenshot. Closing it runs just
 * as often, gets none of that attention, and is where this component's bugs
 * would live — a sheet that hides rather than unmounts keeps its selected
 * plan, its in-flight purchase and its scrim, and all three outlive the
 * dismissal unless something says otherwise.
 *
 * The store is the part that can be tested under this suite's rules (logic and
 * integration only, no render library). The rest of the teardown contract —
 * the exit animation completing before unmount, the async purchase guard, the
 * scrim releasing touches — is pinned by source guards in
 * `components/premium/__tests__/premiumSheetTeardown.test.ts`.
 */

import {
  closePremiumSheet,
  openPremiumSheet,
  usePremiumSheetStore,
} from '../premiumSheetStore';

const state = () => usePremiumSheetStore.getState();

describe('premiumSheetStore', () => {
  beforeEach(() => {
    usePremiumSheetStore.setState({ visible: false, reason: null });
  });

  describe('opening', () => {
    it('starts closed', () => {
      expect(state().visible).toBe(false);
    });

    it('opens with no reason by default', () => {
      openPremiumSheet();
      expect(state().visible).toBe(true);
      expect(state().reason).toBeNull();
    });

    it('carries the reason it was opened with', () => {
      // The reason picks the sentence under the hero. "You've done today's
      // free review" and the generic pitch are different messages to different
      // people, and the capped tile is the former.
      openPremiumSheet('daily_cap_reached');
      expect(state().reason).toBe('daily_cap_reached');
    });

    it('replaces the reason when reopened for something else', () => {
      openPremiumSheet('daily_cap_reached');
      closePremiumSheet();
      openPremiumSheet(null);
      expect(state().reason).toBeNull();
    });

    it('is idempotent — asking twice does not stack', () => {
      // Two triggers can fire close together: a tile tap that also resolves a
      // freeze-slot press. A second open must be a no-op on an open sheet
      // rather than something that needs two dismissals to clear.
      openPremiumSheet('daily_cap_reached');
      openPremiumSheet('daily_cap_reached');
      expect(state().visible).toBe(true);
      closePremiumSheet();
      expect(state().visible).toBe(false);
    });
  });

  describe('closing', () => {
    it('hides it', () => {
      openPremiumSheet('daily_cap_reached');
      closePremiumSheet();
      expect(state().visible).toBe(false);
    });

    it('deliberately KEEPS the reason on the way out', () => {
      // Not an oversight. The sheet animates out over ~220ms and is on screen
      // the whole time; clearing the reason here would swap the subtitle to
      // the generic pitch mid-slide, in full view. The next open sets it
      // anyway, so stale-and-hidden is harmless where visible-and-wrong is
      // not.
      openPremiumSheet('daily_cap_reached');
      closePremiumSheet();
      expect(state().reason).toBe('daily_cap_reached');
    });

    it('survives being closed when already closed', () => {
      // Reachable: the scrim tap and the Android back button can both land,
      // and a successful purchase dismisses on top of whichever got there
      // first.
      closePremiumSheet();
      closePremiumSheet();
      expect(state().visible).toBe(false);
    });

    it('can be reopened cleanly after closing', () => {
      openPremiumSheet('daily_cap_reached');
      closePremiumSheet();
      openPremiumSheet('daily_cap_reached');
      expect(state().visible).toBe(true);
    });
  });

  describe('the imperative helpers are the whole public surface', () => {
    it('opens and closes without touching the hook', () => {
      // The point of the store: a tile press, a locked freeze slot or a 402
      // asks for the invite without importing a component, holding navigation
      // state, or knowing where in the tree it gets drawn.
      openPremiumSheet('daily_cap_reached');
      expect(usePremiumSheetStore.getState().visible).toBe(true);
      closePremiumSheet();
      expect(usePremiumSheetStore.getState().visible).toBe(false);
    });
  });
});
