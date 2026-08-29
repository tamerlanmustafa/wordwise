import {
  isSplashUp,
  SENTENCE_WARMUP_MAX_MS,
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
  // The floor runs concurrently with the work, so it must be comfortably
  // shorter than the sentence deadline — otherwise it would be the thing
  // setting splash length on a slow load, not the safety net it is.
  it('keeps the floor well inside the sentence deadline', () => {
    expect(SPLASH_MIN_MS).toBeLessThan(SENTENCE_WARMUP_MAX_MS);
  });

  it('is long enough to read as an animation rather than a flash', () => {
    expect(SPLASH_MIN_MS).toBeGreaterThanOrEqual(1000);
  });
});
