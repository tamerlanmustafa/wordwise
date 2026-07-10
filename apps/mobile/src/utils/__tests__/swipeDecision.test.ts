import {
  shouldClaimHorizontal,
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

  it('yields to a vertical drag (list scroll)', () => {
    expect(shouldClaimHorizontal(20, 40)).toBe(false);
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
