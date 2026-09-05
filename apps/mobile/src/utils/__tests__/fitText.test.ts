/**
 * Sizing one line of text to a width, without being able to measure it.
 *
 * Two callers, both blind for different reasons: the share card draws into
 * SVG, which has no metrics before it rasterises, and the Explore word card
 * could measure but only by rendering once and shrinking on the next frame —
 * a visible reflow on the word the eye lands on first.
 *
 * The rule the estimate has to obey is that it errs *long*. Overshooting the
 * width is unrecoverable (clipped text, or a word walking off a canvas into a
 * PNG someone posts); undershooting only leaves a word a point smaller than it
 * had to be. Every test here is really checking that direction.
 */

import { DEFAULT_CHAR_RATIO, estimateTextWidth, fitFontSize } from '../fitText';

describe('estimateTextWidth', () => {
  it('scales with both length and size', () => {
    expect(estimateTextWidth('abcd', 10)).toBe(4 * 10 * DEFAULT_CHAR_RATIO);
    expect(estimateTextWidth('ab', 20)).toBe(estimateTextWidth('abcd', 10));
  });

  it('counts negative tracking as narrower', () => {
    const plain = estimateTextWidth('abcdef', 20);
    const tight = estimateTextWidth('abcdef', 20, { trackingRatio: -0.05 });

    expect(tight).toBeLessThan(plain);
  });

  it('is zero for empty text', () => {
    expect(estimateTextWidth('', 40)).toBe(0);
  });
});

describe('fitFontSize', () => {
  it('gives short text the maximum', () => {
    expect(fitFontSize({ text: 'run', maxWidth: 400, max: 46, min: 18 })).toBe(46);
  });

  it('shrinks text to something that actually fits, given room to', () => {
    const text = 'a'.repeat(30);
    const size = fitFontSize({ text, maxWidth: 200, max: 46, min: 4 });

    expect(size).toBeLessThan(46);
    expect(estimateTextWidth(text, size)).toBeLessThanOrEqual(200);
  });

  it('lets the floor win over fitting, when the two disagree', () => {
    // Documented and deliberate: past some size the text is unreadable anyway,
    // so the floor holds and the caller deals with the overflow (a backstop
    // shrink, or a wrap). Callers that cannot tolerate it check the width
    // themselves — which is why `estimateTextWidth` is exported.
    const text = 'a'.repeat(30);
    const size = fitFontSize({ text, maxWidth: 200, max: 46, min: 18 });

    expect(size).toBe(18);
    expect(estimateTextWidth(text, size)).toBeGreaterThan(200);
  });

  it('rounds down, never up', () => {
    // Rounding up is how an estimate that "just fits" becomes a line that
    // just doesn't.
    const text = 'abcdefg';
    const size = fitFontSize({ text, maxWidth: 101, max: 100, min: 1 });

    expect(estimateTextWidth(text, size)).toBeLessThanOrEqual(101);
  });

  it('stops at the floor rather than shrinking without limit', () => {
    expect(fitFontSize({ text: 'a'.repeat(500), maxWidth: 200, max: 46, min: 18 })).toBe(18);
  });

  it('returns the maximum for empty text', () => {
    // A missing string is a data problem; rendering the next one at the floor
    // because of it would spread the fault across the screen.
    expect(fitFontSize({ text: '', maxWidth: 10, max: 46, min: 18 })).toBe(46);
  });

  it('returns the maximum rather than dividing by a width of zero', () => {
    // A card can render one frame before layout reports a width.
    expect(fitFontSize({ text: 'run', maxWidth: 0, max: 46, min: 18 })).toBe(46);
    expect(fitFontSize({ text: 'run', maxWidth: -20, max: 46, min: 18 })).toBe(46);
  });

  it('returns a real number when tracking cancels the advance', () => {
    // Nonsense input — tracking equal and opposite to the char ratio — makes
    // the per-character advance zero, and the unguarded division returns
    // Infinity. A size of Infinity does not throw; it lays out as a blank
    // card, which is the worst way for bad input to surface.
    const size = fitFontSize({
      text: 'a'.repeat(40),
      maxWidth: 100,
      max: 46,
      min: 4,
      charRatio: 0.5,
      trackingRatio: -0.5,
    });

    expect(Number.isFinite(size)).toBe(true);
    expect(size).toBeGreaterThanOrEqual(4);
    expect(size).toBeLessThanOrEqual(46);
  });

  it('shrinks for tracking that merely tightens', () => {
    // The ordinary case the ratio exists for: tighter tracking fits more
    // characters, so the same string can be set larger.
    const loose = fitFontSize({ text: 'abcdefghij', maxWidth: 100, max: 46, min: 4 });
    const tight = fitFontSize({
      text: 'abcdefghij',
      maxWidth: 100,
      max: 46,
      min: 4,
      trackingRatio: -0.1,
    });

    expect(tight).toBeGreaterThan(loose);
  });
});
