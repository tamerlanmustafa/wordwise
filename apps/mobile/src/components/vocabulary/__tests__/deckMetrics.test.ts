/**
 * Movie-detail column budget.
 *
 * The thing these guard: the screen is one fixed viewport, so there is no
 * scroll to rescue a block that does not fit. Everything below is really three
 * claims — the action buttons are never pushed out of the viewport, the tab bar
 * is always in the budget, and a short phone gives up its header, its gaps and
 * then its card slots, in that order and only as far as it has to.
 *
 * Device rows are computed from the exported block constants and the bar's own
 * metrics, not typed in, so a change to any block moves them and a phone that
 * stops fitting fails here rather than on hardware.
 */
import fs from 'fs';
import path from 'path';
import {
  deckMetrics,
  deckBlockHeightFor,
  deckChromeHeight,
  deckLayoutFor,
  deckSideMargin,
  columnAboveDeck,
  ACTIONS_ROW_HEIGHT,
  ACTIONS_GAP,
  ACTIONS_GAP_COMPACT,
  COLUMN_ABOVE_DECK,
  DECK_EDGE_INSET,
  DECK_GAP_TOP,
  DECK_GAP_TOP_COMPACT,
  DECK_HEADER_ROW,
  DECK_MIN_SIDE_MARGIN,
  DECK_SIDE_MARGIN,
  HERO_PLATE,
  HERO_PLATE_GAP_COMPACT,
  MIN_SCALE,
  SHOW_LEVEL_FILTER_BAR,
  type DeckDevice,
  type DeckLayout,
} from '../deckMetrics';
import { CARD_HEIGHT, DECK_ZONE_HEIGHT, movieTitleTier } from '../cardLayout';
import { navBarMetrics } from '../../navBarMetrics';

/** The bar's reserved height, as `useBottomBarInset` computes it: the iOS 26
 *  glass capsule on the iPhones, the pinned bar on Android. */
const bar = (bottomInset: number, glass: boolean) =>
  navBarMetrics(bottomInset, glass).reservedHeight;

/** The device the mockup was drawn at. */
const IPHONE_16_PRO: DeckDevice = { screenHeight: 874, topInset: 59, barHeight: bar(34, true) };
/** Smallest phone we ship to: a 20pt status bar and no home indicator. */
const IPHONE_SE: DeckDevice = { screenHeight: 667, topInset: 20, barHeight: bar(0, true) };
/** The shortest notched iPhone. */
const IPHONE_13_MINI: DeckDevice = { screenHeight: 812, topInset: 50, barHeight: bar(34, true) };
/** Tall Android, gesture navigation. */
const PIXEL_8: DeckDevice = { screenHeight: 915, topInset: 24, barHeight: bar(24, false) };
/** Same phone with 3-button navigation — a deeper bottom inset, so the bar
 *  grows and the deck gets less. */
const PIXEL_8_3BUTTON: DeckDevice = { screenHeight: 915, topInset: 24, barHeight: bar(48, false) };
/** An Android phone as short as the SE, with a status bar and a gesture strip
 *  the SE does not have. */
const SHORT_ANDROID: DeckDevice = { screenHeight: 640, topInset: 24, barHeight: bar(24, false) };
/** …and with 3-button navigation: the least room of anything we ship to. */
const SHORT_ANDROID_3BUTTON: DeckDevice = { screenHeight: 640, topInset: 24, barHeight: bar(48, false) };

const DEVICES: [string, DeckDevice][] = [
  ['iPhone 16 Pro', IPHONE_16_PRO],
  ['iPhone SE', IPHONE_SE],
  ['iPhone 13 mini', IPHONE_13_MINI],
  ['Pixel 8', PIXEL_8],
  ['Pixel 8 (3-button)', PIXEL_8_3BUTTON],
  ['short Android', SHORT_ANDROID],
  ['short Android (3-button)', SHORT_ANDROID_3BUTTON],
];

const NONE: DeckLayout = { compactColumn: false, compactCard: false };

/** What the deck block ends up laying out, as the screen does it: the steps
 *  `deckLayoutFor` picks, unless a test forces them. */
const layout = (device: DeckDevice, forced: Partial<DeckLayout> = {}) => {
  const steps = { ...deckLayoutFor(device), ...forced };
  const available = deckBlockHeightFor({ ...device, compact: steps.compactColumn });
  const m = deckMetrics({ available, ...steps });
  const used = deckChromeHeight(steps.compactColumn) + m.zoneHeight;
  return { ...m, ...steps, available, used };
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
    expect(deckChromeHeight(false) + m.zoneHeight).toBeLessThanOrEqual(200);
    expect(m.cropped).toBe(true);
  });

  it('degrades safely before the first layout pass', () => {
    const m = deckMetrics({ available: 0 });
    expect(m.zoneHeight).toBe(0);
    expect(m.zoneHeight).not.toBeLessThan(0);
  });
});

describe('the tab bar is always in the budget', () => {
  it('counts every block above the deck, and the bar, exactly once', () => {
    // Guards against a block being added to the screen but not to the budget,
    // which would silently overflow the smallest phone first.
    const device = { screenHeight: 1000, topInset: 50, barHeight: 80 };
    expect(deckBlockHeightFor({ ...device, compact: false })).toBe(
      1000 - 80 - 50 - COLUMN_ABOVE_DECK,
    );
  });

  it('gives a deeper navigation inset to the bar, not to the card', () => {
    // Android 3-button navigation reports a deeper bottom inset than gesture
    // nav; GlobalBottomBar grows by it, so the deck must shrink by it.
    const gesture = layout(PIXEL_8);
    const buttons = layout(PIXEL_8_3BUTTON);
    expect(buttons.available).toBeLessThan(gesture.available);
    expect(buttons.used).toBeLessThanOrEqual(buttons.available);
  });
});

describe('the regular card on a tall phone', () => {
  it('never scales above the mockup, however tall the phone', () => {
    const m = deckMetrics({ available: 2000 });
    expect(m.scale).toBe(1);
    expect(m.zoneHeight).toBe(DECK_ZONE_HEIGHT);
    expect(m.scaled).toBe(false);
  });

  it('holds the regular card at its full 427pt contract', () => {
    expect(CARD_HEIGHT).toBe(427);
    expect(DECK_ZONE_HEIGHT).toBeGreaterThan(CARD_HEIGHT);
  });

  it('seats the mockup whole on the reference device with the full header', () => {
    // The first assertion to fail if a block is added back to the column.
    expect(SHOW_LEVEL_FILTER_BAR).toBe(false);
    expect(layout(IPHONE_16_PRO)).toMatchObject({ ...NONE, scale: 1 });
  });

  it('gives Pixel 8 the design at full size, with either navigation', () => {
    expect(layout(PIXEL_8)).toMatchObject({ ...NONE, scale: 1 });
    expect(layout(PIXEL_8_3BUTTON)).toMatchObject({ ...NONE, scale: 1 });
  });
});

describe('a short phone gives way in steps, and only as far as it must', () => {
  it.each(DEVICES)('tightens the column on %s only if the full layout would shrink the card', (_name, device) => {
    expect(layout(device).compactColumn).toBe(layout(device, NONE).scaled);
  });

  it.each(DEVICES)('switches to the compact card on %s only if the tighter column still would', (_name, device) => {
    const steps = layout(device);
    const columnOnly = layout(device, { compactColumn: true, compactCard: false });
    expect(steps.compactCard).toBe(steps.compactColumn && columnOnly.scaled);
  });

  it('seats the regular card whole on the 13 mini after the first step', () => {
    // So its long sentences keep their fourth line. The card step costs lines
    // of real content, which is why it is the last thing to give.
    expect(layout(IPHONE_13_MINI)).toMatchObject({
      compactColumn: true,
      compactCard: false,
      scale: 1,
    });
  });

  it('takes both steps on the SE and on short Android', () => {
    for (const device of [IPHONE_SE, SHORT_ANDROID, SHORT_ANDROID_3BUTTON]) {
      expect(layout(device)).toMatchObject({ compactColumn: true, compactCard: true });
    }
  });

  it.each(DEVICES)('never makes the text smaller on %s', (_name, device) => {
    // The scale is what sets the rendered type size, on either card.
    expect(layout(device).scale).toBeGreaterThanOrEqual(layout(device, NONE).scale);
  });

  it('keeps every short phone clear of the legibility floor', () => {
    for (const device of [IPHONE_SE, SHORT_ANDROID, SHORT_ANDROID_3BUTTON]) {
      expect(layout(device).scale).toBeGreaterThan(MIN_SCALE);
    }
  });

  it('the column step gives up the counter row, part of the plate gap and the deck gaps', () => {
    // Nothing on the card: that is the second step's job. The title keeps both
    // lines and the progress rule stays.
    expect(COLUMN_ABOVE_DECK - columnAboveDeck(true)).toBe(
      DECK_HEADER_ROW.gap + DECK_HEADER_ROW.height + (HERO_PLATE.gap - HERO_PLATE_GAP_COMPACT),
    );
    expect(deckChromeHeight(false) - deckChromeHeight(true)).toBe(
      DECK_GAP_TOP - DECK_GAP_TOP_COMPACT + (ACTIONS_GAP - ACTIONS_GAP_COMPACT),
    );
    expect(deckChromeHeight(true)).toBe(DECK_GAP_TOP_COMPACT + ACTIONS_GAP_COMPACT + ACTIONS_ROW_HEIGHT);
  });

  it('still leaves air between the back button and a two-line title', () => {
    // The plate is bottom-aligned, so a two-line title at the larger tier —
    // the band line (19 + 7), both lines, 4 under them — rises out of its top.
    // Whatever gap is left after that is what separates it from Back.
    const tier = movieTitleTier('Toy Story');
    const content = 19 + 7 + tier.lineHeight * tier.lines + 4;
    const overflow = Math.max(0, content - HERO_PLATE.height);
    expect(HERO_PLATE_GAP_COMPACT - overflow).toBeGreaterThanOrEqual(6);
  });
});

describe('invariants', () => {
  it('pins the scale each shipping device gets', () => {
    // Deliberately brittle: if a block is added to the column, a number here
    // moves and someone has to decide which device pays for it rather than
    // finding out on hardware.
    //
    // Every change so far has been paid by the SE alone, the only device below
    // the clamp. The filter bar, the poster frame and the poster left the
    // column and it went 0.577 → 0.733 by this file's arithmetic — but that
    // arithmetic modelled the old pinned bar, and the 81pt glass capsule that
    // ships left the real card at 0.697. Hiding the bar on this screen took it
    // to 0.917 and was reverted by request the same day: the bar stays. With
    // the bar in the budget, a short phone tightens its column and then
    // switches to the compact card. The mini seats the regular card whole
    // after the first step.
    expect(layout(IPHONE_16_PRO).scale).toBe(1);
    expect(layout(IPHONE_SE).scale).toBeCloseTo(0.8631, 4);
    expect(layout(IPHONE_13_MINI).scale).toBe(1);
    expect(layout(PIXEL_8).scale).toBe(1);
    expect(layout(PIXEL_8_3BUTTON).scale).toBe(1);
    expect(layout(SHORT_ANDROID).scale).toBeCloseTo(0.7922, 4);
    expect(layout(SHORT_ANDROID_3BUTTON).scale).toBeCloseTo(0.7335, 4);
  });

  it('rounds the zone to whole pixels — onLayout reports fractions', () => {
    const m = deckMetrics({ available: 476.6667 });
    expect(Number.isInteger(m.zoneHeight)).toBe(true);
  });
});

describe('the screen wires the steps through', () => {
  const read = (...parts: string[]) =>
    fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8');
  /** Source with comments stripped — this is about code, not the prose. */
  const code = (src: string) =>
    src
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('decides the steps from the bar it reserves', () => {
    const screen = code(read('screens', 'MovieDetailScreen.tsx'));
    expect(screen).toMatch(/const barInset = useBottomBarInset\(\)/);
    expect(screen).toMatch(/deckLayoutFor\(\{[\s\S]*?barHeight: barInset/);
    expect(screen).toMatch(/compactColumn=\{compactColumn\}/);
    expect(screen).toMatch(/compactCard=\{compactCard\}/);
  });

  it('draws every card face from the geometry, not the regular card constants', () => {
    // The ghost, the focused card and the fly-away overlay are one card a
    // moment apart. A face still reading the regular numbers on a compact phone
    // would jump at the instant of promotion.
    const deck = code(read('vocabulary', 'WordCardDeck.tsx'));
    expect(deck).not.toMatch(
      /\b(CARD_HEIGHT|CARD_PADDING|DECK_ZONE_HEIGHT|SENTENCE_SLOT_HEIGHT|SENTENCE_TR_SLOT_HEIGHT)\b/,
    );
    expect(deck).toMatch(/height: g\.zoneHeight/);
    expect(deck.match(/sentenceTier\([^)]*, compactCard\)/g) ?? []).toHaveLength(2);
    expect(deck.match(/sentenceTranslationTier\([^)]*, compactCard\)/g) ?? []).toHaveLength(1);
  });

  it('lets a scaled card reach the film edge on both platforms', () => {
    const deck = code(read('vocabulary', 'WordCardDeck.tsx'));
    expect(deck).toMatch(/deckSideMargin\(deckWidth, metrics\.scale, true\)/);
  });
});

describe('the deck uses the width it has', () => {
  // A Samsung S24 next to an iPhone 16 Pro: shorter viewport, so a scale under
  // 1, so a uniformly smaller card — including in a direction that was never
  // short of room. The gutters either side were the visible symptom.
  const S24_WIDTH = 360;

  /** Where the card's edge actually lands once the transform has run. */
  const renderedInset = (width: number, scale: number, reclaim: boolean) => {
    const m = deckSideMargin(width, scale, reclaim);
    return m + ((width - m * 2) * (1 - scale)) / 2;
  };

  it.each([true, false])('leaves the inset alone at scale 1 (reclaim=%s)', (reclaim) => {
    expect(deckSideMargin(S24_WIDTH, 1, reclaim)).toBe(DECK_SIDE_MARGIN);
    expect(deckSideMargin(393, 1, reclaim)).toBe(DECK_SIDE_MARGIN);
  });

  it('lands the reclaiming card on the film-edge sprockets, where it can', () => {
    // The strips occupy x = 6..14 (FilmEdgeBackdrop: left 6, width 8). The
    // card may reach them and must not cross them.
    //
    // "Where it can" is the honest qualifier and the first draft of this test
    // got it wrong: below about 0.92 on this width the solve wants a negative
    // margin, which is the one thing it may not have, so the target stops
    // being reachable and 0 is the best available answer.
    for (const scale of [0.93, 0.95, 0.98]) {
      expect(renderedInset(S24_WIDTH, scale, true)).toBeCloseTo(DECK_EDGE_INSET, 5);
      expect(deckSideMargin(S24_WIDTH, scale, true)).toBeGreaterThan(0);
    }
  });

  it('gives everything it has once the target is out of reach', () => {
    // A hard scale cannot be compensated without laying out wider than the
    // parent, so the margin goes to 0 and the card is as wide as it can be.
    for (const scale of [0.6, 0.7, 0.8]) {
      expect(deckSideMargin(S24_WIDTH, scale, true)).toBe(0);
      expect(renderedInset(S24_WIDTH, scale, true)).toBeGreaterThan(DECK_EDGE_INSET);
    }
  });

  it('holds the non-reclaiming card at its resting inset', () => {
    // The non-reclaiming target: the solve aims at 18 rather than the
    // sprockets, and stops at the 8pt floor.
    for (const scale of [0.96, 0.98]) {
      expect(renderedInset(375, scale, false)).toBeCloseTo(DECK_SIDE_MARGIN, 5);
    }
    expect(deckSideMargin(375, 0.9, false)).toBe(DECK_MIN_SIDE_MARGIN);
  });

  it('never lets the card cross the sprocket strips', () => {
    // 14 is a boundary, not a target to overshoot: past it the card sits on
    // the film edge instead of inside it.
    for (let scale = 0.55; scale <= 1; scale += 0.01) {
      for (const width of [320, 360, 393, 430]) {
        expect(renderedInset(width, scale, true)).toBeGreaterThanOrEqual(DECK_EDGE_INSET - 1e-6);
      }
    }
  });

  it('never lays the deck out wider than its parent', () => {
    // The solve goes negative once the scale is small enough, and on Android a
    // child outside its parent's bounds stops receiving touches — the card
    // would look right and answer nothing.
    for (let scale = 0.5; scale <= 1; scale += 0.01) {
      for (const width of [320, 360, 393, 430]) {
        for (const reclaim of [true, false]) {
          expect(deckSideMargin(width, scale, reclaim)).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('keeps the floor off the reclaiming path, which is what blocked it', () => {
    // The exact answer on an S24 is about 4. A floor of 8 raised it, pushing
    // the card further in than the solve asked for — caution with no failure
    // behind it, since 0 is the only real constraint.
    expect(deckSideMargin(S24_WIDTH, 0.92, true)).toBeLessThan(DECK_MIN_SIDE_MARGIN);
    expect(deckSideMargin(S24_WIDTH, 0.92, false)).toBe(DECK_MIN_SIDE_MARGIN);
  });

  it('never sits further in than an unscaled card', () => {
    for (let scale = 0.55; scale <= 1; scale += 0.01) {
      for (const reclaim of [true, false]) {
        expect(deckSideMargin(S24_WIDTH, scale, reclaim)).toBeLessThanOrEqual(DECK_SIDE_MARGIN);
      }
    }
  });

  it('degrades to the resting inset before layout', () => {
    // Width is 0 on the first frame, and the deck renders that frame.
    expect(deckSideMargin(0, 0.8, true)).toBe(DECK_SIDE_MARGIN);
  });
});
