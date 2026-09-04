/**
 * confetti — the pieces, as data.
 *
 * Pure and seeded so the burst can be unit-tested and so a re-render cannot
 * reshuffle it mid-fall. `Math.random()` called during render would give every
 * piece new coordinates on each commit, which reads as the confetti teleporting
 * rather than falling — the same class of bug as re-deriving a pagination seed.
 *
 * Nothing here knows about React. The component maps a piece to an
 * `Animated.Value` and interpolates; every number a piece needs is decided
 * once, here.
 */

export interface ConfettiPiece {
  /** Horizontal start, 0–1 across the screen. */
  x: number;
  /** Fall duration in ms. */
  duration: number;
  /** Delay before this piece starts, in ms. */
  delay: number;
  /** Horizontal drift over the fall, in points (can be negative). */
  drift: number;
  /** Total rotation over the fall, in degrees. */
  spin: number;
  /** Width in points; rects are `width` x `width / aspect`. */
  width: number;
  /** 1 for a circle, >1 for a thin rectangle. */
  aspect: number;
  /** Index into the caller's palette. */
  colorIndex: number;
}

/**
 * A small deterministic PRNG (mulberry32).
 *
 * Seeded rather than `Math.random()` so a given burst is reproducible: the
 * test can assert real bounds on real pieces instead of on a mock, and a
 * component re-render regenerating the array lands on the identical layout.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const CONFETTI_COUNT = 64;
export const CONFETTI_PALETTE_SIZE = 5;

/**
 * `count` pieces spread across the width, staggered so they arrive as a fall
 * rather than a curtain dropping all at once.
 */
export function confettiPieces(
  count: number = CONFETTI_COUNT,
  seed = 0x5eed,
): ConfettiPiece[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: count }, (_, i) => {
    const isCircle = rnd() < 0.35;
    return {
      x: rnd(),
      duration: 2600 + rnd() * 1900,
      // Staggered across 2.4s. The first pieces land while the last are still
      // leaving, which is what keeps the sky occupied for the whole beat.
      delay: rnd() * 2400,
      drift: (rnd() - 0.5) * 150,
      spin: 360 + rnd() * 900,
      width: isCircle ? 5 + rnd() * 4 : 5 + rnd() * 5,
      aspect: isCircle ? 1 : 1.6 + rnd() * 1,
      colorIndex: i % CONFETTI_PALETTE_SIZE,
    };
  });
}
