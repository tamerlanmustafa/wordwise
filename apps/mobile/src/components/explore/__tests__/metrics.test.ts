/**
 * Explore geometry.
 *
 * The thing these guard: the feed's chrome (rail, lift, lane, spacers) used
 * to be pixel values measured on one tall phone. On a 4.7" screen that block
 * crowded the word off the card. Everything below is really one assertion —
 * the chrome must leave the word room on every device we ship to.
 */
import { exploreMetrics } from '../metrics';

/** ~6.7" phone: the device the design was measured on. */
const LARGE = { viewport: 770, width: 430, topInset: 59 };
/** ~4.7" phone (iPhone SE class). */
const SMALL = { viewport: 585, width: 375, topInset: 20 };
/** Narrowest screen we care about. */
const TINY = { viewport: 500, width: 320, topInset: 20 };

describe('exploreMetrics — reference device', () => {
  it('reproduces the design values on the phone it was measured on', () => {
    const m = exploreMetrics(LARGE);
    expect(m.topSpacer).toBe(62);
    expect(m.toastStrip).toBe(46);
    expect(m.railHeight).toBe(285);
    expect(m.railBottom).toBe(132);
    expect(m.cardLift).toBe(150);
    expect(m.railEnd).toBe(10);
  });

  it('never exceeds the design on an even larger screen', () => {
    const m = exploreMetrics({ viewport: 1000, width: 500, topInset: 59 });
    expect(m.railHeight).toBe(285);
    expect(m.railBottom).toBe(132);
    expect(m.cardLift).toBe(150);
    expect(m.railLane).toBeLessThanOrEqual(84);
  });
});

describe('exploreMetrics — the small-screen bug this exists to prevent', () => {
  it('leaves the word real room above the rail on a 4.7" phone', () => {
    const m = exploreMetrics(SMALL);
    const aboveRail = m.cardHeight - (m.railBottom + m.railHeight);
    // With the old hard-coded 285 + 132 this was ~60pt — not enough for a
    // 46pt word plus its sentence.
    expect(aboveRail).toBeGreaterThan(120);
  });

  it('keeps the rail block inside the card on every device', () => {
    for (const device of [LARGE, SMALL, TINY]) {
      const m = exploreMetrics(device);
      expect(m.railBottom + m.railHeight).toBeLessThan(m.cardHeight);
    }
  });

  it('trims the fixed chrome on a compact screen instead of the card', () => {
    const m = exploreMetrics(SMALL);
    expect(m.topSpacer).toBe(44);
    expect(m.toastStrip).toBe(38);
    expect(m.railEnd).toBe(6);
  });
});

describe('exploreMetrics — invariants across every device', () => {
  const devices = [LARGE, SMALL, TINY, { viewport: 640, width: 393, topInset: 47 }];

  it('never lifts the word further than the rail is tall', () => {
    // A lift taller than the panel would push the word off the top.
    for (const d of devices) {
      const m = exploreMetrics(d);
      expect(m.cardLift).toBeLessThan(m.railHeight);
    }
  });

  it('always leaves the rail a lane wide enough for a 56pt glyph column', () => {
    for (const d of devices) {
      expect(exploreMetrics(d).railLane).toBeGreaterThanOrEqual(66);
    }
  });

  it('never lets the lane eat more than a quarter of the width', () => {
    for (const d of devices) {
      const m = exploreMetrics(d);
      expect(m.railLane / d.width).toBeLessThan(0.25);
    }
  });

  it('card height plus chrome always reconstructs the viewport', () => {
    for (const d of devices) {
      const m = exploreMetrics(d);
      expect(m.cardHeight + m.topSpacer + m.toastStrip).toBe(d.viewport);
    }
  });

  it('honours a deep safe-area inset over the design floor', () => {
    // A device reporting more inset than the design assumed must still clear
    // its hardware.
    const m = exploreMetrics({ viewport: 800, width: 430, topInset: 75 });
    expect(m.topSpacer).toBe(75);
  });

  it('degrades safely before the viewport has been measured', () => {
    const m = exploreMetrics({ viewport: 0, width: 0, topInset: 0 });
    expect(m.cardHeight).toBe(0);
    expect(m.cardHeight).not.toBeLessThan(0);
  });
});
