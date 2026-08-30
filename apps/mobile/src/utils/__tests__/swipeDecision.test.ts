import {
  shouldClaimHorizontal,
  shouldResetSwipeOffset,
  swipeActionOnRelease,
  SWIPE_CLAIM_DX,
  SWIPE_COMMIT_DX,
  SWIPE_COMMIT_VELOCITY,
} from '../swipeDecision';

describe('shouldClaimHorizontal', () => {
  it('claims a clearly horizontal drag', () => {
    expect(shouldClaimHorizontal(SWIPE_CLAIM_DX + 5, 3)).toBe(true);
    expect(shouldClaimHorizontal(-(SWIPE_CLAIM_DX + 5), 3)).toBe(true);
  });

  it('yields to a clearly vertical drag (list scroll)', () => {
    expect(shouldClaimHorizontal(20, 40)).toBe(false);
    expect(shouldClaimHorizontal(10, 40)).toBe(false);
  });

  it('still claims a mostly-horizontal drag that has some vertical drift', () => {
    // 20px across, 26px down — before the bias this scrolled; now it swipes,
    // so a real thumb swipe (never perfectly horizontal) isn't stolen.
    expect(shouldClaimHorizontal(20, 26)).toBe(true);
  });

  it('ignores tiny jitters below the claim threshold', () => {
    expect(shouldClaimHorizontal(SWIPE_CLAIM_DX, 0)).toBe(false);
    expect(shouldClaimHorizontal(3, 1)).toBe(false);
  });
});

describe('swipeActionOnRelease', () => {
  it('snaps back when neither distance nor velocity commits', () => {
    expect(swipeActionOnRelease(40, 0.1)).toBeNull();
  });

  it('commits watched on a far-enough right drag', () => {
    expect(swipeActionOnRelease(SWIPE_COMMIT_DX + 1, 0)).toBe('watched');
  });

  it('commits notInterested on a far-enough left drag', () => {
    expect(swipeActionOnRelease(-(SWIPE_COMMIT_DX + 1), 0)).toBe('notInterested');
  });

  it('commits on a fast flick even below the distance threshold', () => {
    expect(swipeActionOnRelease(30, SWIPE_COMMIT_VELOCITY + 0.2)).toBe('watched');
    expect(swipeActionOnRelease(-30, -(SWIPE_COMMIT_VELOCITY + 0.2))).toBe('notInterested');
  });

  it('returns null on a dead release (no movement, no velocity)', () => {
    expect(swipeActionOnRelease(0, 0)).toBeNull();
  });
});

describe('shouldResetSwipeOffset', () => {
  it('resets when a recycled row lands on a different movie', () => {
    expect(shouldResetSwipeOffset('101', '102')).toBe(true);
  });

  it('does not reset while the row keeps showing the same movie', () => {
    // Rows re-render constantly as the feed scrolls; resetting on every render
    // would cancel a drag the finger is still holding.
    expect(shouldResetSwipeOffset('101', '101')).toBe(false);
  });

  it('does not reset on first render, where the offset is already 0', () => {
    expect(shouldResetSwipeOffset(undefined, '101')).toBe(false);
  });

  it('compares by identity, so numeric and string ids are distinct', () => {
    // The list passes String(...) — this pins that a caller mixing the two
    // would reset every render rather than silently never resetting.
    expect(shouldResetSwipeOffset(101, '101')).toBe(true);
  });

  it('resets when a row is recycled onto an item with no id', () => {
    expect(shouldResetSwipeOffset('101', undefined)).toBe(true);
  });
});
