/**
 * The bottom bar's geometry on real devices, and the invariants the rest of
 * the app leans on.
 *
 * Not render tests (mobile testing is logic + integration only — see
 * CLAUDE.md). What can actually regress here is arithmetic: a capsule that
 * overlaps the home indicator, a reserved height that disagrees with what
 * screens pad by.
 */

import {
  CAPSULE_HEIGHT,
  SIDE_MARGIN,
  TOP_GAP,
  bottomMarginFor,
  navBarMetrics,
} from '../navBarMetrics';

/** Bottom safe-area insets across the range we ship on. */
const INSET_HOME_INDICATOR = 34; // most modern iPhones
const INSET_FLAT = 0; // iPhone SE, most Android
const INSET_ANDROID_GESTURE = 16; // Android gesture nav

describe('navBarMetrics — floating (iOS 26 glass)', () => {
  it('reserves capsule + bottom margin + top gap', () => {
    const m = navBarMetrics(INSET_HOME_INDICATOR, true);
    expect(m.reservedHeight).toBe(m.barHeight + m.bottomMargin + TOP_GAP);
    expect(m.barHeight).toBe(CAPSULE_HEIGHT);
  });

  it('is a true pill — radius is exactly half the capsule height', () => {
    const m = navBarMetrics(INSET_HOME_INDICATOR, true);
    expect(m.radius).toBe(m.barHeight / 2);
  });

  it('insets from the side edges so it reads as floating, not a strip', () => {
    expect(navBarMetrics(INSET_HOME_INDICATOR, true).sideMargin).toBe(SIDE_MARGIN);
  });

  it('sits inside the home-indicator inset rather than above all of it', () => {
    // Using the full 34pt would float the bar conspicuously high; iOS 26's own
    // bars overlap the indicator's outer margin.
    const m = navBarMetrics(INSET_HOME_INDICATOR, true);
    expect(m.bottomMargin).toBeLessThan(INSET_HOME_INDICATOR);
    expect(m.bottomMargin).toBeGreaterThan(0);
  });

  it('still leaves a margin on a flat-bottomed device with no inset to borrow', () => {
    const m = navBarMetrics(INSET_FLAT, true);
    expect(m.bottomMargin).toBeGreaterThanOrEqual(10);
  });

  it('never returns a negative or zero margin for any plausible inset', () => {
    for (let inset = 0; inset <= 60; inset++) {
      expect(bottomMarginFor(inset)).toBeGreaterThanOrEqual(10);
    }
  });
});

describe('navBarMetrics — pinned (Android / iOS < 26)', () => {
  it('sits flush to the screen but still reserves a gap above itself', () => {
    // It used to reserve exactly `barHeight`, which put content flush against
    // the bar's top edge. On Android that is the deck's controls resting on
    // the tab bar with the system's own navigation directly below — three
    // rows of controls stacked with no separation at all. The capsule hides
    // the same omission on iOS because it is inset from the screen anyway,
    // so the gap was there by accident there and missing everywhere else.
    const m = navBarMetrics(INSET_HOME_INDICATOR, false);
    expect(m.reservedHeight).toBe(m.barHeight + TOP_GAP);
    // Flush is about the bar's own placement, not its clearance.
    expect(m.bottomMargin).toBe(0);
    expect(m.sideMargin).toBe(0);
    expect(m.radius).toBe(0);
  });

  it('gives both shapes the same clearance above them', () => {
    // One number, so a control that clears the bar on iOS clears it on
    // Android without anyone re-deriving the gap per platform.
    for (const inset of [0, 24, 34, 48]) {
      expect(navBarMetrics(inset, false).reservedHeight - navBarMetrics(inset, false).barHeight)
        .toBe(TOP_GAP);
    }
  });

  it('keeps the original bar geometry — 8 top, >=18 bottom, honouring the inset', () => {
    // These are the numbers the pre-glass bar used. Android must not move.
    expect(navBarMetrics(INSET_FLAT, false).padBottom).toBe(18);
    expect(navBarMetrics(INSET_ANDROID_GESTURE, false).padBottom).toBe(18);
    expect(navBarMetrics(INSET_HOME_INDICATOR, false).padBottom).toBe(INSET_HOME_INDICATOR);
    expect(navBarMetrics(INSET_FLAT, false).padTop).toBe(8);
  });

  it('grows with the safe-area inset so the labels clear the home indicator', () => {
    expect(navBarMetrics(INSET_HOME_INDICATOR, false).barHeight).toBeGreaterThan(
      navBarMetrics(INSET_FLAT, false).barHeight,
    );
  });
});

describe('reserved height is stable', () => {
  // The load-bearing invariant. Every scroller pads by `reservedHeight`, and
  // the bar retracts via transform only. If the retract ever became a layout
  // change, the reported height would shrink and all that content would jump.
  it('does not depend on collapse state — it is not an input at all', () => {
    const a = navBarMetrics(INSET_HOME_INDICATOR, true);
    const b = navBarMetrics(INSET_HOME_INDICATOR, true);
    expect(a.reservedHeight).toBe(b.reservedHeight);
  });

  it('is deterministic for a given inset and shape', () => {
    for (const inset of [INSET_FLAT, INSET_ANDROID_GESTURE, INSET_HOME_INDICATOR]) {
      for (const floating of [true, false]) {
        expect(navBarMetrics(inset, floating)).toEqual(navBarMetrics(inset, floating));
      }
    }
  });

  it('leaves room for a fingertip in both shapes', () => {
    // Apple's 44pt minimum target — the capsule must not be squeezed below it.
    expect(navBarMetrics(INSET_FLAT, true).barHeight).toBeGreaterThanOrEqual(44);
    expect(navBarMetrics(INSET_FLAT, false).barHeight).toBeGreaterThanOrEqual(44);
  });
});
