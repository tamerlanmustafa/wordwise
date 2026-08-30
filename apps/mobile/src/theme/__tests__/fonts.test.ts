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
    // Baskerville, and an unknown family there resolves to the default sans.
    expect(loadFonts(false, 'ios').SERIF_ITALIC_FAMILY).toBe('Baskerville');
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
