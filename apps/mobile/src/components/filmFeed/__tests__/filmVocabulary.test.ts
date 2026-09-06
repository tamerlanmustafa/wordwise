/**
 * `filmVocabulary` — what the home card's ring shows.
 *
 * The arithmetic is a filtered sum and barely needs testing. What needs
 * pinning is the *shape* of the metric, because four predecessors shipped here
 * and every one of them failed the same way: a plausible number that came out
 * near-identical on every card. So the tests that matter are the ones asserting
 * this one still separates films the shelf has already made equal.
 */

import { SHELF_FULL_RING, filmVocabulary } from '../filmVocabulary';

const FULL = { A1: 400, A2: 200, B1: 150, B2: 130, C1: 70, C2: 50 };

describe('filmVocabulary (how many words the film speaks)', () => {
  it('counts every band, because size is not relative to the reader', () => {
    expect(filmVocabulary(FULL, 'A1')?.words).toBe(1000);
    expect(filmVocabulary(FULL, 'C2')?.words).toBe(1000);
  });

  it('gives the same count whoever is looking', () => {
    // The whole point of the retreat to a film statistic: it is not pretending
    // to be personal, so it must not quietly vary by level.
    const counts = (['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const).map(
      (l) => filmVocabulary(FULL, l)!.words,
    );
    expect(new Set(counts).size).toBe(1);
  });

  it('separates films the shelf has made equal', () => {
    // Real C2-shelf range is 730 - 3,390 words. Under coverage both of these
    // read "100%"; under vocabulary demand both read ~36%.
    const big = filmVocabulary({ ...FULL, A1: 2000 }, 'C2')!;
    const small = filmVocabulary({ ...FULL, A1: 200 }, 'C2')!;
    expect(big.words).toBeGreaterThan(small.words * 2);
    expect(big.fill).toBeGreaterThan(small.fill);
  });
});

describe('the ring arc', () => {
  it('fills against a typical film on the same shelf', () => {
    const p = filmVocabulary({ A1: SHELF_FULL_RING.C2 }, 'C2')!;
    expect(p.fill).toBe(100);
  });

  it('clamps rather than overflowing when a film beats the reference', () => {
    expect(filmVocabulary({ A1: SHELF_FULL_RING.C2 * 5 }, 'C2')!.fill).toBe(100);
  });

  it('scales the same film differently per shelf, which is the arc’s job', () => {
    // 1,100 words is wordy for an A1 film and unremarkable for a C2 one. The
    // reader only ever sees one shelf, so the arc is calibrated to that shelf.
    const onA1 = filmVocabulary({ A1: 1100 }, 'A1')!;
    const onC2 = filmVocabulary({ A1: 1100 }, 'C2')!;
    expect(onA1.words).toBe(onC2.words);
    expect(onA1.fill).toBeGreaterThan(onC2.fill);
  });

  it('has a reference for every level, or the arc would be NaN', () => {
    (['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const).forEach((l) => {
      expect(SHELF_FULL_RING[l]).toBeGreaterThan(0);
      expect(Number.isFinite(filmVocabulary(FULL, l)!.fill)).toBe(true);
    });
  });

  it('references grow as the shelf gets harder, because harder films are wordier', () => {
    const refs = (['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const).map(
      (l) => SHELF_FULL_RING[l],
    );
    refs.forEach((r, i) => {
      if (i > 0) expect(r).toBeGreaterThan(refs[i - 1]);
    });
  });
});

describe('UNKNOWN is not a band', () => {
  it('is excluded from the count the ring prints', () => {
    // #91's holding pen: words the classifier could not place. Counting them
    // would inflate "N different words are spoken in this film" with words we
    // cannot name a level for.
    expect(filmVocabulary({ ...FULL, UNKNOWN: 500 }, 'B1')).toEqual(
      filmVocabulary(FULL, 'B1'),
    );
  });

  it('ignores any other stray key the payload carries', () => {
    expect(filmVocabulary({ ...FULL, A0: 999, native: 12 }, 'A1')?.words).toBe(1000);
  });
});

describe('no usable distribution', () => {
  it('is null for a film with no script processed', () => {
    // 171 prod films. The card draws a bare track and an em dash — `0` would
    // claim the film speaks no words at all.
    expect(filmVocabulary(null, 'B1')).toBeNull();
    expect(filmVocabulary(undefined, 'B1')).toBeNull();
  });

  it('is null for an empty or unusable distribution', () => {
    expect(filmVocabulary({}, 'B1')).toBeNull();
    expect(filmVocabulary({ A1: 0, B1: 0 }, 'B1')).toBeNull();
    expect(filmVocabulary({ A1: Number.NaN } as never, 'B1')).toBeNull();
    expect(filmVocabulary({ A1: -5 }, 'B1')).toBeNull();
  });

  it('still counts when the level is junk, since the count does not depend on it', () => {
    // `proficiency_level` is user data and has held junk. The previous metrics
    // had to bail here because they were measured *from* the level; this one
    // only uses it to pick an arc reference, so the number survives.
    expect(filmVocabulary(FULL, 'D1')?.words).toBe(1000);
    expect(filmVocabulary(FULL, '')?.words).toBe(1000);
    expect(filmVocabulary(FULL, 'D1')?.fill).toBe(
      filmVocabulary(FULL, 'B1')?.fill,
    );
  });
});

describe('shape', () => {
  it('tolerates numeric strings, which JSON round-trips have produced before', () => {
    expect(filmVocabulary({ A1: '400', B1: '600' } as never, 'B1')?.words).toBe(1000);
  });
});
