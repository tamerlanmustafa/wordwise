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
 * Shortest the splash will ever be on screen, measured from mount to the
 * instant the movie screen is fully uncovered.
 *
 * A returning visit hits the offline cache and can be ready in well under
 * 100ms, which turned the wordmark into a flash — worse than no splash at all,
 * because a thing that appears and vanishes reads as a glitch rather than as
 * loading. The floor runs concurrently with the real work, so it costs nothing
 * on a cold open and only shows up on the fast paths it exists for.
 */
export const SPLASH_MIN_MS = 1000;

/** The sliding-doors reveal: the two halves parting to uncover the screen. */
export const DOOR_OPEN_MS = 420;

/**
 * How long the wordmark holds still before the doors start parting.
 *
 * The doors are the END of the minimum second, not an extra 420ms bolted onto
 * it — so this is the remainder, and the two together are SPLASH_MIN_MS
 * exactly. Deriving it rather than writing 580 is what keeps that true when
 * either number is retuned.
 */
export const SPLASH_HOLD_MS = SPLASH_MIN_MS - DOOR_OPEN_MS;

export interface SplashGate {
  /** The vocabulary request is still out. */
  loading: boolean;
  /** The first card's example sentence has arrived (or its deadline passed). */
  sentencesWarm: boolean;
  /** SPLASH_HOLD_MS has elapsed since the screen mounted. */
  floorElapsed: boolean;
}

/**
 * Should the splash still be holding — i.e. covering the screen, not yet
 * parting? Every hold must clear; they are independent, and the two that can
 * finish early (`loading`, `sentencesWarm`) say nothing about the floor.
 *
 * False starts the doors, so total time from mount to a fully uncovered screen
 * is `max(SPLASH_MIN_MS, vocabulary fetch + sentence batch + DOOR_OPEN_MS)`,
 * with the fetch half of that bounded by SENTENCE_WARMUP_MAX_MS.
 */
export function isSplashUp({ loading, sentencesWarm, floorElapsed }: SplashGate): boolean {
  return loading || !sentencesWarm || !floorElapsed;
}

// ── Sliding doors ─────────────────────────────────────────────────────────

/**
 * Overlap on the left door, in points. Half of an odd screen width rounds, and
 * a sub-point gap at the seam would show a hairline of the screen underneath
 * before the doors have moved. Both doors paint identical pixels in the
 * overlap, so widening one is invisible until they part — at which point it is
 * gone.
 */
export const SEAM_OVERLAP = 1;

export interface DoorHalf {
  /** Door's own left edge, in screen points. */
  left: number;
  /** Door's width; it clips everything outside. */
  width: number;
  /** Offset of the full-screen face INSIDE the door. */
  faceLeft: number;
  /** translateX at the end of the slide — enough to clear the screen. */
  travel: number;
}

export interface DoorGeometry {
  left: DoorHalf;
  right: DoorHalf;
}

/**
 * Where the two doors sit and how far each travels.
 *
 * The load-bearing idea: each door renders the SAME full-screen face and clips
 * it, rather than each drawing "its" half of the wordmark. So the only thing
 * that can misalign the two halves of the "WW" is this arithmetic — the face's
 * absolute position is `left + faceLeft`, and it must be 0 for both doors, at
 * every screen width. That is what the tests pin down, because it is the one
 * part of a purely visual change that can be checked without eyes.
 */
export function doorGeometry(screenWidth: number): DoorGeometry {
  const seam = Math.round(screenWidth / 2);
  return {
    left: {
      left: 0,
      width: seam + SEAM_OVERLAP,
      faceLeft: 0,
      travel: -(seam + SEAM_OVERLAP),
    },
    right: {
      left: seam,
      width: screenWidth - seam,
      faceLeft: -seam,
      travel: screenWidth - seam,
    },
  };
}
