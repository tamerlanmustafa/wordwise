import { LEVEL_OPTIONS, MOVIE_TYPE_OPTIONS, animatedParam } from '../filterOptions';

describe('LEVEL_OPTIONS (CEFR level picker)', () => {
  it('lists exactly the six CEFR levels in ascending order', () => {
    expect(LEVEL_OPTIONS.map((o) => o.value)).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
  });

  it('labels each level with its code as a prefix', () => {
    LEVEL_OPTIONS.forEach((o) => {
      expect(o.label.startsWith(o.value)).toBe(true);
    });
  });

  it('gives every option a non-empty difficulty icon', () => {
    LEVEL_OPTIONS.forEach((o) => {
      expect(o.icon.length).toBeGreaterThan(0);
    });
  });

  it('uses progressively "harder" icons (green → yellow/orange → red)', () => {
    const byValue = Object.fromEntries(LEVEL_OPTIONS.map((o) => [o.value, o.icon]));
    expect(byValue.A1).toBe('🟢');
    expect(byValue.A2).toBe('🟢');
    expect(byValue.C1).toBe('🔴');
    expect(byValue.C2).toBe('🔴');
  });
});

describe('MOVIE_TYPE_OPTIONS (animation filter, #114)', () => {
  it('offers exactly three states with All first, so the default is the top row', () => {
    expect(MOVIE_TYPE_OPTIONS.map((o) => o.value)).toEqual(['all', 'animation', 'live']);
  });

  it('carries i18n keys, not literal labels', () => {
    // These are prose (unlike the CEFR codes in LEVEL_OPTIONS), so hardcoding
    // them would leave the chip English in all five other locales.
    MOVIE_TYPE_OPTIONS.forEach((o) => {
      expect(o.labelKey).toMatch(/^home:filters\.type\./);
    });
  });
});

describe('animatedParam (chip state → /movies/by-cefr query)', () => {
  it('omits the param for All rather than sending false', () => {
    // `animated=false` is the live-action *filter*. Sending it for "All" would
    // silently drop every animated film plus the 171 with no genre recorded.
    expect(animatedParam('all')).toBeUndefined();
  });

  it('maps the two filtered states onto the boolean the API expects', () => {
    expect(animatedParam('animation')).toBe(true);
    expect(animatedParam('live')).toBe(false);
  });
});
