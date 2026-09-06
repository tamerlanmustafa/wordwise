/**
 * What the home card's ring shows: **how many distinct words this film speaks.**
 *
 * A fact about the film, labelled as one. That sounds like a retreat, and it is
 * — four metrics that each tried to be about the *reader* died here first, and
 * the reason they died turned out to rule out the whole category rather than
 * the four formulas.
 *
 * ## The four dead ends, and the one thing they had in common
 *
 * **1. The film's own difficulty score.** The ring drew `difficulty_score` and
 * printed `scoreToCefr()` of that same number beside it. One value twice, and
 * the feed is scoped to one level, so every card on a B1 shelf printed `B1`.
 *
 * **2. Coverage — share of the film at or below your level.** Saturates at the
 * top band by arithmetic. Over 4,430 prod films (2026-09-03), films reading
 * >= 99%: B2 502, C1 4,413, **C2 all 4,430**. Half the ladder saw a constant.
 *
 * **3. A count of words at or above your level.** Varied, but promised words
 * the "For you" deck would never offer — 1,203 on an A1 card over a deck of
 * 884.
 *
 * **4. The same count, narrowed to your level and the next.** Honest about the
 * deck, still not about *you*: two C2 learners, one who has studied 800 words
 * and one 8,000, saw the identical ring on every card.
 *
 * The common flaw: the only reader-specific input available on a feed card is
 * the CEFR band — **one value out of six** — and the shelf has already been
 * selected by it. Anything computed from that is a film statistic with a
 * level-shaped offset, and on a shelf chosen by that offset it barely moves.
 *
 * ## Why real vocabulary data does not rescue it either
 *
 * The obvious escape is to use what the reader has actually learned
 * (`user_words`) rather than their band. Measured on the one prod account with
 * a real learned set — 244 distinct words, C1 — across all 470 films on the C1
 * shelf: average pool 41.2 words, average subtracted **1.1**, i.e. **2.6% of
 * the ring**. The advanced registry holds 14,617 lemmas, so a learned set
 * subtracts roughly its own share of any one film's slice. Moving a 41-word
 * ring by a quarter needs ~3,600 learned advanced words.
 *
 * So the personal number is not merely unbuilt, it is not *available*. Better
 * to show something true than a fifth thing that is quietly constant.
 *
 * ## Why size is the honest choice
 *
 * The shelf selects on *ratios* — every film on it is about equally hard. It
 * does not select on *size*, so size is the one dimension left free, and it
 * varies 4.6x to 10x inside every shelf (C2: 730-3,390; B2: 257-2,640). It
 * needs no user data, cannot saturate, and answers a question a person
 * browsing actually has: these are all at my level, but is this a big film or
 * a light one tonight?
 */

import { CEFR_LEVELS, type CefrLevel } from '../../types/constants';

export interface FilmVocabulary {
  /** Distinct classified words spoken in the film, `UNKNOWN` excluded. */
  words: number;
  /** 0-100 for the ring's arc — this film's size against a typical film on the
   *  same shelf. Never shown as a number: the hole prints `words`. */
  fill: number;
}

/**
 * What counts as a "full" ring on each shelf — the 90th percentile of
 * vocabulary size among films *on that shelf*, measured on prod 2026-09-03.
 *
 * Scoped per shelf because the shelves differ in typical size (A1 films median
 * 842 words, C2 films 1,323), and a reader only ever browses one of them. One
 * global reference would leave every A1 ring near empty and every C2 ring near
 * full, which is true of the catalogue but useless for choosing between the
 * ten films actually on screen.
 *
 *     shelf   films   median words   p90 (full ring)
 *     A1        165            842             1051
 *     A2      1,193            923             1199
 *     B1      1,488          1,014             1338
 *     B2        912          1,084             1437
 *     C1        470          1,181             1541
 *     C2        202          1,323             1738
 *
 * These drift as the catalogue grows, which only makes rings a little fuller
 * or emptier — never wrong. Re-measure when the catalogue changes materially.
 */
export const SHELF_FULL_RING: Record<CefrLevel, number> = {
  A1: 1051,
  A2: 1199,
  B1: 1338,
  B2: 1437,
  C1: 1541,
  C2: 1738,
};

/**
 * Null when the film has no usable distribution — no script processed (171
 * prod films) or an empty one. The card renders that as a bare track and an em
 * dash rather than `0`, which would claim the film speaks no words at all.
 *
 * `UNKNOWN` is excluded. It is the holding pen from #91 for words the
 * classifier could not place; counting them would inflate "N different words
 * are spoken in this film" with words we cannot name a level for.
 *
 * `level` only picks the arc's reference. An unrecognised one still returns a
 * real count — the number is a fact about the film and does not depend on who
 * is looking — and falls back to the middle of the ladder for the arc.
 */
export function filmVocabulary(
  dist: Record<string, number> | null | undefined,
  level: string,
): FilmVocabulary | null {
  if (!dist) return null;

  let words = 0;
  CEFR_LEVELS.forEach((band) => {
    const n = Number(dist[band]);
    if (Number.isFinite(n) && n > 0) words += n;
  });

  if (words === 0) return null;

  const reference = SHELF_FULL_RING[level as CefrLevel] ?? SHELF_FULL_RING.B1;
  const fill = Math.max(0, Math.min(100, Math.round((words / reference) * 100)));

  return { words, fill };
}
