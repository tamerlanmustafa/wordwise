import fs from 'fs';
import path from 'path';
/**
 * Share-card layout.
 *
 * SVG does not wrap text: a line that is too long runs off the canvas with no
 * error and no clipping. The result is a perfectly valid PNG with a sentence
 * walking off the right edge, which the user then posts to their story. That
 * is the failure this file exists to prevent, and it is why the wrapper errs
 * toward breaking early rather than late.
 */

import {
  CONTENT_W,
  SENTENCE_MAX_LINES,
  WORD_SIZE_MAX,
  WORD_SIZE_MIN,
  estimateWidth,
  shareFileName,
  wordFontSize,
  wrapText,
} from '../shareCardLayout';

describe('wordFontSize', () => {
  it('gives a short word the full display size', () => {
    expect(wordFontSize('run')).toBe(WORD_SIZE_MAX);
  });

  it('shrinks a long word rather than wrapping it', () => {
    // A hyphen-less mid-word break is the one thing that makes a type-led card
    // look broken, so long words get smaller instead.
    expect(wordFontSize('electroencephalograph')).toBeLessThan(WORD_SIZE_MAX);
  });

  it('never shrinks past the floor, however absurd the word', () => {
    expect(wordFontSize('a'.repeat(200))).toBe(WORD_SIZE_MIN);
  });

  it('keeps the catalogue’s longest real word on one line', () => {
    const word = 'electroencephalograph'; // 21 chars, the longest in prod
    expect(estimateWidth(word, wordFontSize(word))).toBeLessThanOrEqual(CONTENT_W);
  });

  it('handles an empty word without returning NaN', () => {
    expect(wordFontSize('')).toBe(WORD_SIZE_MAX);
  });
});

describe('wrapText', () => {
  it('keeps every line inside the content width', () => {
    const sentence =
      'She had to run for the last train home before the station closed for the night.';
    for (const line of wrapText(sentence, 40)) {
      expect(estimateWidth(line, 40)).toBeLessThanOrEqual(CONTENT_W);
    }
  });

  it('loses no words when the text fits', () => {
    const sentence = 'A short example sentence.';
    expect(wrapText(sentence, 40).join(' ')).toBe(sentence);
  });

  it('caps at the line limit', () => {
    const long = Array.from({ length: 120 }, () => 'word').join(' ');
    expect(wrapText(long, 40).length).toBeLessThanOrEqual(SENTENCE_MAX_LINES);
  });

  it('marks a truncated sentence with an ellipsis', () => {
    // Silently cutting mid-sentence reads as broken data rather than a card
    // that chose to stop.
    const long = Array.from({ length: 120 }, () => 'word').join(' ');
    expect(wrapText(long, 40).at(-1)).toMatch(/…$/);
  });

  it('does not add an ellipsis when nothing was dropped', () => {
    expect(wrapText('Short enough.', 40).at(-1)).not.toMatch(/…$/);
  });

  it('returns nothing for empty or blank input', () => {
    expect(wrapText('', 40)).toEqual([]);
    expect(wrapText('   ', 40)).toEqual([]);
  });

  it('leaves an over-long single word alone rather than splitting it', () => {
    // Overflowing slightly is recoverable by the caller shrinking the size; a
    // mid-word break is not, it just looks like a bug.
    expect(wrapText('supercalifragilisticexpialidocious', 40)).toEqual([
      'supercalifragilisticexpialidocious',
    ]);
  });

  it('collapses runs of whitespace instead of emitting empty lines', () => {
    expect(wrapText('one   two\n\nthree', 40)).toEqual(['one two three']);
  });
});

describe('shareFileName', () => {
  it('slugs the word into the filename', () => {
    expect(shareFileName('run')).toBe('wordwise-run.png');
  });

  it('strips anything a filesystem might object to', () => {
    // Lemmas have carried punctuation and spaces; a slash would silently
    // create a directory that does not exist and the write would fail.
    expect(shareFileName("don't stop/now")).toBe('wordwise-don-t-stop-now.png');
  });

  it('handles non-latin words without producing an empty name', () => {
    expect(shareFileName('привет')).toBe('wordwise-word.png');
  });

  it('bounds the length', () => {
    expect(shareFileName('a'.repeat(300)).length).toBeLessThan(60);
  });
});

describe('the headword cannot collapse to a dot', () => {
  const card = () =>
    fs.readFileSync(path.join(__dirname, '..', 'WordCard.tsx'), 'utf8');

  it('never asks the renderer to shrink a Text that also has a lineHeight', () => {
    // The reported bug: a headword rendered as a dot, sometimes, after a
    // second tap. UIKit turns `lineHeight` into a fixed paragraph line box and
    // then hunts for a font scale that fits the width; the two constraints
    // fight, `minimumFontScale` stops being honoured, and the font walks
    // toward zero. A tap re-renders the card and re-measures the reveal block,
    // so the fit runs again from the size it had already shrunk to — which is
    // why it compounds, and why it was not reproducible on demand.
    const s = card();
    expect(s).toMatch(/adjustsFontSizeToFit=\{!wordRow\.fits\}/);
    expect(s).toMatch(/wordRow\.fits \? \{ lineHeight: wordRow\.lineHeight \} : null/);
  });

  it('does not leave lineHeight in the always-applied style block', () => {
    // If it moved back into `s.word` the two would be paired again for every
    // word, and the exclusivity above would be decorative.
    //
    // Comments stripped first: this is looking for a *property*, and the block
    // carries a note that names the ones supplied per render. Scanning the
    // prose as if it were code is how a guard fails on a file that is right —
    // which is exactly what the first draft of this did.
    const s = card();
    const start = s.indexOf('    word: {');
    const block = s.slice(start, s.indexOf('\n    },', start));
    const code = block.replace(/\/\/[^\n]*/g, '');
    expect(code).not.toMatch(/lineHeight/);
  });

  it('keeps the width bound on both paths', () => {
    // It bounds the deterministic path — a word that beats the estimator
    // ellipsises rather than running under the action rail — and it is the
    // only thing the backstop has to shrink against on the other.
    expect(card()).toMatch(/maxWidth: wordRow\.available/);
  });
});
