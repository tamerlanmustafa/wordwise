/**
 * What the home card's ring measures: how much this film has left to teach
 * *you* — the number of its distinct words that sit at or above your level.
 *
 * ## Two dead ends this replaced
 *
 * **1. The film's own difficulty.** The original ring drew
 * `movie.difficulty_score` and printed `scoreToCefr()` of that same number
 * beside it — one value shown twice, and neither half about the reader. Worse,
 * the feed is scoped to one level, so every card on a B1 shelf printed `B1`.
 *
 * **2. Coverage — "share of this film at or below your level".** Truer, and it
 * works beautifully at the bottom of the ladder. It cannot work at the top,
 * for a reason that is arithmetic rather than a bug: a cumulative share
 * saturates at the highest band. Measured over 4,430 prod films (2026-09-03):
 *
 *     your level   average ring   spread      films reading >= 99%
 *     A1                  61.5%   34 - 85                        0
 *     A2                  77.1%   46 - 94                        0
 *     B1                  88.2%   62 - 98                        0
 *     B2                  97.1%   89 - 100                     502
 *     C1                  99.7%   97 - 100                   4,413
 *     C2                   100%   100 - 100                  4,430
 *
 * Every C2 card read `100%`, and so did the sheet behind it. Half the ladder
 * was looking at a constant.
 *
 * ## Why a count and not another percentage
 *
 * The instinct is to find a better ratio, but every ratio is normalised by
 * film length and the shelf is *selected* on exactly that. Across the 202
 * films on the C2 shelf:
 *
 *     share at or below your level     100%     - 100%      1.00x
 *     vocabulary demand (B2+/content)  35.5%    - 38.6%     1.09x
 *     C1+C2 word COUNT                 16       - 340      21x
 *     C2 word COUNT                    1        - 52       52x
 *
 * Shares are flat because the shelf is defined by them. The absolute amount of
 * hard vocabulary is not: a C2 film with 340 advanced words is a different
 * proposition from one with 16, and under coverage both read `100%`.
 *
 * So the ring counts. "At or above", not "above": strictly-above degenerates
 * to zero at C2 the same way coverage degenerates to 100 there. At A1 the
 * count is the film's whole vocabulary, which is honest — nearly all of it is
 * still being consolidated.
 */

import { CEFR_LEVELS, type CefrLevel } from '../../types/constants';

export interface LearningPayload {
  /** Distinct words at or above the reader's level — what is left to teach. */
  count: number;
  /** Distinct classified words in the film, `UNKNOWN` excluded. */
  total: number;
  /** 0-100 for the ring's arc: this film's count against a typical film on
   *  the same shelf. Not a percentage of anything the reader can name, which
   *  is why the hole prints `count` and never this. */
  fill: number;
}

/**
 * What counts as a "full" ring on each shelf — the 90th percentile of the
 * payload among films *on that shelf*, measured on prod 2026-09-03.
 *
 * Scoped per shelf on purpose. A C2 learner only ever browses C2 films, so
 * scaling their ring against the whole catalogue (where C2 counts run to 340)
 * would peg every card near empty. Against its own shelf the median film sits
 * at 44-80% full and roughly a tenth max out, which is the spread that makes
 * the arc worth drawing at all.
 *
 *     shelf   films   median payload   p90 (full ring)
 *     A1        165              842             1051
 *     A2      1,193              332              505
 *     B1      1,488              230              359
 *     B2        912              139              235
 *     C1        470               37               62
 *     C2        202                7               16
 *
 * These drift as the catalogue grows, which only makes rings a little fuller
 * or emptier — never wrong. Re-measure when the catalogue changes materially.
 */
export const SHELF_FULL_RING: Record<CefrLevel, number> = {
  A1: 1051,
  A2: 505,
  B1: 359,
  B2: 235,
  C1: 62,
  C2: 16,
};

/**
 * Null when the film has nothing usable to measure — no script processed (171
 * prod films), an empty distribution, or a level that isn't on the CEFR
 * ladder. The card renders that as a bare track and an em dash rather than as
 * `0`, which would read as "this film has nothing for you".
 *
 * `UNKNOWN` is excluded from `total`. It is the holding pen from #91 for words
 * the classifier could not place — not a band, not taught, and not something
 * the reader either knows or doesn't.
 */
export function learningPayload(
  dist: Record<string, number> | null | undefined,
  level: string,
): LearningPayload | null {
  if (!dist) return null;

  const idx = CEFR_LEVELS.indexOf(level as CefrLevel);
  if (idx === -1) return null;

  let total = 0;
  let count = 0;
  CEFR_LEVELS.forEach((band, i) => {
    const n = Number(dist[band]);
    if (!Number.isFinite(n) || n <= 0) return;
    total += n;
    if (i >= idx) count += n;
  });

  if (total === 0) return null;

  const reference = SHELF_FULL_RING[level as CefrLevel];
  const fill = Math.max(0, Math.min(100, Math.round((count / reference) * 100)));

  return { count, total, fill };
}
