/**
 * Option lists for the home feed's filter chips. Single source for both the
 * chip labels and the values sent to `/movies/by-cefr` — a second copy is how
 * a picker and a query drift apart.
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
