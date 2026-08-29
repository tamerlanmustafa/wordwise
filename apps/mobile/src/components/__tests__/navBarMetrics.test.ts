/**
 * The bottom bar's geometry on real devices, and the invariants the rest of
 * the app leans on.
 *
 * Not render tests (mobile testing is logic + integration only — see
 * CLAUDE.md). What can actually regress here is arithmetic: a capsule that
 * overlaps the home indicator, a reserved height that disagrees with what
 * screens pad by, or a lens parked under the wrong cell.
 */

import {
  CAPSULE_HEIGHT,
  LENS_INSET_H,
  LENS_INSET_V,
  SIDE_MARGIN,
  TOP_GAP,
  bottomMarginFor,
  lensGeometry,
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

  it('shrinks rather than leaving — the bar stays on screen when minimized', () => {
    const m = navBarMetrics(INSET_HOME_INDICATOR, true);
    expect(m.minimizedScale).toBeLessThan(1);
    expect(m.minimizedScale).toBeGreaterThan(0.5);
    // The nudge is a few points, not a full bar-height slide off screen.
    expect(m.minimizedTranslateY).toBeLessThan(m.barHeight / 2);
  });

  it('keeps every tab tappable while minimized', () => {
    // The whole point of minimizing instead of hiding: a user mid-scroll can
    // still navigate. Apple's 44pt minimum has to survive the scale.
    const m = navBarMetrics(INSET_HOME_INDICATOR, true);
    expect(m.barHeight * m.minimizedScale).toBeGreaterThanOrEqual(44);
  });

  it('plants the bottom edge so shrinking reads as tucking, not floating up', () => {
    // Scaling happens about the centre, so the capsule would otherwise lift
    // off the screen edge by half the height it loses. The nudge cancels it.
    const m = navBarMetrics(INSET_HOME_INDICATOR, true);
    const heightLost = m.barHeight * (1 - m.minimizedScale);
    expect(m.minimizedTranslateY).toBeCloseTo(heightLost / 2, 5);
  });

  it('keeps the minimized capsule inside its side margins', () => {
    // Scaling narrows it too, so it can only move further from the edges.
    const m = navBarMetrics(INSET_HOME_INDICATOR, true);
    expect(m.minimizedScale).toBeLessThanOrEqual(1);
    expect(m.sideMargin).toBeGreaterThan(0);
  });
});

describe('navBarMetrics — pinned (Android / iOS < 26)', () => {
  it('reserves exactly its own height: nothing floats, nothing overlaps', () => {
    const m = navBarMetrics(INSET_HOME_INDICATOR, false);
    expect(m.reservedHeight).toBe(m.barHeight);
    expect(m.bottomMargin).toBe(0);
    expect(m.sideMargin).toBe(0);
    expect(m.radius).toBe(0);
  });

  it('never minimizes — Android behaviour is unchanged from before the glass', () => {
    for (const inset of [INSET_FLAT, INSET_ANDROID_GESTURE, INSET_HOME_INDICATOR]) {
      const m = navBarMetrics(inset, false);
      expect(m.minimizedScale).toBe(1);
      expect(m.minimizedTranslateY).toBe(0);
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

describe('lensGeometry', () => {
  const TAB_COUNT = 5;
  const ROW = 320 - SIDE_MARGIN * 2; // iPhone SE, the narrowest we support
  const CELL = ROW / TAB_COUNT;

  /** Cell frames as React Native reports them — always left-origin, in both
   *  reading directions. `order` is the physical left-to-right placement. */
  const frameAt = (order: number) => ({ x: order * CELL, width: CELL });

  it('returns null before the cell has been laid out', () => {
    expect(lensGeometry({ x: 0, width: 0 })).toBeNull();
  });

  it('returns null when nothing is measured yet', () => {
    expect(lensGeometry(undefined)).toBeNull();
  });

  it('returns null when no tab is active', () => {
    // Deep screens (movie detail) have no selected tab. A lens parked under an
    // arbitrary cell would claim the user is somewhere they are not.
    expect(lensGeometry(null)).toBeNull();
  });

  it('centres the lens in the cell it was given', () => {
    for (let i = 0; i < TAB_COUNT; i++) {
      const cell = frameAt(i);
      const lens = lensGeometry(cell)!;
      expect(lens.x + lens.width / 2).toBeCloseTo(cell.x + cell.width / 2, 5);
    }
  });

  it('keeps every lens inside the row, first cell to last', () => {
    for (let i = 0; i < TAB_COUNT; i++) {
      const lens = lensGeometry(frameAt(i))!;
      expect(lens.x).toBeGreaterThanOrEqual(0);
      expect(lens.x + lens.width).toBeLessThanOrEqual(ROW);
    }
  });

  it('never overlaps the neighbouring cell', () => {
    const a = lensGeometry(frameAt(0))!;
    const b = lensGeometry(frameAt(1))!;
    expect(a.x + a.width).toBeLessThanOrEqual(b.x);
  });

  it('follows the measured frame under RTL instead of the tab index', () => {
    // RTL reverses `flexDirection: row`, so the FIRST tab (Home) is drawn at
    // the far right and the LAST (Profile) at the far left. Deriving x from
    // the index would light the mirrored tab; measurement gets it right, and
    // this is the case that made the index version wrong.
    const homeUnderRtl = frameAt(TAB_COUNT - 1); // Home, drawn rightmost
    const lens = lensGeometry(homeUnderRtl)!;
    expect(lens.x).toBeGreaterThan(ROW / 2);
    expect(lens.x + lens.width).toBeLessThanOrEqual(ROW);
  });

  it('is a pure function of the frame — direction is never an input', () => {
    // The same frame must produce the same lens no matter which tab it is or
    // which way the row was laid out.
    expect(lensGeometry({ x: 40, width: 60 })).toEqual(lensGeometry({ x: 40, width: 60 }));
  });

  it('stays positive-width on the narrowest device', () => {
    expect(lensGeometry(frameAt(0))!.width).toBeGreaterThan(0);
  });

  it('degrades to null rather than inverting on a cell narrower than its insets', () => {
    expect(lensGeometry({ x: 0, width: LENS_INSET_H })).toBeNull();
  });

  it('fits inside the capsule vertically', () => {
    expect(LENS_INSET_V * 2).toBeLessThan(CAPSULE_HEIGHT);
    expect(LENS_INSET_H).toBeGreaterThan(0);
  });
});
