/**
 * The upgrade sheet fits on the shortest phones we ship to, without scrolling.
 *
 * It scrolled: ~870pt of content on a 667pt iPhone SE, so the plan cards, the
 * buy button and the way out were below the fold for the people with the least
 * room. Its height is a sum of stated numbers now (`premiumSheetMetrics`).
 * These hold that sum against real phones and pin the source to the numbers,
 * so a feature row or a line of copy added back fails here instead of on a
 * small phone.
 */

import fs from 'fs';
import path from 'path';
import { PAYWALL_FEATURES } from '../../paywallPricing';
import { premiumSheetHeight, premiumSheetRoom } from '../premiumSheetMetrics';

const DIR = path.join(__dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(DIR, ...p), 'utf8');

/** Comments stripped: the docblock describes the scroll view that is gone. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const sheet = () => code(read('PremiumSheet.tsx'));

interface Phone {
  screenHeight: number;
  topInset: number;
  bottomInset: number;
}

/** The phones `filterSheetFits` holds the filter sheet against. */
const PHONES: [string, Phone][] = [
  ['iPhone 17 Pro', { screenHeight: 874, topInset: 62, bottomInset: 34 }],
  ['iPhone 13 mini', { screenHeight: 812, topInset: 50, bottomInset: 34 }],
  ['iPhone SE', { screenHeight: 667, topInset: 20, bottomInset: 0 }],
  ['Android 640, gesture nav', { screenHeight: 640, topInset: 24, bottomInset: 24 }],
  ['Android 640, 3-button nav', { screenHeight: 640, topInset: 24, bottomInset: 48 }],
];

const heightOn = (p: Phone) =>
  premiumSheetHeight({ features: PAYWALL_FEATURES.length, bottomInset: p.bottomInset });

describe('the upgrade sheet on a short phone', () => {
  it.each(PHONES)('fits below the status bar on %s', (_name, p) => {
    expect(heightOn(p)).toBeLessThanOrEqual(premiumSheetRoom(p));
  });

  it('pins the height the SE gets', () => {
    // Deliberately brittle, like the filter sheet's. It was ~870 and scrolled.
    // A block added to the sheet moves this number, and whoever adds it
    // decides whether the smallest phones can afford it.
    const se = PHONES.find(([name]) => name === 'iPhone SE')![1];
    expect(heightOn(se)).toBe(529);
  });
});

describe('the source is the arithmetic', () => {
  it('has nothing to scroll and no cap to scroll inside', () => {
    const s = sheet();
    expect(s).not.toMatch(/ScrollView/);
    expect(s).not.toMatch(/maxHeight/);
  });

  it('pads the safe area, not the tab bar it covers', () => {
    // It mounts after the bar at the app root, so the bar is behind it. The
    // bar's height in here was ~90pt of blank space under "Later".
    const s = sheet();
    expect(s).not.toMatch(/useBottomBarInset/);
    expect(s).toMatch(/paddingBottom: PREMIUM_SHEET\.padBottom \+ insets\.bottom/);
    const app = code(fs.readFileSync(path.join(DIR, '..', '..', 'core', 'App.tsx'), 'utf8'));
    expect(app.indexOf('<PremiumSheet')).toBeGreaterThan(app.indexOf('<GlobalBottomBar'));
  });

  it('draws each feature as one line, from the shared list', () => {
    const s = sheet();
    expect(s).toMatch(/PAYWALL_FEATURES\.map/);
    expect(s).not.toMatch(/f\.desc/);
    expect(s).toMatch(/height: PREMIUM_SHEET\.features\.row/);
  });

  it('states the heights the sum assumes', () => {
    const s = sheet();
    expect(s).toMatch(/paddingTop: PREMIUM_SHEET\.padTop/);
    expect(s).toMatch(/marginBottom: PREMIUM_SHEET\.grabber\.gap/);
    expect(s).toMatch(/lineHeight: PREMIUM_SHEET\.eyebrow\.line/);
    expect(s).toMatch(/lineHeight: PREMIUM_SHEET\.hero\.line/);
    expect(s).toMatch(/lineHeight: PREMIUM_SHEET\.sub\.line/);
    expect(s).toMatch(/height: PREMIUM_SHEET\.plans\.height/);
    expect(s).toMatch(/height: PREMIUM_SHEET\.lifetime\.height/);
    expect(s).toMatch(/height: PREMIUM_SHEET\.cta\.height/);
    expect(s).toMatch(/edgeDepth=\{PREMIUM_SHEET\.cta\.edge\}/);
    expect(s).toMatch(/height: PREMIUM_SHEET\.hint\.line \* PREMIUM_SHEET\.hint\.lines/);
    expect(s).toMatch(/lineHeight: PREMIUM_SHEET\.footer\.line/);
  });

  it('caps the copy whose length depends on the language, and shrinks it to fit', () => {
    // Russian's preview-budget subtitle runs to three lines at full size on an
    // SE; uncapped, it would grow the sheet past the sum.
    const s = sheet();
    expect(s).toMatch(/numberOfLines=\{PREMIUM_SHEET\.hero\.lines\}/);
    expect(s).toMatch(/numberOfLines=\{PREMIUM_SHEET\.sub\.lines\}/);
    expect(s).toMatch(/numberOfLines=\{PREMIUM_SHEET\.hint\.lines\}/);
  });

  it('shrinks only those three blocks, never the short labels', () => {
    // Exactly three: the headline, the subtitle and the renewal terms, all
    // full-width. On a centred plan card the same prop shrank "/year" to about
    // 5pt on a 3x iPhone while a 2x SE drew it at full size, so a fourth one is
    // a bug that only some phones show.
    expect((sheet().match(/adjustsFontSizeToFit/g) ?? []).length).toBe(3);
  });
});
