/**
 * The upgrade crown: one square, in the top-right corner of every tab.
 *
 * Placed 2026-09-15, by request, on Home, Explore, Practice, Lists and a
 * film's backdrop. These pin what it has to be wherever it sits, and that it
 * is actually in each of those places: a corner button that quietly goes
 * missing from one tab looks like a design choice rather than a bug. Source
 * guards, because this suite has no render library by project rule.
 */

import fs from 'fs';
import path from 'path';
import { HEADER_CONTROL } from '../../ui/headerControl';

const SRC = path.join(__dirname, '..', '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

/** Comments stripped: the docblocks name things the code must not do. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const button = () => code(read('components', 'premium', 'UpgradeButton.tsx'));

describe('the upgrade button', () => {
  it('opens the one upgrade sheet rather than navigating to a screen', () => {
    // A sheet leaves the tab behind it intact (see premiumSheetStore).
    const b = button();
    expect(b).toMatch(/openPremiumSheet\(reason\)/);
    expect(b).not.toMatch(/PaywallScreen|navigate/i);
  });

  it('shows only to accounts known to be free', () => {
    // `useIsPremium` fails closed: a tier the server has not reported yet
    // counts as free. Right for a gate, wrong for a pitch — every cold start
    // would ask a paying member to pay until /auth/me answered.
    const b = button();
    expect(b).toMatch(/const entitlements = useEntitlements\(\);/);
    expect(b).toMatch(/return entitlements !== undefined && !entitlements\.is_premium;/);
    expect(b).toMatch(/if \(!shows\) return null;/);
    expect(b).not.toMatch(/useIsPremium/);
  });

  it('keeps an unknown tier distinct from free in the hook it relies on', () => {
    // The guard above is only as good as this: if useEntitlements ever
    // defaulted to the free entitlements, the crown would pitch on unknown.
    const store = code(read('stores', 'entitlementsStore.ts'));
    expect(store).toMatch(
      /export function useEntitlements\(\): Entitlements \| undefined \{[\s\S]*?if \(!user\?\.entitlements\) return undefined;/,
    );
  });

  it('is a square the size of the filter button, from the same constant', () => {
    // Square where the filter button is wider, because that one also prints
    // a level. One constant for both, so the two heights cannot drift.
    expect(button()).toMatch(
      /width: HEADER_CONTROL\.size,\s*height: HEADER_CONTROL\.size,\s*borderRadius: HEADER_CONTROL\.radius,/,
    );
    const bar = code(read('components', 'filmFeed', 'SearchBar.tsx'));
    expect(bar).toMatch(/const FIELD_RADIUS = HEADER_CONTROL\.radius;/);
    expect(bar).toMatch(
      /filterBtn: \{\s*width: FILTER_W,\s*height: HEADER_CONTROL\.size,\s*borderRadius: FIELD_RADIUS,/,
    );
    expect(HEADER_CONTROL.size).toBeGreaterThanOrEqual(44);
  });

  it('draws a crown from the icon set', () => {
    expect(button()).toMatch(/<CrownIcon /);
    expect(read('components', 'ui', 'icons', 'index.ts')).toMatch(/CrownIcon,/);
  });

  it('taps back exactly once, on a primitive that does not tap on its own', () => {
    // PressableScale buzzes by itself, so a withTap on it would be two.
    const b = button();
    expect(b.match(/withTap\(/g) ?? []).toHaveLength(1);
    expect(b).not.toMatch(/PressableScale/);
  });

  it('can join a dimmed row and close its panel instead of opening the sheet', () => {
    const b = button();
    expect(b).toMatch(/dimmed && s\.dimmed/);
    expect(b).toMatch(/onPress=\{withTap\(onDismiss \?\? \(\(\) => openPremiumSheet\(reason\)\)\)\}/);
  });

  it('speaks the translated label', () => {
    const b = button();
    expect(b).toMatch(/accessibilityLabel=\{t\('settings:upgradeToPlus'\)\}/);
    expect(b).toMatch(/accessibilityRole="button"/);
  });
});

describe('it sits in the top-right corner of every screen it was asked for', () => {
  const PLACES: [string, string[]][] = [
    ['Home', ['components', 'WordFeedScreen.tsx']],
    ['Explore', ['components', 'filmFeed', 'SearchBar.tsx']],
    ['Practice', ['components', 'PracticeScreen.tsx']],
    ['Lists', ['components', 'screens', 'ListsIndexScreen.tsx']],
    ['a film', ['components', 'screens', 'MovieDetailHero.tsx']],
  ];

  it.each(PLACES)('%s renders it once', (_name, file) => {
    expect(code(read(...file)).match(/<UpgradeButton\b/g) ?? []).toHaveLength(1);
  });

  it('Explore puts it after the filter button', () => {
    const bar = code(read('components', 'filmFeed', 'SearchBar.tsx'));
    expect(bar.indexOf('<UpgradeButton')).toBeGreaterThan(bar.indexOf('s.filterBtn'));
  });

  it('Explore dims it with the rest of the row', () => {
    const bar = code(read('components', 'filmFeed', 'SearchBar.tsx'));
    expect(bar).toMatch(/dimmed=\{focused \|\| filtersOpen\}/);
    expect(bar).toMatch(/onDismiss=\{focused \? onDismiss : filtersOpen \? onDismissFilters : undefined\}/);
  });

  it('Lists puts it after the +', () => {
    const lists = code(read('components', 'screens', 'ListsIndexScreen.tsx'));
    expect(lists.indexOf('<UpgradeButton')).toBeGreaterThan(lists.indexOf('s.addGlyph'));
  });

  it('Practice puts it after the streak panel, in the header row', () => {
    const practice = code(read('components', 'PracticeScreen.tsx'));
    expect(practice.indexOf('<UpgradeButton')).toBeGreaterThan(practice.indexOf('<StreakWeek'));
    expect(practice.indexOf('<UpgradeButton')).toBeLessThan(practice.indexOf('s.pathArea'));
  });

  it('Home and the film pin it to the trailing edge, off the layout budget', () => {
    // Neither screen has a header row to put it in. Absolute, so the word
    // card's four bands and the deck column's BACK_ROW keep their heights.
    const files = [
      ['components', 'WordFeedScreen.tsx'],
      ['components', 'screens', 'MovieDetailHero.tsx'],
    ];
    for (const file of files) {
      const src = code(read(...file));
      const block = src.slice(src.indexOf('    upgrade: {'));
      expect(block.slice(0, block.indexOf('},'))).toMatch(/position: 'absolute',\s*end: 18,/);
    }
  });
});

describe('the Explore search says what it searches', () => {
  it('names films only, in every language', () => {
    // It searches films. The placeholder promised words and actors as well.
    const dir = path.join(SRC, 'i18n', 'locales');
    const langs = fs
      .readdirSync(dir)
      .filter((d) => fs.existsSync(path.join(dir, d, 'home.json')));
    expect(langs.length).toBeGreaterThanOrEqual(6);
    expect(JSON.parse(read('i18n', 'locales', 'en', 'home.json')).search.placeholder).toBe(
      'Search films…',
    );
    for (const lang of langs) {
      const ns = JSON.parse(read('i18n', 'locales', lang, 'home.json'));
      // One thing to search for: no list of three.
      expect(ns.search.placeholder).not.toMatch(/[,،]/);
    }
  });
});
