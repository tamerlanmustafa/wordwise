/**
 * `knownShare` — what the home card's ring actually measures.
 *
 * The boundaries are the whole test: this replaced a ring that showed
 * `difficulty_score` and `scoreToCefr()` of the *same number*, so the failure
 * this guards against is not a crash but a plausible-looking percentage that
 * is quietly about the wrong thing.
 */

import { knownShare } from '../comprehension';

// A film with every band populated, so a cut point at any level is visible.
// 1000 total across the six real bands, which makes the expected percentages
// readable without a calculator.
const FULL = { A1: 400, A2: 200, B1: 150, B2: 130, C1: 70, C2: 50 };

describe('knownShare (share of a film at or below the reader)', () => {
  it('counts only A1 at A1 — the bottom of the ladder is not "everything"', () => {
    expect(knownShare(FULL, 'A1')).toEqual({ pct: 40, atOrBelow: 400, total: 1000 });
  });

  it('counts everything at C2 — the top of the ladder is 100%', () => {
    expect(knownShare(FULL, 'C2')).toEqual({ pct: 100, atOrBelow: 1000, total: 1000 });
  });

  it('is inclusive of the reader’s own band, not just below it', () => {
    // B1 must include the 150 B1 words. "at or below" is the claim the sheet
    // makes in prose, so an off-by-one-band here would make the copy false.
    expect(knownShare(FULL, 'B1')?.atOrBelow).toBe(750);
    expect(knownShare(FULL, 'B1')?.pct).toBe(75);
  });

  it('walks the ladder monotonically', () => {
    const pcts = (['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const).map(
      (l) => knownShare(FULL, l)!.pct,
    );
    expect(pcts).toEqual([40, 60, 75, 88, 95, 100]);
    pcts.forEach((p, i) => {
      if (i > 0) expect(p).toBeGreaterThanOrEqual(pcts[i - 1]);
    });
  });
});

describe('UNKNOWN is not a band', () => {
  it('is excluded from the denominator, not just the numerator', () => {
    // #91's holding pen: words the classifier could not place. Leaving them in
    // the denominator would depress every film's percentage by however much of
    // the catalogue is still unclassified — a fact about our data pretending
    // to be a fact about the film.
    const withUnknown = { ...FULL, UNKNOWN: 500 };
    expect(knownShare(withUnknown, 'B1')).toEqual(knownShare(FULL, 'B1'));
    expect(knownShare(withUnknown, 'B1')?.total).toBe(1000);
  });

  it('ignores any other stray key the payload carries', () => {
    expect(knownShare({ ...FULL, A0: 999, native: 12 }, 'C2')?.total).toBe(1000);
  });
});

describe('no usable distribution', () => {
  it('is null for a film with no script processed', () => {
    // 171 prod films. The card draws a bare track and an em dash for these —
    // 0% would read as "you know none of this film", which is a claim.
    expect(knownShare(null, 'B1')).toBeNull();
    expect(knownShare(undefined, 'B1')).toBeNull();
  });

  it('is null for an empty distribution', () => {
    expect(knownShare({}, 'B1')).toBeNull();
  });

  it('is null when every band is zero or unusable', () => {
    expect(knownShare({ A1: 0, B1: 0 }, 'B1')).toBeNull();
    expect(knownShare({ A1: Number.NaN } as never, 'B1')).toBeNull();
    expect(knownShare({ A1: -5 }, 'B1')).toBeNull();
  });

  it('is null for a level that is not on the ladder, rather than a guess', () => {
    // `proficiency_level` is user data and has held junk before. Guessing a
    // cut point would print a confident percentage measured against nothing.
    expect(knownShare(FULL, 'b1')).toBeNull();
    expect(knownShare(FULL, 'D1')).toBeNull();
    expect(knownShare(FULL, '')).toBeNull();
  });
});

describe('shape', () => {
  it('rounds the percent but keeps the raw counts, which the sheet prints', () => {
    const share = knownShare({ A1: 1, B1: 2 }, 'A1')!;
    expect(share).toEqual({ pct: 33, atOrBelow: 1, total: 3 });
  });

  it('tolerates numeric strings, which JSON round-trips have produced before', () => {
    expect(knownShare({ A1: '400', B1: '600' } as never, 'A1')?.pct).toBe(40);
  });
});
