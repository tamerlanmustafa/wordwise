/**
 * A CEFR band is one colour everywhere in the app.
 *
 * This is not a styling preference. A level is one of the few things WordWise
 * shows that means exactly the same thing on every screen, so when the ring
 * sheet's B2 and the word card's B2 are different colours the user is not
 * looking at a theme inconsistency — they are looking at what appears to be
 * two different pieces of data.
 *
 * The app had three band palettes: `theme/palette.ts` running green→purple, a
 * dead `theme/index.ts` running green→red, and the ramp behind the vocabulary
 * sheet's bar. Two of them were both exported as `cefrColors`. This pins the
 * single definition that replaced them.
 */

import fs from 'fs';
import path from 'path';
import { cefrColors, cefrColorsDark } from '../palette';
import { cefrRamp, cefrRampFor, cefrColorFor } from '../cefrRamp';
import { themes } from '../tokens';
import { CEFR_LEVELS } from '../../types/constants';

const SRC = path.join(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

describe('one definition', () => {
  it('has deleted the third band palette', () => {
    // Unreferenced, and running its own green→red scale under the same export
    // name as palette.ts's green→purple one.
    expect(fs.existsSync(path.join(SRC, 'theme', 'index.ts'))).toBe(false);
  });

  it('derives the static maps from the ramp rather than listing hexes', () => {
    const palette = read('theme', 'palette.ts');
    expect(palette).toMatch(/from '\.\/cefrRamp'/);
    // The old literal maps, in the form they were written.
    expect(palette).not.toMatch(/A1: '#4CAF50'/);
    expect(palette).not.toMatch(/C2: '#9C27B0'/);
  });

  it('makes cefrColors the dark projection and cefrColorsDark the light one', () => {
    // The names are historical: `cefrColorsDark` has always meant "on a light
    // surface", which is the light theme's already-darkened accents.
    const vivid = cefrRamp(themes.dark.gold, themes.dark.error);
    const muted = cefrRamp(themes.light.gold, themes.light.error);
    CEFR_LEVELS.forEach((code, i) => {
      expect(cefrColors[code]).toBe(vivid[i]);
      expect(cefrColorsDark[code]).toBe(muted[i]);
    });
  });

  it('covers every band in both maps', () => {
    for (const code of CEFR_LEVELS) {
      expect(cefrColors[code]).toMatch(/^#[0-9A-F]{6}$/);
      expect(cefrColorsDark[code]).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});

describe('the surfaces that show a level agree', () => {
  it('gives the movie detail deck the same ramp the ring sheet draws', () => {
    // Both call `cefrRampFor(tc)`, so both follow the active theme. Reading
    // the static `cefrColors` here instead — which is what this screen used to
    // do — left the deck on dark-theme colours in light mode while the sheet
    // two taps away showed the light ones.
    const detail = read('components', 'screens', 'MovieDetailScreen.tsx');
    expect(detail).toMatch(/cefrRampFor\(tc\)/);
    expect(detail).toMatch(/cefrColorFor\(level, ramp\)/);
    expect(detail).not.toMatch(/cefrColors\[/);
    expect(detail).not.toMatch(/cefrColorsDark\[/);

    const sheet = read('components', 'filmFeed', 'VocabularySheet.tsx');
    expect(sheet).toMatch(/cefrRampFor\(tc\)/);
  });

  it('no longer special-cases one band in the sentence highlight', () => {
    // The old palette put a bright amber at B1, which measured 1.63:1 on the
    // light card, so that one level was swapped for a darker gold and stopped
    // matching its own chip. See the contrast test below for why the ramp
    // needs no such patch.
    const deck = read('components', 'vocabulary', 'WordCardDeck.tsx');
    expect(deck).not.toMatch(/B1_HIGHLIGHT/);
    expect(read('components', 'vocabulary', 'cardLayout.ts')).not.toMatch(/B1_HIGHLIGHT/);
  });
});

describe('the ramp is legible on the card it is printed on', () => {
  /** WCAG relative luminance. */
  function luminance(hex: string): number {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lin = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  }
  function contrast(a: string, b: string): number {
    const [la, lb] = [luminance(a), luminance(b)];
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  it('clears 2.9:1 on a white card in light mode', () => {
    // Every band, not just the ones someone remembered to check. The old
    // palette's worst was 1.63:1 — a highlight nobody could see.
    for (const c of cefrRampFor(themes.light)) {
      expect(contrast(c, '#FFFFFF')).toBeGreaterThan(2.9);
    }
  });

  it('clears 6:1 on the dark card', () => {
    for (const c of cefrRampFor(themes.dark)) {
      expect(contrast(c, '#0F1013')).toBeGreaterThan(6);
    }
  });

  it('returns hex, so `${color}22` fills still parse', () => {
    // Six call sites build a translucent chip fill by appending two hex
    // digits. An `rgb()` string there yields `rgb(...)22`, which neither
    // throws nor renders.
    for (const code of CEFR_LEVELS) {
      expect(cefrColorFor(code, cefrRampFor(themes.dark))).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});
