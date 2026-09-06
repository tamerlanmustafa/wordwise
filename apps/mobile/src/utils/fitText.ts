/**
 * fitText — pick a font size that makes one line of text fit a known width.
 *
 * Two places need this and neither can measure real text. The share card draws
 * into SVG, which has no wrapping and no metrics before rasterising. The
 * Explore word card *could* measure, but only by rendering once and shrinking
 * on the next frame — a visible reflow on a snap pager where the word is the
 * first thing the eye lands on.
 *
 * So the size is computed from the string up front, from an estimate that is
 * deliberately *pessimistic*: overshooting the width is unrecoverable (text
 * clipped, ellipsised, or walked off a canvas into a PNG someone posts),
 * while undershooting only leaves a word slightly smaller than it had to be.
 * Round the estimate up, never down.
 */

/**
 * Average advance width per character as a fraction of font size.
 *
 * 0.5 is a mild over-estimate for a serif at display sizes — Georgia's average
 * is nearer 0.46 — which is the direction we want to be wrong in.
 */
export const DEFAULT_CHAR_RATIO = 0.5;

export interface FitOptions {
  /** Average character advance as a fraction of font size. */
  charRatio?: number;
  /**
   * Tracking as a fraction of font size, applied per character. Negative
   * tightens. Expressed as a ratio rather than points so a shrinking headline
   * keeps the same optical tracking instead of collapsing into itself.
   */
  trackingRatio?: number;
}

/** Effective per-character advance, tracking included. */
function advanceRatio({ charRatio = DEFAULT_CHAR_RATIO, trackingRatio = 0 }: FitOptions): number {
  // A tracking value that cancels the advance entirely would divide by zero
  // below and report that anything fits at any size.
  return Math.max(0.05, charRatio + trackingRatio);
}

/** Estimated width of `text` rendered on one line at `fontSize`. */
export function estimateTextWidth(text: string, fontSize: number, opts: FitOptions = {}): number {
  return text.length * fontSize * advanceRatio(opts);
}

export interface FitFontSizeInput extends FitOptions {
  text: string;
  /** Width the line has to fit inside. */
  maxWidth: number;
  /** Size to use when the text is comfortably short. */
  max: number;
  /** Never shrink past this, however long the text. */
  min: number;
}

/**
 * The largest size in `[min, max]` at which `text` fits `maxWidth` on one line.
 *
 * Returns `max` for empty text — a missing word is not a reason to render the
 * next one at the floor.
 *
 * The floor is a real floor: a long enough string still overflows at `min`,
 * because past some point shrinking further stops being legible and the caller
 * is better off with a backstop (`adjustsFontSizeToFit`, or a wrap) than with
 * 6pt type. Callers that cannot tolerate any overflow should check with
 * `estimateTextWidth`.
 *
 * **If you reach for that backstop, do not also set `lineHeight` on the same
 * Text.** UIKit turns `lineHeight` into a fixed paragraph line box and then
 * looks for a font scale that fits the width; the two constraints fight,
 * `minimumFontScale` stops being honoured, and the text shrinks toward
 * nothing. It compounds across re-renders, so it shows up as an occasional
 * headword rendered as a dot rather than as anything reproducible. The whole
 * point of computing a size here is that the deterministic path needs no
 * backstop at all — turn it on only where the computation admits it did not
 * fit, and drop `lineHeight` for that case.
 */
export function fitFontSize({ text, maxWidth, max, min, ...opts }: FitFontSizeInput): number {
  if (!text || maxWidth <= 0) return max;
  const ideal = maxWidth / (text.length * advanceRatio(opts));
  return Math.max(min, Math.min(max, Math.floor(ideal)));
}
