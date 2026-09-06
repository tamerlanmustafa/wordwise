import { cefrRamp, cefrRampFor, cefrColorFor } from '../cefrRamp';
import { mix, themes } from '../tokens';
import { CEFR_LEVELS } from '../../types/constants';

/** '#RRGGBB' | 'rgb(r,g,b)' → channels, for asserting on the blend. */
function channels(color: string): [number, number, number] {
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color);
  if (rgb) {
    const [r, g, b] = rgb[1].split(',').map((p) => Number(p.trim()));
    return [r, g, b];
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(color)!;
  return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) as [number, number, number];
}

describe('mix', () => {
  it('returns the endpoints at 0 and 1', () => {
    expect(channels(mix('#000000', '#FFFFFF', 0))).toEqual([0, 0, 0]);
    expect(channels(mix('#000000', '#FFFFFF', 1))).toEqual([255, 255, 255]);
  });

  it('blends each channel independently', () => {
    expect(channels(mix('#000000', '#FFFFFF', 0.5))).toEqual([128, 128, 128]);
    expect(channels(mix('#FF0000', '#0000FF', 0.5))).toEqual([128, 0, 128]);
  });

  it('clamps rather than extrapolating past either end', () => {
    expect(channels(mix('#000000', '#FFFFFF', -3))).toEqual([0, 0, 0]);
    expect(channels(mix('#000000', '#FFFFFF', 9))).toEqual([255, 255, 255]);
  });

  it('degrades to the starting colour on a shape it cannot parse', () => {
    // Same contract as withAlpha/shade: a future token shape costs a flat
    // colour, never an invisible view.
    expect(mix('oklch(0.7 0.1 80)', '#FFFFFF', 0.5)).toBe('oklch(0.7 0.1 80)');
    expect(mix('#FFFFFF', 'oklch(0.7 0.1 80)', 0.5)).toBe('#FFFFFF');
  });

  it('returns 6-digit hex, because callers append an alpha suffix to it', () => {
    // Half a dozen call sites build a translucent fill as `${levelColor}22`.
    // That only works on hex: an `rgb()` string becomes
    // `rgb(255,209,102)22`, which does not throw and does not render.
    expect(mix('#FFD166', '#E57373', 0.4)).toMatch(/^#[0-9A-F]{6}$/);
    expect(mix('rgb(255,209,102)', 'rgb(229,115,115)', 0.4)).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe('cefrRamp', () => {
  it('gives one colour per CEFR band', () => {
    expect(cefrRamp('#FFD166', '#E57373')).toHaveLength(CEFR_LEVELS.length);
  });

  it('pins the endpoints to A1 and C2', () => {
    const ramp = cefrRamp('#FFD166', '#E57373');
    expect(channels(ramp[0])).toEqual(channels('#FFD166'));
    expect(channels(ramp[ramp.length - 1])).toEqual(channels('#E57373'));
  });

  it('moves steadily toward red — no two bands share a colour', () => {
    // The bar and the legend both key off this, so a repeated colour is two
    // bands the reader cannot tell apart in either place.
    const ramp = cefrRamp('#FFD166', '#E57373');
    expect(new Set(ramp).size).toBe(ramp.length);
    // Green falls the whole way down: gold is 0xD1, the red is 0x73.
    const greens = ramp.map((c) => channels(c)[1]);
    for (let i = 1; i < greens.length; i += 1) {
      expect(greens[i]).toBeLessThan(greens[i - 1]);
    }
  });

  it('is spaced evenly across the band index, not weighted', () => {
    // The bands are ordinal — B2→C1 is not a known multiple of A1→A2 — so an
    // even spread is the only spacing that does not invent precision.
    const ramp = cefrRamp('#000000', '#FFFFFF');
    expect(ramp.map((c) => channels(c)[0])).toEqual([0, 51, 102, 153, 204, 255]);
  });

  it('follows the theme rather than freezing hexes', () => {
    // The point of building from tokens: light and dark carry different golds
    // and different reds, so the ramp differs too.
    const light = cefrRampFor(themes.light);
    const dark = cefrRampFor(themes.dark);
    expect(channels(light[0])).toEqual(channels(themes.light.gold));
    expect(channels(dark[0])).toEqual(channels(themes.dark.gold));
    expect(light).not.toEqual(dark);
  });
});

describe('cefrColorFor', () => {
  const ramp = cefrRamp('#FFD166', '#E57373');

  it('maps each band to its own slot', () => {
    CEFR_LEVELS.forEach((code, i) => {
      expect(cefrColorFor(code, ramp)).toBe(ramp[i]);
    });
  });

  it('falls back to the easiest end for a code off the scale', () => {
    // `cefr_distribution` payloads carry an UNKNOWN bucket (issue #91). An
    // unreadable segment would be worse than a slightly wrong one.
    expect(cefrColorFor('UNKNOWN', ramp)).toBe(ramp[0]);
    expect(cefrColorFor('', ramp)).toBe(ramp[0]);
  });
});
