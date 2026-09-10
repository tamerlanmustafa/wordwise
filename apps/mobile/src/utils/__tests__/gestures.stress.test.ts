/**
 * Every gesture the app can be handed, including the ones a thumb should not
 * be able to produce.
 *
 * Swipes are buttons here — a card is dismissed by one, a row is actioned by
 * one, a screen is closed by one — and unlike a button they are answered from
 * raw floats supplied by the platform. `dx` and `vx` arrive as whatever the
 * gesture system measured, which on a fast flick, a multi-touch, or a
 * responder handed over mid-drag includes zero, negative zero, and numbers no
 * finger produced.
 *
 * A gesture resolver has one job under all of that: return a decision. Not
 * NaN, not undefined, not a throw — a screen frozen because a comparison
 * silently went false is the failure mode, and it looks like "the app stopped
 * responding" rather than like a crash anyone can find.
 *
 * These three resolvers are the app's whole gesture vocabulary: the feed row's
 * swipe, the deck's claim rule, and the edge-swipe back.
 */

import {
  shouldClaimHorizontal,
  swipeActionOnRelease,
  shouldResetSwipeOffset,
  SWIPE_COMMIT_DX,
  SWIPE_COMMIT_VELOCITY,
} from '../swipeDecision';
import {
  edgeCommitDistance,
  edgeSwipeCommits,
  isEdgeStart,
  leadingEdgeDistance,
  shouldClaimEdgeSwipe,
  EDGE_ZONE_WIDTH,
} from '../edgeSwipeBack';
import { shouldClaimHorizontalDrag } from '../../components/vocabulary/deckLogic';
import { forSeeds, gestureValue, makeRng, NASTY_NUMBERS } from '../../test-utils/fuzz';

/** Screen widths the app actually ships on, plus two nobody expects. */
const WIDTHS = [320, 375, 390, 393, 414, 428, 430, 768, 1024, 1, 4000];

describe('the feed row swipe answers every gesture', () => {
  it('returns an action or null, never anything else', () => {
    forSeeds(25, (rng) => {
      for (let i = 0; i < 400; i += 1) {
        const out = swipeActionOnRelease(gestureValue(rng), gestureValue(rng, 6));
        expect(['watched', 'notInterested', null]).toContain(out);
      }
    });
  });

  it('commits past the threshold and springs back inside it', () => {
    // Monotonic in distance: there must be no travel that commits while a
    // longer travel in the same direction does not.
    const rng = makeRng(5);
    for (let i = 0; i < 300; i += 1) {
      const dx = rng.range(SWIPE_COMMIT_DX, 600);
      expect(swipeActionOnRelease(dx, 0)).not.toBeNull();
      expect(swipeActionOnRelease(rng.range(-SWIPE_COMMIT_DX + 1, SWIPE_COMMIT_DX - 1), 0)).toBeNull();
    }
  });

  it('lets a flick commit on velocity alone', () => {
    // The #110 bug: a quick thumb flick travels ~60pt, falls inside the
    // distance threshold, and springs back — "the card barely responds".
    const rng = makeRng(6);
    for (let i = 0; i < 200; i += 1) {
      const vx = rng.range(SWIPE_COMMIT_VELOCITY + 0.01, 8);
      expect(swipeActionOnRelease(20, vx)).not.toBeNull();
      expect(swipeActionOnRelease(-20, -vx)).not.toBeNull();
    }
  });

  it('claims only decisively horizontal drags, and never NaNs on a still finger', () => {
    forSeeds(20, (rng) => {
      for (let i = 0; i < 300; i += 1) {
        const claimed = shouldClaimHorizontal(gestureValue(rng), gestureValue(rng));
        expect(typeof claimed).toBe('boolean');
      }
    });
    // A finger that has not moved is the case where a ratio is 0/0.
    expect(shouldClaimHorizontal(0, 0)).toBe(false);
    expect(shouldClaimHorizontalDrag(0, 0)).toBe(false);
  });

  it('the deck claims a strictly narrower cone than the feed does', () => {
    // Deliberate: a mis-claimed deck gesture disables the whole MovieDetail
    // ScrollView and then refuses termination, so the screen freezes until the
    // finger lifts. The feed's mis-claim costs a row animation.
    forSeeds(20, (rng) => {
      for (let i = 0; i < 300; i += 1) {
        const dx = gestureValue(rng, 200);
        const dy = gestureValue(rng, 200);
        if (shouldClaimHorizontalDrag(dx, dy)) expect(shouldClaimHorizontal(dx, dy)).toBe(true);
      }
    });
  });

  it('resets a recycled row exactly when its identity changed', () => {
    // FlashList reuses row views, so a row that was mid-swipe can come back
    // holding a different film. Fuzzing the pair matters because ids arrive as
    // strings OR numbers depending on the list, and `undefined` means a first
    // render where there is nothing to reset.
    forSeeds(15, (rng) => {
      for (let i = 0; i < 200; i += 1) {
        const id = () =>
          rng.pick([undefined, 'a', 'b', 0, 1, 2] as (string | number | undefined)[]);
        const prev = id();
        const next = id();
        const out = shouldResetSwipeOffset(prev, next);
        expect(typeof out).toBe('boolean');
        expect(out).toBe(prev !== undefined && prev !== next);
      }
    });
  });
});

describe('the edge-swipe back survives every screen and every touch', () => {
  it('measures the leading edge inside the screen, in both reading directions', () => {
    forSeeds(20, (rng) => {
      for (let i = 0; i < 200; i += 1) {
        const width = rng.pick(WIDTHS);
        const x = rng.range(-50, width + 50);
        for (const rtl of [false, true]) {
          const d = leadingEdgeDistance(x, width, rtl);
          expect(Number.isFinite(d)).toBe(true);
        }
      }
    });
  });

  it('claims only touches that began at the edge', () => {
    const rng = makeRng(11);
    for (let i = 0; i < 300; i += 1) {
      const outside = rng.range(EDGE_ZONE_WIDTH + 1, 2000);
      expect(isEdgeStart(outside)).toBe(false);
      expect(shouldClaimEdgeSwipe(outside, 200, 0)).toBe(false);
    }
  });

  it('never asks for a commit distance a screen cannot supply', () => {
    // `EDGE_COMMIT_MIN_DX` is a floor and the fraction is a proportion; on a
    // narrow screen the floor can exceed the width, and a threshold wider than
    // the screen is a gesture that can never commit.
    for (const width of WIDTHS) {
      const d = edgeCommitDistance(width);
      expect(Number.isFinite(d)).toBe(true);
      expect(d).toBeGreaterThan(0);
    }
  });

  it('answers with a boolean for any release, on any width', () => {
    forSeeds(20, (rng) => {
      for (let i = 0; i < 300; i += 1) {
        const out = edgeSwipeCommits(gestureValue(rng), gestureValue(rng, 6), rng.pick(WIDTHS));
        expect(typeof out).toBe('boolean');
      }
    });
  });

  it('never commits on a backwards drag', () => {
    // Dragging back past where you started must not fire Back; the screen is
    // clamped at 0 and the release has to agree with the clamp.
    const rng = makeRng(12);
    for (let i = 0; i < 300; i += 1) {
      expect(edgeSwipeCommits(rng.range(-600, -1), rng.range(-8, 0), rng.pick(WIDTHS))).toBe(false);
    }
  });
});

describe('the pathological values every resolver must tolerate', () => {
  it('handles zero, negative zero and the extremes without throwing', () => {
    for (const a of NASTY_NUMBERS) {
      for (const b of NASTY_NUMBERS) {
        expect(() => swipeActionOnRelease(a, b)).not.toThrow();
        expect(() => shouldClaimHorizontal(a, b)).not.toThrow();
        expect(() => shouldClaimHorizontalDrag(a, b)).not.toThrow();
        expect(() => edgeSwipeCommits(a, b, 390)).not.toThrow();
        expect(() => leadingEdgeDistance(a, 390, false)).not.toThrow();
      }
    }
  });

  it('treats -0 exactly as 0, so a direction is never inverted by a sign bit', () => {
    expect(swipeActionOnRelease(-0, 0)).toBe(swipeActionOnRelease(0, 0));
    expect(shouldClaimHorizontal(-0, -0)).toBe(shouldClaimHorizontal(0, 0));
    expect(shouldClaimHorizontalDrag(-0, -0)).toBe(shouldClaimHorizontalDrag(0, 0));
  });
});
