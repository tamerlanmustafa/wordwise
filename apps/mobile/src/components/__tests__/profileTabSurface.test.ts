/**
 * Source guards for the two Profile-tab consolidations, both of which are the
 * kind of regression that produces plausible-looking output rather than an
 * error — so nothing at runtime would catch them coming back.
 *
 *  1. **One theme control.** The profile sheet carried Light/Auto/Dark chips
 *     over the same `themeStore` that Settings › Appearance already owns. Two
 *     controls for one preference, and the copy did not even agree: the sheet
 *     hard-coded English ("Auto") while Settings runs its labels through i18n
 *     ("System"). Appearance now lives only in Settings.
 *
 *  2. **Every translation language is offered.** Settings rendered
 *     `AVAILABLE_LANGUAGES.slice(0, 8)`. The list holds twelve, so Chinese,
 *     Dutch, Polish and Azerbaijani could not be chosen from Settings at all —
 *     only during onboarding, which a user passes through once. A truncated
 *     list looks exactly like a complete one.
 *
 * Scanning source is crude, but a slice is not observable from the outside and
 * this runs on every push.
 */

import fs from 'fs';
import path from 'path';
import { AVAILABLE_LANGUAGES } from '../../types/constants';

const COMPONENTS = path.join(__dirname, '..');
const SETTINGS = path.join(COMPONENTS, 'screens', 'SettingsScreen.tsx');

/**
 * Read a source file with its comments removed.
 *
 * These guards look for code, and the code they forbid is usually described in
 * a comment right next to the fix — the very first run of this file tripped on
 * a comment explaining the `slice` it had just deleted. A guard that fires on
 * prose teaches people to stop writing prose.
 */
const read = (p: string) =>
  fs
    .readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the theme preference has exactly one control', () => {
  it('the profile hub does not touch themeStore', () => {
    // Was the profile *sheet* until 2026-09-05; it is a screen now, and the
    // guard follows the surface rather than the file that used to hold it.
    expect(read(path.join(COMPONENTS, 'screens', 'ProfileScreen.tsx'))).not.toMatch(
      /useThemeStore/,
    );
  });

  it('Settings still owns it', () => {
    // The other half of the guard: consolidating onto Settings is only safe
    // while Settings actually has the control.
    expect(read(SETTINGS)).toMatch(/useThemeStore/);
  });

  it('Settings sets it through i18n rather than hard-coded labels', () => {
    // The sheet's chips said "Auto" in every language. Whatever survives has
    // to be the translated one.
    expect(read(SETTINGS)).toMatch(/settings:theme\./);
  });
});

describe('every translation language is offered', () => {
  it('Settings does not truncate the list', () => {
    expect(read(SETTINGS)).not.toMatch(/AVAILABLE_LANGUAGES\s*\.\s*slice/);
  });

  it('the list is longer than the eight that used to render', () => {
    // Guards the premise: if the list ever shrank to eight, the test above
    // would pass for the wrong reason and prove nothing.
    expect(AVAILABLE_LANGUAGES.length).toBeGreaterThan(8);
  });

  it('every entry has an endonym to render', () => {
    // The chips showed the raw code ("ZH"), which is not what a speaker
    // scans for. They render `nativeName` now, so every row needs one.
    for (const lang of AVAILABLE_LANGUAGES) {
      expect(lang.nativeName?.length ?? 0).toBeGreaterThan(0);
      expect(lang.name.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate codes, which would collide as React keys', () => {
    const codes = AVAILABLE_LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('Family Plan renders in the app theme', () => {
  const FAMILY = path.join(COMPONENTS, 'FamilyPlanScreen.tsx');

  it('reads theme tokens instead of a frozen palette', () => {
    // It shipped with its own `COLORS` object of literal hex values, so in
    // dark mode it was a white sheet with near-black text — the only screen
    // in the Profile tree that did not turn over.
    expect(read(FAMILY)).toMatch(/useThemeColors/);
  });

  it('declares no local colour constant of its own', () => {
    expect(read(FAMILY)).not.toMatch(/^const COLORS = \{/m);
  });
});
