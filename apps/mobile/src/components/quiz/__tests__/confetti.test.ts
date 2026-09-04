/**
 * Confetti geometry.
 *
 * Sixty-four animated views is the most expensive thing the quiz draws, and
 * every number driving them is decided here. The bug this guards is not a
 * crash: it is a piece with a NaN duration that never animates, or a burst
 * regenerated on re-render so the pieces teleport instead of falling.
 */

import { CONFETTI_COUNT, confettiPieces } from '../confetti';

describe('confettiPieces', () => {
  it('is deterministic for a seed, so a re-render cannot reshuffle the sky', () => {
    // Generating with Math.random() during render gives every piece new
    // coordinates on each commit — the same class of bug as re-deriving a
    // pagination seed mid-scroll, and it looks like teleporting confetti.
    expect(confettiPieces(8, 42)).toEqual(confettiPieces(8, 42));
  });

  it('gives different bursts for different seeds', () => {
    expect(confettiPieces(8, 1)).not.toEqual(confettiPieces(8, 2));
  });

  it('makes the number of pieces asked for', () => {
    expect(confettiPieces(20, 7)).toHaveLength(20);
    expect(confettiPieces()).toHaveLength(CONFETTI_COUNT);
  });

  it('keeps every piece on screen horizontally', () => {
    // `x` is a fraction of the screen width; outside 0–1 a piece falls in a
    // column nobody can see and the burst silently thins.
    for (const p of confettiPieces(200, 3)) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
    }
  });

  it('gives every piece a real, finite, positive fall', () => {
    // A zero or NaN duration is an animation that never runs, which shows up
    // as a piece frozen at the top of the screen for the whole beat.
    for (const p of confettiPieces(200, 4)) {
      expect(Number.isFinite(p.duration)).toBe(true);
      expect(p.duration).toBeGreaterThan(0);
      expect(Number.isFinite(p.delay)).toBe(true);
      expect(p.delay).toBeGreaterThanOrEqual(0);
    }
  });

  it('staggers rather than dropping a curtain', () => {
    // If every delay were the same the burst would arrive as one sheet and be
    // gone; the spread is what keeps the sky busy for the whole celebration.
    const delays = confettiPieces(64, 5).map((p) => p.delay);
    expect(new Set(delays.map(Math.round)).size).toBeGreaterThan(20);
    expect(Math.min(...delays)).toBeLessThan(400);
  });

  it('mixes rectangles and circles', () => {
    const shapes = confettiPieces(64, 6);
    expect(shapes.some((p) => p.aspect === 1)).toBe(true);
    expect(shapes.some((p) => p.aspect > 1)).toBe(true);
  });

  it('gives every piece a visible size', () => {
    for (const p of confettiPieces(200, 8)) {
      expect(p.width).toBeGreaterThan(0);
      expect(p.width / p.aspect).toBeGreaterThan(0);
    }
  });

  it('always spins forward, so no piece hangs motionless', () => {
    for (const p of confettiPieces(200, 9)) {
      expect(p.spin).toBeGreaterThanOrEqual(360);
    }
  });

  it('spreads colours across the whole palette', () => {
    const used = new Set(confettiPieces(64, 10).map((p) => p.colorIndex));
    expect(used.size).toBe(5);
  });
});
