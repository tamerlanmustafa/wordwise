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
  DECK_SIDE_MARGIN,
  DECK_MIN_SIDE_MARGIN,
  deckSideMargin,
  ACTIONS_GAP,
  DECK_GAP_TOP,
  COLUMN_ABOVE_DECK,
  MIN_SCALE,
  SHOW_LEVEL_FILTER_BAR,
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

  it('holds the card at its full 427pt contract', () => {
    // The escape hatch for a small screen is a uniform scale. A card whose
    // slots were re-tuned per device would be a different design, and the
    // reveal's zero-layout-shift promise would go with it.
    //
    // 389 → 427 when the definition slot landed (6 top + 32 slot). The
    // alternative was taking those 38pt out of the sentence-translation slot
    // to hold 389, which would have cost a line of every revealed translation
    // on every device; growing the card costs scale on the SE alone (see the
    // pinned scales below) and nothing at all on the reference phones.
    expect(CARD_HEIGHT).toBe(427);
    expect(DECK_ZONE_HEIGHT).toBeGreaterThan(CARD_HEIGHT);
  });

  it('leaves the reference device essentially unscaled', () => {
    // 874 minus the bottom bar is not the 874 the mockup was drawn at, so the
    // 16 Pro used to pay a few percent; with the filter bar hidden it seats the
    // design whole. Anything worse than this means a block above the deck has
    // grown and the budget needs re-cutting, not a smaller card.
    const m = layout(IPHONE_16_PRO);
    expect(m.scale).toBeGreaterThan(0.93);
    expect(m.scale).toBeLessThanOrEqual(1);
  });

  it('seats the mockup whole on the reference device with the filter bar hidden', () => {
    // The 58pt the level chips used to occupy is the difference between the
    // 16 Pro scaling to 0.951 and seating DECK_ZONE_HEIGHT at full size. This
    // is the assertion that fails first if a block is added back to the column
    // — before the pinned numbers below, and with a clearer reason.
    expect(SHOW_LEVEL_FILTER_BAR).toBe(false);
    const forZone = layout(IPHONE_16_PRO).available - DECK_GAP_TOP - ACTIONS_GAP - ACTIONS_ROW_HEIGHT;
    expect(forZone).toBeGreaterThanOrEqual(DECK_ZONE_HEIGHT);
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
    // Upper bound only says the SE is still the device that scales — the exact
    // figure is pinned below, where a change has to be explained.
    expect(m.scale).toBeLessThan(1);
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
    //
    // Hiding the level chips (SHOW_LEVEL_FILTER_BAR) took 58pt back out of the
    // column, which is why the 16 Pro is now unscaled and the SE moved 0.577 →
    // 0.720. Flipping the flag on restores the old numbers.
    //
    // The definition slot then grew the CARD (not the column), which is the
    // other way a number here moves: the large phones had slack above 1 and
    // absorbed 38pt without leaving the clamp, so they still render the
    // mockup 1:1, and the SE — the only device already scaling — paid the
    // whole cost, 0.720 → 0.658. Still well clear of MIN_SCALE, so nothing
    // crops. That asymmetry is the reason this was worth doing as a card
    // change rather than by shrinking a neighbouring slot.
    //
    // Dropping the poster's paper frame then handed 19pt back to the column
    // (HERO_PLATE 119 → 100) and the SE — again the only device below the
    // clamp — is again the only one that moves: 0.658 → 0.701.
    //
    // Then the hero poster was removed, taking that block down to what the
    // film's own lines need and handing the difference back to the column —
    // 100 → 86 once the band chip moved above the title and claimed a row of
    // its own. The SE is still the only device under the clamp, so once more
    // it is the only one that moves: 0.701 → 0.733. The big phones stay at 1
    // and take theirs as air, which is what the deck's new
    // `justifyContent: 'center'` distributes above and below it.
    expect(layout(IPHONE_16_PRO).scale).toBe(1);
    expect(layout(IPHONE_SE).scale).toBeCloseTo(0.733, 3);
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

describe('the deck uses the width it has', () => {
  // A Samsung S24 next to an iPhone 16 Pro: shorter viewport, so a scale under
  // 1, so a uniformly smaller card — including in a direction that was never
  // short of room. The gutters either side were the visible symptom.
  const S24_WIDTH = 360;

  it('leaves the inset alone when nothing is being scaled', () => {
    expect(deckSideMargin(S24_WIDTH, 1)).toBe(DECK_SIDE_MARGIN);
    expect(deckSideMargin(393, 1)).toBe(DECK_SIDE_MARGIN);
  });

  it('gives back exactly what a mild scale took off the sides', () => {
    // The post-transform card lands at the width an unscaled one would have:
    // widen the pre-transform box by 1/scale and the scale returns it.
    const scale = 0.95;
    const margin = deckSideMargin(S24_WIDTH, scale);
    const rendered = (S24_WIDTH - margin * 2) * scale;
    expect(rendered).toBeCloseTo(S24_WIDTH - DECK_SIDE_MARGIN * 2, 5);
  });

  it('never lays the deck out wider than its parent', () => {
    // The exact compensation goes negative once the scale is small enough, and
    // on Android a child outside its parent's bounds stops receiving touches —
    // the card would look right and answer nothing.
    for (let scale = 0.5; scale <= 1; scale += 0.01) {
      for (const width of [320, 360, 393, 430]) {
        const margin = deckSideMargin(width, scale);
        expect(margin).toBeGreaterThanOrEqual(DECK_MIN_SIDE_MARGIN);
        expect(width - margin * 2).toBeLessThanOrEqual(width);
      }
    }
  });

  it('reclaims monotonically — a harder squeeze never gives back less', () => {
    let previous = Infinity;
    for (let scale = 1; scale >= 0.7; scale -= 0.01) {
      const margin = deckSideMargin(S24_WIDTH, scale);
      expect(margin).toBeLessThanOrEqual(previous + 1e-9);
      previous = margin;
    }
  });

  it('degrades to the floor rather than to nonsense before layout', () => {
    // Width is 0 on the first frame, and the deck renders that frame.
    expect(deckSideMargin(0, 0.8)).toBe(DECK_SIDE_MARGIN);
  });
});
