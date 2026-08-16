/**
 * Palette guards for the Lists tab.
 *
 * The tab's design brief specifies exact colours per mode. Most of them map
 * onto tokens that already existed; these tests pin the two that matter most
 * and the invariant that broke elsewhere before: a colour defined in only one
 * palette renders as `undefined` in the other, which React Native silently
 * treats as transparent rather than throwing.
 */

import { themes } from '../tokens';

const { light, dark } = themes;

describe('every token is defined in both palettes', () => {
  it('light and dark declare exactly the same keys', () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
  });

  it('no token resolves to undefined or an empty string', () => {
    for (const [mode, palette] of [['light', light], ['dark', dark]] as const) {
      for (const [key, value] of Object.entries(palette)) {
        expect({ mode, key, ok: typeof value === 'string' && value.length > 0 })
          .toEqual({ mode, key, ok: true });
      }
    }
  });
});

describe('tokens added for the Lists tab', () => {
  it('cardShadowColor is a light warm drop in light and a black drop in dark', () => {
    expect(light.cardShadowColor).toBe('rgba(60,40,10,0.10)');
    expect(dark.cardShadowColor).toBe('rgba(0,0,0,0.45)');
  });

  it('segmentThumb reads against the chipBg track in both modes', () => {
    expect(light.segmentThumb).toBe('#FFFDF7');
    expect(dark.segmentThumb).toBe('rgba(255,255,255,0.13)');
    expect(light.segmentThumb).not.toBe(light.chipBg);
    expect(dark.segmentThumb).not.toBe(dark.chipBg);
  });
});

describe('the colours the Lists design specifies', () => {
  it('uses the shared feed surface for the screen background', () => {
    // The Lists tab and the Explore feed are sibling tab surfaces and must
    // read as the same plane; both are #FFFDF7 / #14121C in the brief.
    expect(light.feedBg).toBe('#FFFDF7');
    expect(dark.feedBg).toBe('#14121C');
  });

  it('keeps rows on the raised card surface', () => {
    expect(light.paper).toBe('#FFFFFF');
    expect(dark.paper).toBe('#1a1a24');
  });

  it('carries the gold hairline and wash used by the pinned rows', () => {
    expect(light.goldLine).toBe('rgba(197,139,27,0.42)');
    expect(dark.goldLine).toBe('rgba(255,209,102,0.45)');
    expect(light.goldWash).toBe('rgba(197,139,27,0.16)');
    expect(dark.goldWash).toBe('rgba(255,209,102,0.16)');
  });

  it('never puts white text on gold', () => {
    // The gold action button and the toast both use goldDeep for their label;
    // white-on-gold fails contrast in both modes.
    expect(light.goldDeep).toBe('#3a2400');
    expect(dark.goldDeep).toBe('#3a2400');
    expect(dark.goldDeep).not.toBe('#FFFFFF');
  });

  it('darkens gold for text on a light surface', () => {
    // Pure #FFD166 on white is unreadable, so light mode has its own value.
    expect(light.goldOnSurface).toBe('#8B5A00');
    expect(dark.goldOnSurface).toBe('#FFD166');
    expect(light.goldOnSurface).not.toBe(light.gold);
  });
});
