/**
 * splashGate — the timing rules behind MovieDetail's pulsing "WW" wordmark.
 *
 * Pure and separate from the screen because the splash now answers to three
 * independent holds, and "which of them is still up?" is the kind of question
 * that quietly gains a fourth clause and stops being obvious.
 */

/**
 * Longest the splash will wait on the first card's example sentence after the
 * vocabulary itself has arrived. Typical batches land in ~200ms; the cap is
 * for the one that misses SentenceBank and falls through to LLM generation.
 */
export const SENTENCE_WARMUP_MAX_MS = 2500;

/**
 * Shortest the splash will ever be on screen, measured from mount.
 *
 * A returning visit hits the offline cache and can be ready in well under
 * 100ms, which turned the wordmark into a flash — worse than no splash at all,
 * because a thing that appears and vanishes reads as a glitch rather than as
 * loading. The floor runs concurrently with the real work, so it costs nothing
 * on a cold open and only shows up on the fast paths it exists for.
 */
export const SPLASH_MIN_MS = 1000;

export interface SplashGate {
  /** The vocabulary request is still out. */
  loading: boolean;
  /** The first card's example sentence has arrived (or its deadline passed). */
  sentencesWarm: boolean;
  /** SPLASH_MIN_MS has elapsed since the screen mounted. */
  floorElapsed: boolean;
}

/**
 * Is the splash still up? Every hold must clear — they are independent, and
 * the two that can finish early (`loading`, `sentencesWarm`) say nothing about
 * the floor. Total splash time is therefore
 * `max(SPLASH_MIN_MS, vocabulary fetch + sentence batch)`, itself bounded by
 * the sentence deadline.
 */
export function isSplashUp({ loading, sentencesWarm, floorElapsed }: SplashGate): boolean {
  return loading || !sentencesWarm || !floorElapsed;
}
