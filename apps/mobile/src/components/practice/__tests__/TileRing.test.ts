/**
 * The ring around the active tile turns once every 18 seconds, which means
 * any flaw in it is on screen the whole time the user is deciding whether to
 * tap. Two of those flaws are arithmetic rather than art:
 *
 *   • a dash pattern that doesn't divide the circumference leaves a short
 *     gap where the stroke closes — a seam that walks around the ring;
 *   • too few dots on a small radius reads as three ticks, not a ring.
 *
 * Both are pure functions of the radius, so both are checked here rather
 * than by eye on one device.
 */
import { ringDashes } from '../TileRing';

const circumference = (r: number) => 2 * Math.PI * r;

describe('ringDashes', () => {
  it('divides the circumference exactly, leaving no seam', () => {
    for (const r of [12, 30, 42.25, 80]) {
      const { count, step } = ringDashes(r, 11);
      expect(count * step).toBeCloseTo(circumference(r), 9);
    }
  });

  it('returns a whole number of dots', () => {
    const { count } = ringDashes(42.25, 11);
    expect(Number.isInteger(count)).toBe(true);
  });

  it('lands within half a step of the requested spacing', () => {
    for (const spacing of [8, 11, 16]) {
      const { step } = ringDashes(42.25, spacing);
      expect(Math.abs(step - spacing)).toBeLessThan(spacing / 2);
    }
  });

  it('keeps a ring a ring on a tiny radius', () => {
    // Rounding alone would give 2 dots at r=3 — two dots facing each other,
    // which reads as a broken ring rather than a dotted one.
    expect(ringDashes(3, 11).count).toBe(6);
    expect(ringDashes(3, 11).step).toBeCloseTo(circumference(3) / 6, 9);
  });

  it('scales the dot count with the radius', () => {
    expect(ringDashes(80, 11).count).toBeGreaterThan(ringDashes(40, 11).count);
  });
});
