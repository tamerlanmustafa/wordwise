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

export const LEVEL_OPTIONS: Array<{ value: string; label: string; icon: string }> = [
  { value: 'A1', label: 'A1 Beginner',       icon: '🟢' },
  { value: 'A2', label: 'A2 Elementary',      icon: '🟢' },
  { value: 'B1', label: 'B1 Intermediate',    icon: '🟡' },
  { value: 'B2', label: 'B2 Upper-Int.',      icon: '🟠' },
  { value: 'C1', label: 'C1 Advanced',        icon: '🔴' },
  { value: 'C2', label: 'C2 Proficiency',     icon: '🔴' },
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

export const MOVIE_TYPE_OPTIONS: Array<{ value: MovieType; labelKey: string; icon: string }> = [
  { value: 'all',       labelKey: 'home:filters.type.all',       icon: '🎬' },
  { value: 'animation', labelKey: 'home:filters.type.animation', icon: '✨' },
  { value: 'live',      labelKey: 'home:filters.type.live',      icon: '🎥' },
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
 */
export type LevelSort = 'rating' | 'popularity' | 'level';

export const SORT_OPTIONS: Array<{ value: LevelSort; labelKey: string }> = [
  { value: 'rating',     labelKey: 'home:filters.sort.rating' },
  { value: 'popularity', labelKey: 'home:filters.sort.popularity' },
  { value: 'level',      labelKey: 'home:filters.sort.level' },
];

/** The feed as it arrives before anyone touches a filter. */
export const DEFAULT_SORT: LevelSort = 'rating';
/** Descending — the highest rated first. */
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
 * change to "how this is ordered", so it counts once. The CEFR level is
 * deliberately absent — it isn't a filter but the feed's scope, it lives on
 * its own control, and it defaults to the user's profile rather than to a
 * constant, so there is no "off" position for it to deviate from.
 */
export function activeFilterCount(f: FeedFilters): number {
  const sortChanged = f.sort !== DEFAULT_SORT || f.sortAsc !== DEFAULT_SORT_ASC;
  const typeChanged = f.movieType !== DEFAULT_MOVIE_TYPE;
  return (sortChanged ? 1 : 0) + (typeChanged ? 1 : 0);
}
