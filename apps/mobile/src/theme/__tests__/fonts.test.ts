/**
 * Font-family resolution.
 *
 * Georgia, Menlo, `serif` and `monospace` carry no Arabic glyphs. Left alone,
 * the OS substitutes one glyph at a time, so a headline mixing Latin and
 * Arabic comes out in two typefaces. Under RTL we therefore hand the whole
 * string to the system face on purpose (#104 §5) — the serif/mono intent is
 * lost either way, and this way it is lost consistently.
 *
 * `fonts.ts` reads `I18nManager.isRTL` once at module load, which is correct
 * because a direction change always reloads the bundle. That means each case
 * has to re-require the module under a pinned flag rather than mutate one —
 * the same shape as `i18n/__tests__/rtl.test.ts`.
 */

type FontsModule = typeof import('../fonts');

function loadFonts(isRTL: boolean, os: 'ios' | 'android'): FontsModule {
  let fonts!: FontsModule;
  jest.isolateModules(() => {
    jest.doMock('react-native', () => ({
      I18nManager: { isRTL },
      Platform: {
        OS: os,
        select: (spec: Record<string, unknown>) => spec[os] ?? spec.default,
      },
    }));
    fonts = require('../fonts');
  });
  return fonts;
}

describe('font families', () => {
  it('keeps the serif/mono intent in left-to-right locales', () => {
    expect(loadFonts(false, 'ios').SERIF_FAMILY).toBe('Georgia');
    expect(loadFonts(false, 'ios').MONO_FAMILY).toBe('Menlo');
    expect(loadFonts(false, 'android').SERIF_FAMILY).toBe('serif');
    expect(loadFonts(false, 'android').MONO_FAMILY).toBe('monospace');
  });

  it('gives the gloss lines an italic that reads as italic, per platform', () => {
    // iOS gets a face whose italic is unmistakable at 12pt; Android has no
    // Charter, and an unknown family there resolves to the default sans.
    expect(loadFonts(false, 'ios').SERIF_ITALIC_FAMILY).toBe('Charter');
    expect(loadFonts(false, 'android').SERIF_ITALIC_FAMILY).toBe('serif');
  });

  it('falls back to the system face under RTL, on both platforms', () => {
    for (const os of ['ios', 'android'] as const) {
      expect(loadFonts(true, os).SERIF_FAMILY).toBeUndefined();
      expect(loadFonts(true, os).MONO_FAMILY).toBeUndefined();
      expect(loadFonts(true, os).SERIF_ITALIC_FAMILY).toBeUndefined();
    }
  });
});

describe('apparent size', () => {
  /**
   * The guard that yesterday's Baskerville needed and did not have.
   *
   * The card deck seats the gloss in a fixed-height slot with a 2-line clamp,
   * so it cannot correct a family's size at the style — the only lever is
   * picking a face whose lowercase already draws like the Georgia beside it.
   * Baskerville was 16% short, which is what "too small on my iPhone, fine on
   * my Samsung" looked like. 3% is roughly the point where a reader stops
   * seeing two sizes on one card.
   */
  const TOLERANCE_PCT = 3;

  it('keeps the italic serif within 3% of the serif it sits beside', () => {
    for (const os of ['ios', 'android'] as const) {
      const { opticalSize } = loadFonts(false, os);
      // 100 in, so the result reads directly as a percentage.
      const corrected = opticalSize(100, 'serifItalic', 'serif');
      expect(Math.abs(corrected - 100)).toBeLessThanOrEqual(TOLERANCE_PCT);
    }
  });

  it('corrects in opposite directions on the two platforms', () => {
    // The Explore gloss sits among the platform's own face: SF has a taller
    // lowercase than Charter, Roboto a shorter one than Noto Serif. A single
    // hard-coded number cannot be right on both, which is the whole point.
    expect(loadFonts(false, 'ios').opticalSize(17, 'serifItalic', 'sans')).toBeGreaterThan(17);
    expect(loadFonts(false, 'android').opticalSize(17, 'serifItalic', 'sans')).toBeLessThan(17);
  });

  it('is an identity when a face is matched against itself', () => {
    for (const os of ['ios', 'android'] as const) {
      const { opticalSize } = loadFonts(false, os);
      expect(opticalSize(13.5, 'serif', 'serif')).toBe(13.5);
    }
  });

  it('passes the size through under RTL, where every face is the system one', () => {
    for (const os of ['ios', 'android'] as const) {
      expect(loadFonts(true, os).opticalSize(17, 'serifItalic', 'sans')).toBe(17);
    }
  });
});
