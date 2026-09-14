/**
 * Option lists for the home feed's filters. Single source for both the labels
 * and the values sent to `/movies/by-cefr` — a second copy is how a picker and
 * a query drift apart.
 *
 * The defaults live here too, next to the options they belong to, because the
 * filter button's "n active" badge is *derived* from them (`activeFilterCount`)
 * rather than counted by each picker as it changes. A stored count is a second
 * copy of state that goes stale the first time a reset path or a new filter is
 * added; a computed one cannot.
 */

/**
 * The `icon` field is gone. It held 🟢🟡🟠🔴 — coloured-circle emoji standing
 * in for the difficulty ramp — and nothing ever rendered it: the level picker
 * passes `swatch={cefrColors[value]}` instead, which is the real CEFR palette
 * and the same colour the badges use elsewhere. Six emoji nobody could see.
 * `LEVEL_DOT_COLORS` in `ui/icons` carries the ramp for anywhere that wants a
 * dot rather than a full swatch.
 *
 * `label` is the prose form ("B1 Intermediate"). The LEVEL group in
 * `FeedFilterSheet` is one row of six cells, so each prints `value` and keeps
 * `label` as its accessibility label, which is the only place the prose still
 * fits.
 */
export const LEVEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'A1', label: 'A1 Beginner' },
  { value: 'A2', label: 'A2 Elementary' },
  { value: 'B1', label: 'B1 Intermediate' },
  { value: 'B2', label: 'B2 Upper-Int.' },
  { value: 'C1', label: 'C1 Advanced' },
  { value: 'C2', label: 'C2 Proficiency' },
];

/**
 * Where the feed starts when we don't know the user's level yet — the middle
 * of the ladder, so the first screen is neither trivially easy nor unreadable.
 * Only a fallback: `useFeedLevel` adopts the real `proficiency_level` the
 * moment the profile arrives.
 */
export const DEFAULT_LEVEL = 'B1';

/**
 * Animation vs live action (#114). Three states rather than a general genre
 * filter: `movies.genre` carries ~19 TMDB genres, and a full genre picker is a
 * much larger surface than the one thing people actually ask for — telling
 * cartoons apart from everything else.
 *
 * Unlike LEVEL_OPTIONS (whose labels are CEFR codes and the same in every
 * language) these are prose, so they carry i18n keys, not literal text.
 */
export type MovieType = 'all' | 'animation' | 'live';

/**
 * No icons. The sheet draws these as a row of three text cells, and a third of
 * a 375pt sheet has room for "Todas las películas" or for a glyph beside a
 * label, not both. They carried drawn icons (clapper, sparkle, camera) while
 * the group was full-width rows.
 */
export const MOVIE_TYPE_OPTIONS: Array<{
  value: MovieType;
  labelKey: string;
}> = [
  { value: 'all',       labelKey: 'home:filters.type.all' },
  { value: 'animation', labelKey: 'home:filters.type.animation' },
  { value: 'live',      labelKey: 'home:filters.type.live' },
];

/**
 * Maps the three-state chip onto the `animated` query param.
 *
 * `undefined` (not `false`) is what "All" must send — omitting the param is
 * the unfiltered feed, whereas `animated=false` is the live-action filter and
 * would quietly drop every animated film plus the 171 with no genre recorded.
 */
export function animatedParam(type: MovieType): boolean | undefined {
  if (type === 'animation') return true;
  if (type === 'live') return false;
  return undefined;
}

/**
 * How the feed is ordered. Server-side (`/movies/by-cefr` sorts the whole
 * catalog, not the page), so these values travel to the API — same reason the
 * labels are i18n keys and the values are not.
 *
 * `recommended` is the odd one out: the other three name a real column, and
 * that is exactly the problem they had. Rating and popularity are near-static
 * per level, and `level` only spreads a band 10 points wide, so the top of a
 * B1 shelf was the same six films every day and anything newly classified sat
 * behind pagination nobody reaches. `recommended` is a seeded shuffle over a
 * quality floor instead — deterministic within a rotation window, different
 * between them.
 */
export type LevelSort = 'recommended' | 'rating' | 'popularity' | 'level';

export const SORT_OPTIONS: Array<{ value: LevelSort; labelKey: string }> = [
  { value: 'recommended', labelKey: 'home:filters.sort.recommended' },
  { value: 'rating',      labelKey: 'home:filters.sort.rating' },
  { value: 'popularity',  labelKey: 'home:filters.sort.popularity' },
  { value: 'level',       labelKey: 'home:filters.sort.level' },
];

/**
 * Whether a sort has an ↑/↓ to flip. A shuffle does not: "ascending random"
 * is not a thing, and letting the row toggle would give the user a control
 * that changes the query string and nothing they can see.
 */
export function sortHasDirection(sort: LevelSort): boolean {
  return sort !== 'recommended';
}

/** The feed as it arrives before anyone touches a filter. */
export const DEFAULT_SORT: LevelSort = 'recommended';
/** Descending — the highest rated first, where a direction applies at all. */
export const DEFAULT_SORT_ASC = false;
export const DEFAULT_MOVIE_TYPE: MovieType = 'all';

export interface FeedFilters {
  sort: LevelSort;
  sortAsc: boolean;
  movieType: MovieType;
}

export const DEFAULT_FEED_FILTERS: FeedFilters = {
  sort: DEFAULT_SORT,
  sortAsc: DEFAULT_SORT_ASC,
  movieType: DEFAULT_MOVIE_TYPE,
};

/**
 * How many filter *groups* deviate from the default — what the filter button
 * badges, and what turns it gold.
 *
 * Groups, not values: flipping the direction of the active sort is still one
 * change to "how this is ordered", so it counts once. Since Recommended became
 * the default, "sort ≠ recommended" is what that one change usually is — a
 * direction flip only exists on the three column sorts.
 *
 * The CEFR level is deliberately absent — it isn't a filter but the feed's
 * scope, it now shares the filter *button* but not this count, and it defaults
 * to the user's profile rather than to a constant, so there is no "off"
 * position for it to deviate from. Counting it would badge the button for
 * every learner whose level isn't `DEFAULT_LEVEL`.
 */
export function activeFilterCount(f: FeedFilters): number {
  const sortChanged = f.sort !== DEFAULT_SORT || f.sortAsc !== DEFAULT_SORT_ASC;
  const typeChanged = f.movieType !== DEFAULT_MOVIE_TYPE;
  return (sortChanged ? 1 : 0) + (typeChanged ? 1 : 0);
}
