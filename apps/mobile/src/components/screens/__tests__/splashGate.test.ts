import {
  doorGeometry,
  isSplashUp,
  DOOR_OPEN_MS,
  SEAM_OVERLAP,
  SENTENCE_WARMUP_MAX_MS,
  SPLASH_HOLD_MS,
  SPLASH_MIN_MS,
  type SplashGate,
} from '../splashGate';

const ready: SplashGate = { loading: false, sentencesWarm: true, floorElapsed: true };

describe('isSplashUp', () => {
  it('lifts only when every hold has cleared', () => {
    expect(isSplashUp(ready)).toBe(false);
  });

  it('holds while the vocabulary request is out', () => {
    expect(isSplashUp({ ...ready, loading: true })).toBe(true);
  });

  it("holds while the first card's sentence is still coming", () => {
    expect(isSplashUp({ ...ready, sentencesWarm: false })).toBe(true);
  });

  // The one this change exists for: a cache hit clears both work holds almost
  // immediately, and without the floor the wordmark appears and vanishes.
  it('holds on the floor alone when the work finished early', () => {
    expect(isSplashUp({ loading: false, sentencesWarm: true, floorElapsed: false })).toBe(true);
  });

  it('needs no hold cleared in any particular order', () => {
    const holds = ['loading', 'sentencesWarm', 'floorElapsed'] as const;
    // Every state with exactly one hold outstanding still shows the splash.
    holds.forEach((hold) => {
      const gate: SplashGate =
        hold === 'loading'
          ? { ...ready, loading: true }
          : { ...ready, [hold]: false };
      expect(isSplashUp(gate)).toBe(true);
    });
  });
});

describe('splash timings', () => {
  // The doors are the END of the minimum second, not an extra slice bolted on
  // after it. Retuning either half must not quietly stretch the whole thing.
  it('spends the whole minimum on hold plus doors, and no more', () => {
    expect(SPLASH_HOLD_MS + DOOR_OPEN_MS).toBe(SPLASH_MIN_MS);
  });

  it('leaves the wordmark still for longer than it spends parting', () => {
    expect(SPLASH_HOLD_MS).toBeGreaterThan(DOOR_OPEN_MS);
  });

  // The floor runs concurrently with the work, so it must be comfortably
  // shorter than the sentence deadline — otherwise it would be the thing
  // setting splash length on a slow load, not the safety net it is.
  it('keeps the floor well inside the sentence deadline', () => {
    expect(SPLASH_MIN_MS).toBeLessThan(SENTENCE_WARMUP_MAX_MS);
  });

  it('is long enough to read as an animation rather than a flash', () => {
    expect(SPLASH_MIN_MS).toBeGreaterThanOrEqual(1000);
  });

  it('gives the doors long enough to read as a reveal', () => {
    expect(DOOR_OPEN_MS).toBeGreaterThanOrEqual(250);
  });
});

// The doors are a purely visual change, and the one part of it that can be
// checked without eyes is the arithmetic: if these hold, the two halves of the
// wordmark cannot be misaligned, the seam cannot show a hairline of the screen
// underneath, and neither door can stop short and leave a strip on screen.
// Widths cover a small phone, a large phone, a tablet, and odd values that
// force the rounding this exists to handle.
describe('doorGeometry', () => {
  const WIDTHS = [320, 375, 390, 393, 402, 411, 428, 430, 744, 1024, 1133];

  it.each(WIDTHS)('lands both faces at screen x=0 (width %i)', (w) => {
    const { left, right } = doorGeometry(w);
    // A face's absolute position is its door's left plus its own offset. Both
    // must be 0, or the "WW" is drawn in two different places and the split
    // shows a jump the instant the doors move.
    expect(left.left + left.faceLeft).toBe(0);
    expect(right.left + right.faceLeft).toBe(0);
  });

  it.each(WIDTHS)('covers the screen with no gap at the seam (width %i)', (w) => {
    const { left, right } = doorGeometry(w);
    expect(left.left).toBe(0);
    expect(right.left + right.width).toBe(w);
    // The left door reaches at least the right door's edge — strictly past it,
    // by the overlap, so rounding can never open a hairline.
    expect(left.left + left.width).toBeGreaterThanOrEqual(right.left);
    expect(left.left + left.width - right.left).toBe(SEAM_OVERLAP);
  });

  it.each(WIDTHS)('travels far enough to clear the screen (width %i)', (w) => {
    const { left, right } = doorGeometry(w);
    // Left door's trailing edge ends at or before x=0.
    expect(left.left + left.width + left.travel).toBeLessThanOrEqual(0);
    // Right door's leading edge ends at or past the screen's right edge.
    expect(right.left + right.travel).toBeGreaterThanOrEqual(w);
  });

  it('splits down the middle so the seam falls between the two Ws', () => {
    const { right } = doorGeometry(402);
    expect(right.left).toBe(201);
  });

  it('gives the odd point to the door that can absorb it', () => {
    // 393 → seam 197 (rounded up), so the right door is the narrower one and
    // the left keeps the extra point plus the overlap. Either way they tile.
    const { left, right } = doorGeometry(393);
    expect(left.width + right.width).toBe(393 + SEAM_OVERLAP);
  });
});
