/**
 * levelMix — the Explore mix reducer.
 *
 * The rule these all defend: every level moves independently. `+` and drag
 * are clamped by what's left of 100 and never steal from a level the user
 * already set; `−` always works down to 0. A sub-100 total is a legal
 * intermediate state — only a balanced mix may reach the server.
 */
import {
  MIX_LEVELS,
  MIX_STEP,
  canDecrement,
  canIncrement,
  decrement,
  defaultMixForLevel,
  dominantLevel,
  increment,
  isBalanced,
  isValidMix,
  mixTotal,
  remainingToAssign,
  setLevel,
  setLevelFromFraction,
} from '../levelMix';

const DEFAULT = { A2: 0, B1: 70, B2: 20, C1: 10 };

describe('levelMix — totals', () => {
  it('sums the four levels', () => {
    expect(mixTotal(DEFAULT)).toBe(100);
  });

  it('treats a missing level as zero', () => {
    expect(mixTotal({ B1: 60, B2: 40 })).toBe(100);
  });

  it('reports what is still unassigned', () => {
    expect(remainingToAssign({ B1: 70, B2: 15 })).toBe(15);
    expect(remainingToAssign(DEFAULT)).toBe(0);
  });

  it('never reports negative remaining', () => {
    expect(remainingToAssign({ B1: 100, B2: 50 })).toBe(0);
  });
});

describe('levelMix — increment', () => {
  it('moves one level without touching the others', () => {
    const next = increment({ A2: 0, B1: 60, B2: 20, C1: 10 }, 'B1');
    expect(next.B1).toBe(65);
    expect(next.B2).toBe(20);
    expect(next.C1).toBe(10);
    expect(next.A2).toBe(0);
  });

  it('is clamped by what is left of 100 rather than stealing', () => {
    // 5 left; B1 may only take those 5, and B2 must be untouched.
    const next = increment({ A2: 0, B1: 70, B2: 20, C1: 5 }, 'B1');
    expect(next.B1).toBe(75);
    expect(next.B2).toBe(20);
    expect(mixTotal(next)).toBe(100);
  });

  it('is a no-op at a full 100', () => {
    expect(increment(DEFAULT, 'B1')).toEqual(DEFAULT);
  });

  it('can be disabled for the stepper glyph', () => {
    expect(canIncrement(DEFAULT)).toBe(false);
    expect(canIncrement({ B1: 70, B2: 20 })).toBe(true);
    // Less than one detent left — the `+` must dim.
    expect(canIncrement({ B1: 70, B2: 20, C1: 8 })).toBe(false);
  });
});

describe('levelMix — decrement', () => {
  it('always works, even from a balanced mix', () => {
    expect(decrement(DEFAULT, 'B1').B1).toBe(65);
  });

  it('floors at zero rather than going negative', () => {
    expect(decrement({ A2: 0, B1: 100 }, 'A2').A2).toBe(0);
    expect(decrement({ B1: MIX_STEP }, 'B1').B1).toBe(0);
  });

  it('is disabled only at zero', () => {
    expect(canDecrement(DEFAULT, 'A2')).toBe(false);
    expect(canDecrement(DEFAULT, 'B1')).toBe(true);
  });
});

describe('levelMix — drag', () => {
  it('snaps to 5% detents', () => {
    // 0.63 of the track = 63% → snaps to 65.
    expect(setLevelFromFraction({ A2: 0, B1: 0, B2: 0, C1: 0 }, 'B1', 0.63).B1).toBe(65);
    expect(setLevelFromFraction({ A2: 0, B1: 0, B2: 0, C1: 0 }, 'B1', 0.61).B1).toBe(60);
  });

  it('clamps a drag past the end to what is left of 100', () => {
    const next = setLevelFromFraction({ A2: 0, B1: 10, B2: 20, C1: 10 }, 'B1', 1);
    expect(next.B1).toBe(70);
    expect(mixTotal(next)).toBe(100);
    // Other levels untouched.
    expect(next.B2).toBe(20);
    expect(next.C1).toBe(10);
  });

  it('clamps a drag before the start to zero', () => {
    expect(setLevelFromFraction(DEFAULT, 'B1', -0.4).B1).toBe(0);
  });

  it('can drag a level all the way down to 0', () => {
    expect(setLevelFromFraction(DEFAULT, 'B1', 0).B1).toBe(0);
  });
});

describe('levelMix — setLevel', () => {
  it('never lets the total exceed 100', () => {
    for (const value of [0, 25, 50, 75, 100, 250]) {
      const next = setLevel({ A2: 10, B1: 40, B2: 20, C1: 10 }, 'B1', value);
      expect(mixTotal(next)).toBeLessThanOrEqual(100);
    }
  });

  it('leaves every other level exactly as it was', () => {
    const before = { A2: 10, B1: 40, B2: 20, C1: 10 };
    const next = setLevel(before, 'B1', 5);
    expect(next.A2).toBe(before.A2);
    expect(next.B2).toBe(before.B2);
    expect(next.C1).toBe(before.C1);
  });
});

describe('levelMix — dominant level', () => {
  it('names the most-weighted level for the rail', () => {
    expect(dominantLevel(DEFAULT)).toBe('B1');
    expect(dominantLevel({ A2: 0, B1: 10, B2: 60, C1: 30 })).toBe('B2');
  });

  it('breaks ties toward the lower level so the label does not flicker', () => {
    expect(dominantLevel({ A2: 0, B1: 50, B2: 50, C1: 0 })).toBe('B1');
  });
});

describe('levelMix — first-run default', () => {
  it('sits 70/20/10 on the user level and the two above', () => {
    expect(defaultMixForLevel('B1')).toEqual({ A2: 0, B1: 70, B2: 20, C1: 10 });
    expect(defaultMixForLevel('A2')).toEqual({ A2: 70, B1: 20, B2: 10, C1: 0 });
  });

  it('folds the overflow back when the band runs off the top', () => {
    // C1 is the highest addressable level — a C1 user can't have "one above".
    const c1 = defaultMixForLevel('C1');
    expect(c1.C1).toBe(100);
    expect(mixTotal(c1)).toBe(100);
  });

  it('falls back to B1 for unknown or unaddressed levels', () => {
    expect(defaultMixForLevel('A1')).toEqual(defaultMixForLevel('B1'));
    expect(defaultMixForLevel(null)).toEqual(defaultMixForLevel('B1'));
    expect(defaultMixForLevel('nonsense')).toEqual(defaultMixForLevel('B1'));
  });

  it('always produces a balanced mix', () => {
    for (const level of MIX_LEVELS) {
      expect(isBalanced(defaultMixForLevel(level))).toBe(true);
    }
  });
});

describe('levelMix — validation guard', () => {
  it('accepts a balanced mix', () => {
    expect(isValidMix(DEFAULT)).toBe(true);
  });

  it('rejects sums that are not 100', () => {
    expect(isValidMix({ B1: 70, B2: 20 })).toBe(false);
    expect(isValidMix({ B1: 70, B2: 40 })).toBe(false);
  });

  it('rejects unknown levels and bad shapes', () => {
    expect(isValidMix({ A1: 100 })).toBe(false);
    expect(isValidMix({ B1: '70' })).toBe(false);
    expect(isValidMix({ B1: NaN, B2: 100 })).toBe(false);
    expect(isValidMix({})).toBe(false);
    expect(isValidMix(null)).toBe(false);
  });
});
