/**
 * Explore geometry.
 *
 * The thing these guard: the feed's chrome (rail, lift, lane, spacers) used
 * to be pixel values measured on one tall phone. On a 4.7" screen that block
 * crowded the word off the card. Everything below is really one assertion —
 * the chrome must leave the word room on every device we ship to.
 */
import { exploreMetrics, RAIL_ITEM_WIDTH, type ExploreMetrics } from '../metrics';
import { SIDE_MARGIN, TAB_COUNT } from '../../navBarMetrics';

/**
 * Where the rail's button column is centred, as a distance from the logical
 * end edge — the number that has to match the last tab of the bar below.
 */
function railCentreFromEnd(m: ExploreMetrics): number {
  return m.railEnd + RAIL_ITEM_WIDTH / 2;
}

/** The same thing for the bar: the centre of its last cell. */
function tabCentreFromEnd(width: number, sideMargin: number): number {
  return sideMargin + (width - sideMargin * 2) / TAB_COUNT / 2;
}

/**
 * Room between the card's top edge and the rail's top edge — where the word
 * and its sentence have to fit.
 *
 * `railBottom` is measured from the bottom of the screen and `topSpacer` from
 * the top, so this is the one place the two frames of reference are reconciled.
 * Deliberately a helper rather than repeated inline: the rail moved frames once
 * already (it used to be positioned off the card), and a copy of this sum in
 * five tests is five places to get it wrong next time.
 */
function wordRoom(m: ExploreMetrics, viewport: number): number {
  return viewport - m.topSpacer - (m.railBottom + m.railHeight);
}

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
    expect(m.cardLift).toBe(150);
  });

  it('never exceeds the design on an even larger screen', () => {
    const m = exploreMetrics({ viewport: 1000, width: 500, topInset: 59 });
    expect(m.railHeight).toBe(285);
    expect(m.cardLift).toBe(150);
    // The lane's 84pt design figure is a floor, not a ceiling. A wider screen
    // spreads the tab grid, which pushes the rail inboard, and the lane has to
    // follow it or the sentence runs under the glyphs — so what is pinned here
    // is that it clears the rail without eating the card.
    expect(m.railLane).toBeGreaterThan(m.railEnd + RAIL_ITEM_WIDTH);
    expect(m.railLane / 500).toBeLessThan(0.25);
  });
});

describe('exploreMetrics — the rail sits on the bottom bar', () => {
  // The rail is chrome stacked at the bottom edge, not a feature of the card.
  // Its distance to the bar must not grow with the screen, and the panels
  // inherit the same bottom edge, so this pins all three at once.
  it('leaves the same small gap over the bar on every screen', () => {
    for (const bar of [0, 61, 91, 103]) {
      const m = exploreMetrics({ viewport: 932, width: 430, topInset: 59, bottomOffset: bar });
      expect(m.railBottom - bar).toBe(12);
    }
  });

  it('trims the gap on a compact screen, like the other chrome', () => {
    const m = exploreMetrics({ ...SMALL, bottomOffset: 65 });
    expect(m.railBottom - 65).toBe(8);
  });

  it('clears the bar rather than sitting under it', () => {
    for (const d of [LARGE, SMALL, TINY]) {
      for (const bar of [0, 65, 91]) {
        const m = exploreMetrics({ ...d, bottomOffset: bar });
        expect(m.railBottom).toBeGreaterThan(m.barSpacer);
      }
    }
  });

  it('does not drift up when the phone gets taller', () => {
    // The old ratio put the rail 132pt up on a 6.7" phone and 88pt up on an
    // SE, so the same design sat in a visibly different place on each. Anchored
    // to the bar, only the bar's own height moves it.
    const tall = exploreMetrics({ viewport: 932, width: 430, topInset: 59, bottomOffset: 91 });
    const short = exploreMetrics({ viewport: 667, width: 375, topInset: 20, bottomOffset: 91 });
    expect(tall.railBottom - short.railBottom).toBeLessThanOrEqual(4);
  });
});

describe('exploreMetrics — the rail is centred on the last tab', () => {
  // The rail and the Profile tab read as one vertical column, so being a few
  // points out looks like a bug rather than a choice. The rail used to sit at
  // a flat 10pt from the edge, which put its centre 13pt outboard of the tab's
  // on a 6.7" phone — visible, and the reason this alignment is derived now.
  const DEVICES = [
    { width: 402, name: '6.3"' },
    { width: 430, name: '6.7"' },
    { width: 393, name: '6.1"' },
    { width: 375, name: '4.7"' },
    { width: 320, name: 'SE 1st gen' },
  ];

  it('lands the button column dead centre on the tab, floating bar', () => {
    for (const d of DEVICES) {
      const m = exploreMetrics({ viewport: 900, width: d.width, topInset: 59, barSideMargin: SIDE_MARGIN });
      // Within half a point: `railEnd` is rounded to a whole pixel so the
      // glyphs stay crisp, and the tab grid can land on a half.
      expect(Math.abs(railCentreFromEnd(m) - tabCentreFromEnd(d.width, SIDE_MARGIN)))
        .toBeLessThanOrEqual(0.5);
    }
  });

  it('lands it dead centre on the pinned bar too, which has no side inset', () => {
    for (const d of DEVICES) {
      const m = exploreMetrics({ viewport: 900, width: d.width, topInset: 20, barSideMargin: 0 });
      expect(Math.abs(railCentreFromEnd(m) - tabCentreFromEnd(d.width, 0)))
        .toBeLessThanOrEqual(0.5);
    }
  });

  it('moves the rail inboard when the bar is inset from the edge', () => {
    // The floating capsule's cells sit further in than the pinned bar's, so
    // the rail must follow it rather than staying put.
    const floating = exploreMetrics({ viewport: 900, width: 402, topInset: 59, barSideMargin: SIDE_MARGIN });
    const pinned = exploreMetrics({ viewport: 900, width: 402, topInset: 59, barSideMargin: 0 });
    expect(floating.railEnd).toBeGreaterThan(pinned.railEnd);
  });

  it('keeps the rail on screen on the narrowest phone we ship to', () => {
    for (const sideMargin of [0, SIDE_MARGIN]) {
      const m = exploreMetrics({ viewport: 500, width: 320, topInset: 20, barSideMargin: sideMargin });
      expect(m.railEnd).toBeGreaterThanOrEqual(0);
      expect(m.railEnd + RAIL_ITEM_WIDTH).toBeLessThan(320);
    }
  });

  it('always reserves a lane wide enough to clear the rail wherever it lands', () => {
    // The lane is the card's end padding. If the rail moves inboard of it the
    // sentence runs under the glyphs — so the lane is derived from the rail,
    // not from a share of the width that happens to be big enough today.
    for (const d of DEVICES) {
      for (const sideMargin of [0, SIDE_MARGIN]) {
        const m = exploreMetrics({ viewport: 900, width: d.width, topInset: 59, barSideMargin: sideMargin });
        expect(m.railLane).toBeGreaterThan(m.railEnd + RAIL_ITEM_WIDTH);
      }
    }
  });
});

describe('exploreMetrics — the small-screen bug this exists to prevent', () => {
  it('leaves the word real room above the rail on a 4.7" phone', () => {
    const m = exploreMetrics(SMALL);
    // With the old hard-coded 285 + 132 this was ~60pt — not enough for a
    // 46pt word plus its sentence.
    expect(wordRoom(m, SMALL.viewport)).toBeGreaterThan(120);
  });

  it('keeps the rail block on screen on every device, bar or no bar', () => {
    for (const device of [LARGE, SMALL, TINY]) {
      for (const bar of [0, 65, 91]) {
        const m = exploreMetrics({ ...device, bottomOffset: bar });
        expect(wordRoom(m, device.viewport)).toBeGreaterThan(120);
      }
    }
  });

  it('trims the fixed chrome on a compact screen instead of the card', () => {
    const m = exploreMetrics(SMALL);
    expect(m.topSpacer).toBe(44);
    expect(m.toastStrip).toBe(38);
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
      expect(m.cardHeight + m.topSpacer + m.toastStrip + m.barSpacer).toBe(d.viewport);
    }
  });

  it('still tiles the container once the floating bar reserves a strip', () => {
    // The bug this pins: the bar's height used to be subtracted by the caller
    // and then never rendered, so the four bands summed to 91pt less than the
    // container they filled. The FlatList absorbed the slack and showed the
    // top of the next word — its CEFR badge and part of speech — under the
    // current one. Every band must come back out for the screen to render.
    for (const d of devices) {
      for (const bar of [0, 61, 91, 103]) {
        const m = exploreMetrics({ ...d, bottomOffset: bar });
        expect(m.barSpacer).toBe(bar);
        expect(m.cardHeight + m.topSpacer + m.toastStrip + m.barSpacer).toBe(d.viewport);
      }
    }
  });

  it('gives one card the whole screen, never a sliver of the next', () => {
    // A card is one card-height and the list window is whatever the column has
    // left. They must be the same number, or the leftover is a peek-through.
    const LARGE_PHONE = { viewport: 932, width: 430, topInset: 59 };
    const m = exploreMetrics({ ...LARGE_PHONE, bottomOffset: 91 });
    const listWindow = LARGE_PHONE.viewport - m.topSpacer - m.toastStrip - m.barSpacer;
    expect(m.cardHeight).toBe(listWindow);
  });

  it('trims the chrome when the bar is what makes a phone compact', () => {
    // 640pt of screen is roomy; 640 minus a 91pt bar is not. Compactness has
    // to be judged on what is left after the bar, not on the raw screen.
    const m = exploreMetrics({ viewport: 640, width: 375, topInset: 20, bottomOffset: 91 });
    expect(m.topSpacer).toBe(44);
    expect(m.toastStrip).toBe(38);
  });

  it('degrades safely if the bar reports more height than the screen', () => {
    const m = exploreMetrics({ viewport: 60, width: 375, topInset: 20, bottomOffset: 91 });
    expect(m.cardHeight).toBe(0);
    expect(m.barSpacer).toBe(60);
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
