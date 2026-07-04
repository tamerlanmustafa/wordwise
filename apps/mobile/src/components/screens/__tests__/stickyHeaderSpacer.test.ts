import { stickySpacerRange } from '../stickyHeaderSpacer';

describe('stickySpacerRange', () => {
  it('expands from 0 to the top inset over the last insetTop points before the header pins', () => {
    // iPhone with dynamic island: inset 62, hero block 320pt tall.
    expect(stickySpacerRange(62, 320)).toEqual({
      inputRange: [258, 320],
      outputRange: [0, 62],
    });
  });

  it('returns null before the hero has been measured (headerY 0)', () => {
    expect(stickySpacerRange(62, 0)).toBeNull();
  });

  it('returns null when there is no top inset (no notch/cutout)', () => {
    expect(stickySpacerRange(0, 320)).toBeNull();
  });

  it('never produces a negative or inverted input range', () => {
    // Header shallower than the inset (degenerate) → no spacer instead of
    // an inputRange that starts below zero or is non-increasing.
    expect(stickySpacerRange(62, 40)).toBeNull();
    expect(stickySpacerRange(62, 62)).toBeNull();
  });
});
