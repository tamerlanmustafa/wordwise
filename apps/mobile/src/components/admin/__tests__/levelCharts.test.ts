/**
 * Chart geometry.
 *
 * Only the pure half is testable — the repo has no component render library on
 * purpose — but the pure half is where a chart actually lies to you. A wrong
 * dash length draws a wedge that looks plausible and is the wrong size, which
 * is worse than a crash on a screen whose whole job is telling you the truth
 * about the system.
 */

import { barWidths, donutSegments, type ChartSlice } from '../LevelCharts';

const C = 100; // a circumference of 100 makes dashes read as percentages

const slice = (label: string, value: number): ChartSlice => ({
  label,
  value,
  color: '#000',
});

describe('donutSegments', () => {
  it('gives each slice an arc proportional to its share', () => {
    const segs = donutSegments([slice('A', 1), slice('B', 3)], C);
    expect(segs.map((s) => s.dash)).toEqual([25, 75]);
    expect(segs.map((s) => s.gap)).toEqual([75, 25]);
  });

  it('lays segments end to end, starting at twelve o’clock', () => {
    const segs = donutSegments([slice('A', 1), slice('B', 1), slice('C', 2)], C);
    // -90 puts the first at the top; each next one starts where the last ended.
    expect(segs.map((s) => s.rotation)).toEqual([-90, 0, 90]);
  });

  it('closes the circle exactly, with no sliver left over', () => {
    const segs = donutSegments([slice('A', 1), slice('B', 1), slice('C', 1)], C);
    const drawn = segs.reduce((sum, s) => sum + s.dash, 0);
    expect(drawn).toBeCloseTo(C, 6);
  });

  it('rounds percentages for display but not the geometry', () => {
    const segs = donutSegments([slice('A', 1), slice('B', 2)], C);
    expect(segs.map((s) => s.pct)).toEqual([33, 67]);
    // The arcs stay exact, so rounding to 33 + 67 = 100 cannot open a gap.
    expect(segs[0].dash + segs[1].dash).toBeCloseTo(C, 6);
  });

  it('drops empty bands instead of drawing zero-length arcs', () => {
    // A zero-length arc is invisible but still takes a legend row, which
    // implies the band exists in the data when it does not.
    const segs = donutSegments([slice('A', 5), slice('B', 0), slice('C', 5)], C);
    expect(segs.map((s) => s.label)).toEqual(['A', 'C']);
  });

  it('renders nothing when there is no data, rather than dividing by zero', () => {
    expect(donutSegments([], C)).toEqual([]);
    expect(donutSegments([slice('A', 0)], C)).toEqual([]);
  });

  it('ignores negative values rather than drawing backwards', () => {
    // Not expected from the API, but a negative dash silently inverts a wedge.
    const segs = donutSegments([slice('A', -5), slice('B', 10)], C);
    expect(segs.map((s) => s.label)).toEqual(['B']);
    expect(segs[0].dash).toBe(C);
  });

  it('handles a single band filling the whole ring', () => {
    const segs = donutSegments([slice('A', 7)], C);
    expect(segs[0].dash).toBe(C);
    expect(segs[0].gap).toBe(0);
    expect(segs[0].pct).toBe(100);
  });
});

describe('barWidths', () => {
  it('scales to the largest value, so the biggest bar fills the track', () => {
    expect(barWidths([slice('A', 50), slice('B', 100), slice('C', 25)])).toEqual([50, 100, 25]);
  });

  it('is all-zero when every value is zero, not NaN', () => {
    // `width: NaN%` silently renders as a full-width bar in RN.
    expect(barWidths([slice('A', 0), slice('B', 0)])).toEqual([0, 0]);
  });

  it('clamps negatives to zero', () => {
    expect(barWidths([slice('A', -10), slice('B', 10)])).toEqual([0, 100]);
  });

  it('returns one width per slice, always', () => {
    const slices = [slice('A', 1), slice('B', 2), slice('C', 3)];
    expect(barWidths(slices)).toHaveLength(slices.length);
  });
});
