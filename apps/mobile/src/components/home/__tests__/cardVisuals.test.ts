import {
  BACKDROP_OPACITY,
  BACKDROP_W,
  EDGE_FADE_W,
  PLUS_INK_DARK,
  PLUS_INK_LIGHT,
  RING_C,
  RING_HOLE,
  RING_R,
  RING_SIZE,
  RING_STROKE,
  SCRIM_REACH,
  buildEdgeFade,
  buildScrim,
  compositeOver,
  contrastRatio,
  cornerForGlyph,
  hexToRgb,
  parseCornerRgb,
  parseInk,
  pickPlusInk,
  plusHalo,
  relativeLuminance,
  rgba,
  ringDashOffset,
  type Rgb,
} from '../cardVisuals';

const LIGHT_STOCK: Rgb = [251, 247, 238]; // #FBF7EE
const DARK_STOCK: Rgb = [15, 16, 19];     // #0F1013

/** Pull the alpha back out of an `rgba(r,g,b,a)` string. */
function alphaOf(color: string): number {
  return Number(color.slice(color.lastIndexOf(',') + 1, -1));
}

/** Pull the leading `r,g,b` back out of an `rgba(...)` string. */
function rgbOf(color: string): string {
  return color.slice(color.indexOf('(') + 1, color.lastIndexOf(','));
}

describe('hexToRgb / rgba', () => {
  it('round-trips the card stock hexes from tokens', () => {
    expect(hexToRgb('#FBF7EE')).toEqual(LIGHT_STOCK);
    expect(hexToRgb('#0F1013')).toEqual(DARK_STOCK);
  });

  it('tolerates a missing leading hash', () => {
    expect(hexToRgb('FBF7EE')).toEqual(LIGHT_STOCK);
  });

  it('rounds long alpha tails rather than emitting float noise', () => {
    expect(rgba(LIGHT_STOCK, 1 / 3)).toBe('rgba(251,247,238,0.3333)');
  });
});

describe('buildScrim', () => {
  const scrim = buildScrim(LIGHT_STOCK);

  it('emits the 13 curve stops plus the opaque head', () => {
    expect(scrim.colors).toHaveLength(14);
    expect(scrim.locations).toHaveLength(14);
  });

  it('keeps locations ascending — LinearGradient requires it', () => {
    const locs = [...scrim.locations];
    expect(locs).toEqual([...locs].sort((a, b) => a - b));
  });

  it('starts opaque at the leading edge and reaches zero at the trailing edge', () => {
    expect(alphaOf(scrim.colors[0])).toBeCloseTo(0.97, 4);
    expect(scrim.locations[0]).toBe(0);
    expect(alphaOf(scrim.colors[scrim.colors.length - 1])).toBe(0);
    expect(scrim.locations[scrim.locations.length - 1]).toBe(1);
  });

  it('begins its falloff at REACH × 42%', () => {
    expect(scrim.locations[1]).toBeCloseTo((SCRIM_REACH * 42) / 100, 4);
  });

  it('decays monotonically, so no step reads as an edge', () => {
    const alphas = scrim.colors.slice(1).map(alphaOf);
    alphas.forEach((a, i) => {
      if (i > 0) expect(a).toBeLessThan(alphas[i - 1]);
    });
  });

  it('paints every stop in the card stock RGB — a different RGB shows a seam', () => {
    scrim.colors.forEach((c) => expect(rgbOf(c)).toBe('251,247,238'));
  });

  it('reaches further across the card as REACH shrinks', () => {
    expect(buildScrim(LIGHT_STOCK, 0.3).locations[1]).toBeLessThan(scrim.locations[1]);
  });
});

describe('buildEdgeFade', () => {
  const fade = buildEdgeFade(DARK_STOCK);

  it('covers exactly half the backdrop', () => {
    expect(EDGE_FADE_W).toBe(BACKDROP_W / 2);
  });

  it('runs from fully-stock to fully-clear across its own width', () => {
    expect(alphaOf(fade.colors[0])).toBe(1);
    expect(fade.locations[0]).toBe(0);
    expect(alphaOf(fade.colors[fade.colors.length - 1])).toBe(0);
    expect(fade.locations[fade.locations.length - 1]).toBe(1);
  });

  it('rescales the mask positions onto the overlay, not into its leading half', () => {
    // Mask alpha 0.45 sits at 24% of the *image*; the overlay is half the
    // image wide, so it belongs at 48% of the overlay.
    expect(fade.locations[3]).toBeCloseTo(0.48, 4);
    expect(alphaOf(fade.colors[3])).toBeCloseTo(0.55, 4);
  });

  it('inverts the mask — the overlay hides what the mask would reveal', () => {
    expect(alphaOf(fade.colors[5])).toBeCloseTo(0.1, 4);
  });

  it('paints in the stock it was given', () => {
    fade.colors.forEach((c) => expect(rgbOf(c)).toBe('15,16,19'));
  });
});

describe('relativeLuminance / contrastRatio', () => {
  it('matches the WCAG anchors', () => {
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 4);
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 4);
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 2);
  });

  it('is symmetric and bottoms out at 1 for identical colours', () => {
    const a: Rgb = [120, 30, 200];
    const b: Rgb = [10, 190, 60];
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 6);
    expect(contrastRatio(a, a)).toBeCloseTo(1, 6);
  });
});

describe('compositeOver', () => {
  it('returns the ground at zero opacity and the image at full', () => {
    expect(compositeOver([0, 0, 0], LIGHT_STOCK, 0)).toEqual(LIGHT_STOCK);
    expect(compositeOver([0, 0, 0], LIGHT_STOCK, 1)).toEqual([0, 0, 0]);
  });

  it('blends at the backdrop opacity the card actually uses', () => {
    // 251 × 0.4 + 0 × 0.6 = 100.4
    expect(compositeOver([0, 0, 0], LIGHT_STOCK, BACKDROP_OPACITY)[0]).toBeCloseTo(100.4, 4);
  });
});

describe('pickPlusInk', () => {
  it('goes dark over a snow scene', () => {
    expect(pickPlusInk([243, 246, 250], LIGHT_STOCK)).toBe('rgb(16,14,18)');
    expect(pickPlusInk([243, 246, 250], DARK_STOCK)).toBe('rgb(16,14,18)');
  });

  it('goes light over a night scene', () => {
    expect(pickPlusInk([18, 20, 26], LIGHT_STOCK)).toBe('rgb(255,250,240)');
    expect(pickPlusInk([18, 20, 26], DARK_STOCK)).toBe('rgb(255,250,240)');
  });

  it('goes dark over a bright title card', () => {
    expect(pickPlusInk([236, 199, 62], DARK_STOCK)).toBe('rgb(16,14,18)');
  });

  it('always clears 4.5:1 against what is actually behind the glyph', () => {
    const corners: Rgb[] = [
      [243, 246, 250], // snow
      [18, 20, 26],    // night
      [236, 199, 62],  // title card
      [128, 128, 128], // mid grey — the worst case
      [140, 70, 40],   // warm sepia still
      [40, 90, 140],   // cool blue still
    ];
    for (const ground of [LIGHT_STOCK, DARK_STOCK]) {
      for (const corner of corners) {
        const ink = pickPlusInk(corner, ground);
        const eff = compositeOver(corner, ground, BACKDROP_OPACITY);
        const inkRgb = ink === 'rgb(16,14,18)' ? PLUS_INK_DARK : PLUS_INK_LIGHT;
        expect(contrastRatio(inkRgb, eff)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('plusHalo', () => {
  it('counter-colours the halo so the glyph survives a hidden detail', () => {
    expect(plusHalo('rgb(255,250,240)').textShadowColor).toBe('rgba(0,0,0,0.42)');
    expect(plusHalo('rgb(16,14,18)').textShadowColor).toBe('rgba(255,255,255,0.55)');
  });

  it('darkens behind the cardMeta fallback golds rather than smearing them', () => {
    // Both are what the glyph falls back to when ingest has no corner average.
    expect(plusHalo('#FFD166').textShadowColor).toBe('rgba(0,0,0,0.42)'); // dark theme
    expect(plusHalo('#8B5A00').textShadowColor).toBe('rgba(255,255,255,0.55)'); // light theme
  });

  it('falls back to the light halo when the ink is unparseable', () => {
    expect(plusHalo('tomato').textShadowColor).toBe('rgba(255,255,255,0.55)');
  });
});

describe('parseInk', () => {
  it('reads both shapes the ink can arrive in', () => {
    expect(parseInk('rgb(16,14,18)')).toEqual([16, 14, 18]);
    expect(parseInk('rgba(255, 250, 240, 0.5)')).toEqual([255, 250, 240]);
    expect(parseInk('#FFD166')).toEqual([255, 209, 102]);
    expect(parseInk('tomato')).toBeNull();
  });
});

describe('parseCornerRgb', () => {
  it('accepts a plain triple from ingest', () => {
    expect(parseCornerRgb([12, 200, 255])).toEqual([12, 200, 255]);
  });

  it('rejects everything a missing or malformed field can be', () => {
    expect(parseCornerRgb(undefined)).toBeNull();
    expect(parseCornerRgb(null)).toBeNull();
    expect(parseCornerRgb([1, 2])).toBeNull();
    expect(parseCornerRgb('12,200,255')).toBeNull();
    expect(parseCornerRgb([1, 2, 300])).toBeNull();
    expect(parseCornerRgb([1, 2, -4])).toBeNull();
    expect(parseCornerRgb([1, 2, 'x'])).toBeNull();
  });
});

describe('cornerForGlyph', () => {
  it('uses the stored average in a left-to-right layout', () => {
    expect(cornerForGlyph([12, 200, 255], false)).toEqual([12, 200, 255]);
  });

  it('declines the average under RTL', () => {
    // Ingest samples the still's top-RIGHT patch. Under RTL the card mirrors
    // (`end:` becomes the left edge) but the image's pixels do not, so the
    // glyph lands over a corner nothing measured. Null keeps the gold + halo
    // fallback, which is what every card renders today.
    expect(cornerForGlyph([12, 200, 255], true)).toBeNull();
  });

  it('still rejects a malformed value in either direction', () => {
    expect(cornerForGlyph('12,200,255', false)).toBeNull();
    expect(cornerForGlyph(undefined, true)).toBeNull();
  });

  it('keeps a legitimately black corner', () => {
    // [0,0,0] is a real night-scene average, not a missing value — a falsy
    // check anywhere on this path would drop exactly the backdrops the
    // feature exists for.
    expect(cornerForGlyph([0, 0, 0], false)).toEqual([0, 0, 0]);
    expect(pickPlusInk([0, 0, 0], DARK_STOCK)).toBe('rgb(255,250,240)');
  });
});

describe('level ring geometry', () => {
  it('leaves a 36pt hole for a 44pt ring with a 4pt stroke', () => {
    expect(RING_SIZE).toBe(44);
    expect(RING_HOLE).toBe(36);
    expect(RING_R + RING_STROKE / 2).toBe(RING_SIZE / 2);
  });

  it('draws no arc when the score is unknown', () => {
    expect(ringDashOffset(null)).toBe(RING_C);
    expect(ringDashOffset(undefined)).toBe(RING_C);
    expect(ringDashOffset(NaN)).toBe(RING_C);
  });

  it('draws the arc to the comprehension percentage', () => {
    expect(ringDashOffset(0)).toBeCloseTo(RING_C, 6);
    expect(ringDashOffset(100)).toBeCloseTo(0, 6);
    expect(ringDashOffset(62)).toBeCloseTo(RING_C * 0.38, 6);
    // 60% should land a little past halfway round.
    expect(ringDashOffset(60)).toBeLessThan(RING_C / 2);
  });

  it('clamps scores that fall outside 0–100', () => {
    expect(ringDashOffset(140)).toBeCloseTo(0, 6);
    expect(ringDashOffset(-20)).toBeCloseTo(RING_C, 6);
  });
});

describe('backdrop geometry', () => {
  it('is the full 16:9 frame at the 116pt card height', () => {
    expect(BACKDROP_W).toBe(Math.round((116 * 16) / 9));
  });
});
