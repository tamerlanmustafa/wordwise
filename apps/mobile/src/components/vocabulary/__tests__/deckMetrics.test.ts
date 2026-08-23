/**
 * Movie-detail column budget.
 *
 * The thing these guard: the screen is now one fixed viewport, so there is no
 * scroll to rescue a block that does not fit. Everything below is really two
 * claims — the action buttons are never pushed out of the viewport, and the
 * card is never made to fit by editing its slot constants.
 *
 * Device rows are computed from the exported block constants via
 * `deckBlockHeightFor`, not typed in, so a change to any block moves them and
 * a phone that stops fitting fails here rather than on hardware.
 */
import {
  deckMetrics,
  deckBlockHeightFor,
  ACTIONS_ROW_HEIGHT,
  ACTIONS_GAP,
  DECK_GAP_TOP,
  COLUMN_ABOVE_DECK,
  MIN_SCALE,
} from '../deckMetrics';
import { CARD_HEIGHT, DECK_ZONE_HEIGHT } from '../cardLayout';

/**
 * GlobalBottomBar's height: 1pt top hairline + 8 paddingTop + 38 of icon,
 * gap and label + `Math.max(18, insets.bottom)`. It owns the home-indicator
 * inset on this screen, which is why the deck never adds one itself.
 */
const barHeight = (bottomInset: number) => 47 + Math.max(18, bottomInset);

/** The device the mockup was drawn at. */
const IPHONE_16_PRO = { screenHeight: 874, topInset: 59, barHeight: barHeight(34) };
/** Smallest phone we ship to. */
const IPHONE_SE = { screenHeight: 667, topInset: 20, barHeight: barHeight(0) };
/** Tall Android, gesture navigation. */
const PIXEL_8 = { screenHeight: 915, topInset: 24, barHeight: barHeight(24) };
/** Same phone with 3-button navigation — a deeper bottom inset, so the bar
 *  grows and the deck gets less. */
const PIXEL_8_3BUTTON = { screenHeight: 915, topInset: 24, barHeight: barHeight(48) };

const DEVICES = [
  ['iPhone 16 Pro', IPHONE_16_PRO],
  ['iPhone SE', IPHONE_SE],
  ['Pixel 8', PIXEL_8],
  ['Pixel 8 (3-button)', PIXEL_8_3BUTTON],
] as const;

/** What the deck block ends up laying out, as the component does it. */
const layout = (device: (typeof DEVICES)[number][1]) => {
  const available = deckBlockHeightFor(device);
  const m = deckMetrics({ available });
  const used = DECK_GAP_TOP + m.zoneHeight + ACTIONS_GAP + ACTIONS_ROW_HEIGHT;
  return { ...m, available, used };
};

describe('the fixed screen — the buttons must never leave the viewport', () => {
  it.each(DEVICES)('fits the whole deck block on %s', (_name, device) => {
    const { used, available } = layout(device);
    expect(used).toBeLessThanOrEqual(available);
  });

  it.each(DEVICES)('never crops the card on %s', (_name, device) => {
    // The weaker "the buttons still fit" assertion above passes even when the
    // zone cap is eating the card's bottom edge, which is exactly how the
    // resume chip cropped the iPhone SE unnoticed. This is the one that
    // catches it.
    expect(layout(device).cropped).toBe(false);
  });

  it('caps the zone rather than overflowing, even on a viewport we do not ship to', () => {
    // Below the scale floor the card is cropped; the buttons still render.
    const m = deckMetrics({ available: 200 });
    const used = DECK_GAP_TOP + m.zoneHeight + ACTIONS_GAP + ACTIONS_ROW_HEIGHT;
    expect(used).toBeLessThanOrEqual(200);
    expect(m.cropped).toBe(true);
  });

  it('degrades safely before the first layout pass', () => {
    const m = deckMetrics({ available: 0 });
    expect(m.zoneHeight).toBe(0);
    expect(m.zoneHeight).not.toBeLessThan(0);
  });
});

describe('the card is scaled, never re-cut', () => {
  it('never scales above the mockup, however tall the phone', () => {
    const m = deckMetrics({ available: 2000 });
    expect(m.scale).toBe(1);
    expect(m.zoneHeight).toBe(DECK_ZONE_HEIGHT);
    expect(m.scaled).toBe(false);
  });

  it('holds the card at its full 389pt contract', () => {
    // The escape hatch for a small screen is a uniform scale. A card whose
    // slots were re-tuned per device would be a different design, and the
    // reveal's zero-layout-shift promise would go with it.
    expect(CARD_HEIGHT).toBe(389);
    expect(DECK_ZONE_HEIGHT).toBeGreaterThan(CARD_HEIGHT);
  });

  it('leaves the reference device essentially unscaled', () => {
    // 874 minus the bottom bar is not the 874 the mockup was drawn at, so the
    // 16 Pro pays a few percent. Anything worse than this means a block above
    // the deck has grown and the budget needs re-cutting, not a smaller card.
    const m = layout(IPHONE_16_PRO);
    expect(m.scale).toBeGreaterThan(0.93);
    expect(m.scale).toBeLessThanOrEqual(1);
  });

  it('gives Pixel 8 the design at full size', () => {
    expect(layout(PIXEL_8).scale).toBe(1);
  });

  it('reaches iPhone SE without hitting the legibility floor', () => {
    // The floor exists so a smaller-than-shipping viewport degrades sanely;
    // if the SE ever lands *on* it, the card is being cropped and the budget
    // above the deck is what has to give.
    const m = layout(IPHONE_SE);
    expect(m.scaled).toBe(true);
    expect(m.cropped).toBe(false);
    expect(m.scale).toBeGreaterThan(MIN_SCALE);
    expect(m.scale).toBeLessThan(0.7);
  });
});

describe('invariants', () => {
  it('pins the scale each shipping device gets', () => {
    // Deliberately brittle. The measured height is now the ONLY input to the
    // card's size — the resume note used to be a second one, and while it was
    // up the 16 Pro rendered at 0.857 and jumped to 0.951 the instant it went,
    // while the SE was cropped outright. If a block is added to the column, a
    // number here moves and someone has to decide which device pays for it
    // rather than finding out on hardware.
    expect(layout(IPHONE_16_PRO).scale).toBeCloseTo(0.951, 3);
    expect(layout(IPHONE_SE).scale).toBeCloseTo(0.577, 3);
    expect(layout(PIXEL_8).scale).toBe(1);
    expect(layout(PIXEL_8_3BUTTON).scale).toBe(1);
  });

  it('gives a deeper navigation inset back to the bar, not to the card', () => {
    // Android 3-button navigation reports a deeper bottom inset than gesture
    // nav; GlobalBottomBar grows by it, so the deck must shrink by it.
    const gesture = layout(PIXEL_8);
    const buttons = layout(PIXEL_8_3BUTTON);
    expect(buttons.available).toBeLessThan(gesture.available);
    expect(buttons.used).toBeLessThanOrEqual(buttons.available);
  });

  it('rounds the zone to whole pixels — onLayout reports fractions', () => {
    const m = deckMetrics({ available: 476.6667 });
    expect(Number.isInteger(m.zoneHeight)).toBe(true);
  });

  it('counts every block above the deck exactly once', () => {
    // Guards against a block being added to the screen but not to the budget,
    // which would silently overflow the smallest phone first.
    const device = { screenHeight: 1000, topInset: 50, barHeight: 80 };
    expect(deckBlockHeightFor(device)).toBe(1000 - 80 - 50 - COLUMN_ABOVE_DECK);
  });
});
