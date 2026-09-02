import {
  DEFAULT_FEED_FILTERS,
  LEVEL_OPTIONS,
  MOVIE_TYPE_OPTIONS,
  SORT_OPTIONS,
  activeFilterCount,
  animatedParam,
} from '../filterOptions';
import { LEVEL_DOT_COLORS } from '../../ui/icons';

describe('LEVEL_OPTIONS (CEFR level picker)', () => {
  it('lists exactly the six CEFR levels in ascending order', () => {
    expect(LEVEL_OPTIONS.map((o) => o.value)).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
  });

  it('labels each level with its code as a prefix', () => {
    LEVEL_OPTIONS.forEach((o) => {
      expect(o.label.startsWith(o.value)).toBe(true);
    });
  });

  it('carries no icon field at all', () => {
    // It held 🟢🟡🟠🔴 and nothing rendered it — `LevelSheet` passes
    // `swatch={cefrColors[value]}`, the real CEFR palette. Six emoji nobody
    // could see, kept alive by a test asserting they existed.
    LEVEL_OPTIONS.forEach((o) => {
      expect(o).not.toHaveProperty('icon');
    });
  });

  it('every level still has a colour on the difficulty ramp', () => {
    // The ramp the emoji encoded is real and worth keeping; it just lives in
    // `LEVEL_DOT_COLORS` now, as colours a drawn dot can actually use.
    LEVEL_OPTIONS.forEach((o) => {
      expect(LEVEL_DOT_COLORS[o.value]).toMatch(/^#[0-9A-F]{6}$/i);
    });
  });

  it('ramps green → amber → red as the level rises', () => {
    expect(LEVEL_DOT_COLORS.A1).toBe(LEVEL_DOT_COLORS.A2);
    expect(LEVEL_DOT_COLORS.C1).toBe(LEVEL_DOT_COLORS.C2);
    expect(LEVEL_DOT_COLORS.A1).not.toBe(LEVEL_DOT_COLORS.B1);
    expect(LEVEL_DOT_COLORS.B1).not.toBe(LEVEL_DOT_COLORS.C1);
  });
});

describe('MOVIE_TYPE_OPTIONS (animation filter, #114)', () => {
  it('offers exactly three states with All first, so the default is the top row', () => {
    expect(MOVIE_TYPE_OPTIONS.map((o) => o.value)).toEqual(['all', 'animation', 'live']);
  });

  it('names a drawn icon rather than carrying a glyph', () => {
    // 🎬 ✨ 🎥 previously. A name resolves to a component the row renders in
    // the app's own palette; a glyph is whatever the OS font decides.
    expect(MOVIE_TYPE_OPTIONS.map((o) => o.icon)).toEqual(['clapper', 'sparkle', 'camera']);
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

describe('SORT_OPTIONS (feed ordering)', () => {
  it('offers the three server-side sorts, rating first', () => {
    expect(SORT_OPTIONS.map((o) => o.value)).toEqual(['rating', 'popularity', 'level']);
  });

  it('carries i18n keys, not literal labels', () => {
    // These were hardcoded English in the old chip row, which left them
    // untranslated in all five other locales.
    SORT_OPTIONS.forEach((o) => {
      expect(o.labelKey).toMatch(/^home:filters\.sort\./);
    });
  });

  it('starts on a sort that exists', () => {
    expect(SORT_OPTIONS.some((o) => o.value === DEFAULT_FEED_FILTERS.sort)).toBe(true);
  });
});

describe('activeFilterCount (the filter button badge)', () => {
  it('is 0 for the untouched feed, so the button stays neutral', () => {
    expect(activeFilterCount(DEFAULT_FEED_FILTERS)).toBe(0);
  });

  it('counts a changed sort key', () => {
    expect(activeFilterCount({ ...DEFAULT_FEED_FILTERS, sort: 'popularity' })).toBe(1);
  });

  it('counts a flipped direction even when the sort key is the default', () => {
    // Rating ascending is "worst films first" — very much a filtered view, and
    // the badge is the only thing that says so once the chips are hidden.
    expect(activeFilterCount({ ...DEFAULT_FEED_FILTERS, sortAsc: true })).toBe(1);
  });

  it('counts key and direction together as one group, not two', () => {
    expect(
      activeFilterCount({ ...DEFAULT_FEED_FILTERS, sort: 'level', sortAsc: true }),
    ).toBe(1);
  });

  it('counts the film type separately', () => {
    expect(activeFilterCount({ ...DEFAULT_FEED_FILTERS, movieType: 'animation' })).toBe(1);
    expect(
      activeFilterCount({ ...DEFAULT_FEED_FILTERS, movieType: 'live', sort: 'popularity' }),
    ).toBe(2);
  });

  it('derives from the shared defaults rather than a hardcoded pair', () => {
    // The badge and the query must read the same constants: a second copy of
    // "what counts as default" is how a button says "1 active" over an
    // unfiltered feed.
    expect(
      activeFilterCount({
        sort: DEFAULT_FEED_FILTERS.sort,
        sortAsc: DEFAULT_FEED_FILTERS.sortAsc,
        movieType: DEFAULT_FEED_FILTERS.movieType,
      }),
    ).toBe(0);
  });
});
