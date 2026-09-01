import {
  edgeCommitDistance,
  edgeSwipeCommits,
  isEdgeStart,
  leadingEdgeDistance,
  shouldClaimEdgeSwipe,
  EDGE_CLAIM_DX,
  EDGE_COMMIT_MIN_DX,
  EDGE_ZONE_WIDTH,
} from '../edgeSwipeBack';
import { SWIPE_COMMIT_VELOCITY } from '../swipeDecision';

const PHONE_WIDTH = 390;

describe('isEdgeStart', () => {
  it('accepts a touch that begins inside the edge zone', () => {
    expect(isEdgeStart(0)).toBe(true);
    expect(isEdgeStart(EDGE_ZONE_WIDTH)).toBe(true);
  });

  it('rejects a touch that begins mid-screen', () => {
    // The whole point of the zone: a drag started on the word-card deck or a
    // horizontal carousel must stay theirs.
    expect(isEdgeStart(EDGE_ZONE_WIDTH + 1)).toBe(false);
    expect(isEdgeStart(200)).toBe(false);
  });
});

describe('leadingEdgeDistance', () => {
  it('measures from the left in LTR', () => {
    expect(leadingEdgeDistance(12, PHONE_WIDTH, false)).toBe(12);
  });

  it('measures from the right in RTL', () => {
    // An Arabic build's back swipe lives on the right edge, so x=378 on a
    // 390pt screen is 12pt in from the leading edge.
    expect(leadingEdgeDistance(378, PHONE_WIDTH, true)).toBe(12);
    // …and the left edge is as far from leading as it gets.
    expect(leadingEdgeDistance(4, PHONE_WIDTH, true)).toBe(386);
  });
});

describe('shouldClaimEdgeSwipe', () => {
  it('claims a horizontal drag in from the edge', () => {
    expect(shouldClaimEdgeSwipe(6, EDGE_CLAIM_DX + 5, 2)).toBe(true);
  });

  it('ignores a drag that started away from the edge', () => {
    expect(shouldClaimEdgeSwipe(120, 40, 2)).toBe(false);
  });

  it('ignores a drag that travels the wrong way', () => {
    // Toward the leading edge — that is a forward gesture, not a back one.
    expect(shouldClaimEdgeSwipe(6, -40, 2)).toBe(false);
  });

  it('yields a vertical drag from the edge to the screen underneath', () => {
    expect(shouldClaimEdgeSwipe(6, 12, 60)).toBe(false);
  });

  it('forgives the vertical drift of a real thumb swipe', () => {
    expect(shouldClaimEdgeSwipe(6, 20, 26)).toBe(true);
  });

  it('ignores jitter below the claim threshold', () => {
    expect(shouldClaimEdgeSwipe(6, EDGE_CLAIM_DX, 0)).toBe(false);
  });
});

describe('edgeCommitDistance', () => {
  it('scales with the screen but never drops below the floor', () => {
    expect(edgeCommitDistance(PHONE_WIDTH)).toBeCloseTo(PHONE_WIDTH * 0.32);
    // A narrow device would land under the floor on the fraction alone.
    expect(edgeCommitDistance(120)).toBe(EDGE_COMMIT_MIN_DX);
  });
});

describe('edgeSwipeCommits', () => {
  it('commits a drag past the distance threshold', () => {
    expect(edgeSwipeCommits(edgeCommitDistance(PHONE_WIDTH), 0, PHONE_WIDTH)).toBe(true);
  });

  it('springs back a short, slow drag', () => {
    expect(edgeSwipeCommits(40, 0.1, PHONE_WIDTH)).toBe(false);
  });

  it('commits a short but fast flick', () => {
    expect(edgeSwipeCommits(40, SWIPE_COMMIT_VELOCITY, PHONE_WIDTH)).toBe(true);
  });

  it('never commits on a twitch, however fast', () => {
    // Released before the gesture even cleared the claim threshold.
    expect(edgeSwipeCommits(EDGE_CLAIM_DX, 5, PHONE_WIDTH)).toBe(false);
    expect(edgeSwipeCommits(0, 5, PHONE_WIDTH)).toBe(false);
  });

  it('never commits a drag that ended back where it started', () => {
    expect(edgeSwipeCommits(-20, -1, PHONE_WIDTH)).toBe(false);
  });
});
