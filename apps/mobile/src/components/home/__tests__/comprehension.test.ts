/**
 * `learningPayload` — what the home card's ring counts.
 *
 * The thing under test is not really the arithmetic (it is a filtered sum);
 * it is the *shape* of the metric. Two previous metrics shipped here and both
 * failed the same way — they produced a plausible number that was identical on
 * every card — so the tests that matter are the ones asserting it still varies
 * where its predecessors went flat.
 */

import { SHELF_FULL_RING, learningPayload } from '../comprehension';

// A film with every band populated. 1000 across the six real bands, so the
// expected counts are readable without a calculator.
const FULL = { A1: 400, A2: 200, B1: 150, B2: 130, C1: 70, C2: 50 };

describe('learningPayload (what is left to teach you)', () => {
  it('counts your own band plus exactly one above it', () => {
    // Starts *at* your level because you are still consolidating there, and
    // strictly-above collapses to zero at C2. Stops one up because that is
    // what MovieDetail's "For you" deck is built from — counting to the top
    // of the ladder promised words the deck would never offer.
    expect(learningPayload(FULL, 'A1')?.count).toBe(600); // 400 + 200
    expect(learningPayload(FULL, 'B1')?.count).toBe(280); // 150 + 130
    expect(learningPayload(FULL, 'C1')?.count).toBe(120); // 70 + 50
  });

  it('is just the top band at C2, where there is nothing above', () => {
    expect(learningPayload(FULL, 'C2')?.count).toBe(50);
  });

  it('never promises more than the deck behind it can deliver', () => {
    // The regression this guards: an A1 card once read 1,203 while the deck
    // offered 884. The count must equal level + next, never the whole tail.
    const atOrAbove = 1000; // every band, which is what it used to count
    expect(learningPayload(FULL, 'A1')!.count).toBeLessThan(atOrAbove);
    expect(learningPayload(FULL, 'A1')!.count).toBe(FULL.A1 + FULL.A2);
  });

  it('still reports the film’s whole vocabulary as the total', () => {
    // The sheet prints "N different words are spoken in this film", which is
    // the film, not the deck.
    expect(learningPayload(FULL, 'C2')?.total).toBe(1000);
  });
});

describe('it does not go flat at the top, which is why it replaced coverage', () => {
  it('separates two C2 films that coverage rendered identically', () => {
    // Real prod films on the C2 shelf. Under "share at or below your level"
    // both read 100%; the difference between them is 13x.
    const lincoln = { A1: 900, A2: 500, B1: 300, B2: 200, C1: 90, C2: 52 };
    const alien = { A1: 900, A2: 500, B1: 300, B2: 200, C1: 40, C2: 4 };

    expect(learningPayload(lincoln, 'C2')!.count).toBe(52);
    expect(learningPayload(alien, 'C2')!.count).toBe(4);
    // And the rings look different, not just the numbers.
    expect(learningPayload(lincoln, 'C2')!.fill).toBeGreaterThan(
      learningPayload(alien, 'C2')!.fill + 40,
    );
  });

  it('never returns the same count for films with different hard vocabulary', () => {
    const a = learningPayload({ ...FULL, C2: 10 }, 'C2')!.count;
    const b = learningPayload({ ...FULL, C2: 40 }, 'C2')!.count;
    expect(a).not.toBe(b);
  });
});

describe('the ring arc', () => {
  it('fills against a typical film on the same shelf, not against the film', () => {
    // count/total would peg every C2 ring near empty (12 of 1,479 is 0.8%).
    // The reference is the shelf's own p90.
    const p = learningPayload({ ...FULL, C2: SHELF_FULL_RING.C2 }, 'C2')!;
    expect(p.fill).toBe(100);
  });

  it('clamps rather than overflowing when a film beats the reference', () => {
    const p = learningPayload({ ...FULL, C2: SHELF_FULL_RING.C2 * 5 }, 'C2')!;
    expect(p.fill).toBe(100);
  });

  it('has a reference for every level, or the arc would be NaN', () => {
    (['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const).forEach((l) => {
      expect(SHELF_FULL_RING[l]).toBeGreaterThan(0);
      expect(Number.isFinite(learningPayload(FULL, l)!.fill)).toBe(true);
    });
  });

  it('references get smaller as the shelf gets harder', () => {
    // A C2 shelf's films carry a handful of C2 words where an A1 shelf's carry
    // hundreds; one shared reference would peg the top of the ladder at empty.
    const refs = (['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const).map(
      (l) => SHELF_FULL_RING[l],
    );
    refs.forEach((r, i) => {
      if (i > 0) expect(r).toBeLessThan(refs[i - 1]);
    });
  });
});

describe('UNKNOWN is not a band', () => {
  it('is excluded from the total the sheet prints', () => {
    // #91's holding pen: words the classifier could not place. Counting them
    // would inflate "N different words are spoken in this film" with words
    // nobody can be taught.
    expect(learningPayload({ ...FULL, UNKNOWN: 500 }, 'B1')).toEqual(
      learningPayload(FULL, 'B1'),
    );
  });

  it('ignores any other stray key the payload carries', () => {
    expect(learningPayload({ ...FULL, A0: 999, native: 12 }, 'A1')?.total).toBe(1000);
  });
});

describe('no usable distribution', () => {
  it('is null for a film with no script processed', () => {
    // 171 prod films. The card draws a bare track and an em dash — `0` would
    // read as "this film has nothing for you", which is a claim.
    expect(learningPayload(null, 'B1')).toBeNull();
    expect(learningPayload(undefined, 'B1')).toBeNull();
  });

  it('is null for an empty or unusable distribution', () => {
    expect(learningPayload({}, 'B1')).toBeNull();
    expect(learningPayload({ A1: 0, B1: 0 }, 'B1')).toBeNull();
    expect(learningPayload({ A1: Number.NaN } as never, 'B1')).toBeNull();
    expect(learningPayload({ A1: -5 }, 'B1')).toBeNull();
  });

  it('is null for a level that is not on the ladder, rather than a guess', () => {
    // `proficiency_level` is user data and has held junk before.
    expect(learningPayload(FULL, 'b1')).toBeNull();
    expect(learningPayload(FULL, 'D1')).toBeNull();
    expect(learningPayload(FULL, '')).toBeNull();
  });
});

describe('shape', () => {
  it('carries the raw counts the sheet prints alongside the fill', () => {
    const p = learningPayload({ A1: 1, B1: 2 }, 'B1')!;
    expect(p.count).toBe(2);
    expect(p.total).toBe(3);
  });

  it('tolerates numeric strings, which JSON round-trips have produced before', () => {
    expect(learningPayload({ A1: '400', B1: '600' } as never, 'B1')?.count).toBe(600);
  });
});
