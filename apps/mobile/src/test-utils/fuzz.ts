/**
 * fuzz — deterministic randomness for the stress tests.
 *
 * A stress test's whole value is that it tries sequences nobody thought to
 * write down. Its whole *cost* is that a failure you cannot reproduce is worse
 * than no failure at all: it lands in CI, someone re-runs the job, it passes,
 * and the suite is quietly retrained to be ignored.
 *
 * So the randomness is seeded and the seed is part of the test. `Math.random()`
 * is never used here. Every generator below is a pure function of the seed, so
 * a red run names the exact sequence that broke, and pasting that seed into a
 * focused test reproduces it on the first attempt.
 *
 * The generator is a 32-bit xorshift — not because the statistical quality
 * matters (it does not; we are picking array indices) but because it is short
 * enough to read, has no dependency, and gives the same stream on every
 * platform and Node version. `Math.random()` seeded via a library would give
 * neither of the last two.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, max). */
  int(max: number): number;
  /** A uniformly chosen element. Throws on an empty list — an empty pool in a
   *  stress test is a bug in the test, and silently returning undefined is how
   *  it survives to assert nothing. */
  pick<T>(items: readonly T[]): T;
  /** True with probability `p`. */
  chance(p: number): boolean;
  /** Uniform number in [min, max). */
  range(min: number, max: number): number;
}

/**
 * A seeded generator. Any integer seed works; 0 is remapped because xorshift
 * has a fixed point there and would return the same number for ever — the kind
 * of silent degeneracy that makes a stress test pass by doing nothing.
 */
export function makeRng(seed: number): Rng {
  let state = (seed | 0) === 0 ? 0x9e3779b9 : seed | 0;
  const next = () => {
    // xorshift32
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state |= 0;
    return (state >>> 0) / 0x100000000;
  };
  const int = (max: number) => Math.floor(next() * max);
  return {
    next,
    int,
    pick: <T,>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('fuzz: pick from an empty list');
      return items[int(items.length)];
    },
    chance: (p: number) => next() < p,
    range: (min: number, max: number) => min + next() * (max - min),
  };
}

/**
 * Run `body` once per seed, naming the seed in the test output.
 *
 * Used instead of a loop inside one `it` so a failure says WHICH seed failed
 * rather than "the stress test failed" — the difference between a bug report
 * and a shrug.
 */
export function forSeeds(count: number, body: (rng: Rng, seed: number) => void): void {
  for (let seed = 1; seed <= count; seed += 1) {
    try {
      body(makeRng(seed), seed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`seed ${seed}: ${message}`);
    }
  }
}

/**
 * Values chosen to break things: the boundaries, the signs, the impossible.
 *
 * Uniform random numbers almost never hit an edge — a fuzzer picking floats in
 * [-500, 500] will not produce 0, or exactly the threshold, in any realistic
 * number of runs, and those are the values that break comparisons. So the
 * generators below mix a uniform stream with a table of deliberate awkward
 * cases.
 */
export const NASTY_NUMBERS: readonly number[] = [
  0,
  -0,
  1,
  -1,
  0.5,
  -0.5,
  Number.EPSILON,
  -Number.EPSILON,
  1e-9,
  1e9,
  -1e9,
  Number.MAX_SAFE_INTEGER,
  Number.MIN_SAFE_INTEGER,
];

/** A gesture-sized number: mostly plausible, occasionally pathological. */
export function gestureValue(rng: Rng, spread = 400): number {
  return rng.chance(0.15) ? rng.pick(NASTY_NUMBERS) : rng.range(-spread, spread);
}
