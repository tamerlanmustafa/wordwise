/**
 * What the home card's ring actually measures: the share of a film's dialogue
 * vocabulary that sits at or below the reader's own CEFR level.
 *
 * ## What it replaced, and why that was wrong
 *
 * The ring used to draw `movie.difficulty_score` and print `scoreToCefr()` of
 * that same number beside it. Two problems, both invisible until you line the
 * cards up: the band and the percent were *one* value shown twice, and the
 * feed is scoped to a single level, so every card on a B1 shelf printed `B1`
 * with a percentage somewhere in the 10-point-wide B1 band. Nothing on the
 * card was about the reader at all.
 *
 * This is. `/movies/by-cefr` already returns `cefr_distribution` — distinct
 * classified words per band, straight out of `word_classifications` — so no
 * backend work was needed to say something true instead.
 *
 * Pure and React-free so the maths is unit-testable and so it can be computed
 * inside a recycled FlashList cell without touching a store.
 */

import { CEFR_LEVELS } from '../../types/constants';

export interface KnownShare {
  /** 0–100, rounded. What the ring's arc and its `%` both read. */
  pct: number;
  /** Distinct words at or below the level. */
  atOrBelow: number;
  /** Distinct classified words in the film, `UNKNOWN` excluded. */
  total: number;
}

/**
 * Null when the film has nothing usable to measure — no script processed
 * (171 films in prod), an empty distribution, or a level that isn't on the
 * CEFR ladder. The card renders that as a bare track and an em dash rather
 * than as 0%, which would read as "you know none of this film".
 *
 * `UNKNOWN` is excluded from **both** halves. It is the holding pen from #91
 * for words the classifier could not place — not a band, not taught, and not
 * something the reader either knows or doesn't. Leaving it in the denominator
 * would quietly depress every percentage by however much of the catalogue is
 * still unclassified, which is a property of our data, not of the film.
 */
export function knownShare(
  dist: Record<string, number> | null | undefined,
  level: string,
): KnownShare | null {
  if (!dist) return null;

  const idx = CEFR_LEVELS.indexOf(level as (typeof CEFR_LEVELS)[number]);
  if (idx === -1) return null;

  let total = 0;
  let atOrBelow = 0;
  CEFR_LEVELS.forEach((band, i) => {
    const n = Number(dist[band]);
    if (!Number.isFinite(n) || n <= 0) return;
    total += n;
    if (i <= idx) atOrBelow += n;
  });

  if (total === 0) return null;

  return { pct: Math.round((atOrBelow / total) * 100), atOrBelow, total };
}
