/**
 * shareCardLayout — the maths behind the shareable word card.
 *
 * Pure, because SVG has no text wrapping. An `<Text>` in react-native-svg is
 * one line at whatever length you give it: too long and it runs off the canvas
 * with no error and no clipping, which on a card destined for someone's story
 * is a silently ruined image. So the wrapping is done here, in a function a
 * test can check, rather than hoped for at render time.
 *
 * Everything is in canvas units. The card renders at a fixed pixel size and is
 * never laid out by flexbox, so there is no device scaling to reason about —
 * the numbers below *are* the output image.
 *
 * The one-line fitting itself is shared with the Explore word card, which has
 * the same problem for a different reason — see utils/fitText.
 */
import { DEFAULT_CHAR_RATIO, estimateTextWidth, fitFontSize } from '../../utils/fitText';

/**
 * 4:5 portrait at 1080 wide.
 *
 * Not 9:16. A story-shaped card is letterboxed with grey bars when someone
 * posts it to a feed, whereas 4:5 is the tallest a feed accepts *and* sits
 * comfortably inside a story with room for the caption sticker above and the
 * reply bar below. One asset that works in both beats two that each work in
 * one.
 */
export const CARD_W = 1080;
export const CARD_H = 1350;

export const PADDING = 96;
/** Usable width for any wrapped line. */
export const CONTENT_W = CARD_W - PADDING * 2;

export const WORD_SIZE_MAX = 132;
export const WORD_SIZE_MIN = 64;
export const SENTENCE_SIZE = 40;
export const SENTENCE_LINE_H = 58;
/** Sentences longer than this are cut — a story card is a hook, not a page. */
export const SENTENCE_MAX_LINES = 4;

/**
 * Rough advance width per character, as a fraction of font size.
 *
 * A real measurement needs the font metrics, which are not reachable from JS
 * before the SVG is rasterised. 0.5 is a deliberate over-estimate for a serif
 * at these sizes (Georgia's average is nearer 0.46), so the wrapper breaks
 * slightly early. Erring long would push a line off the canvas edge, which is
 * unrecoverable in a shared image; erring short only leaves a little more
 * margin than intended.
 */
const AVG_CHAR_RATIO = DEFAULT_CHAR_RATIO;

export function estimateWidth(text: string, fontSize: number): number {
  return estimateTextWidth(text, fontSize, { charRatio: AVG_CHAR_RATIO });
}

/**
 * The largest size at which `word` fits one line, down to a floor.
 *
 * Long words shrink rather than wrap: a hyphen-less break mid-word is the one
 * thing that makes a type-led card look broken, and at 64px even a 20-letter
 * lemma still reads as the card's subject.
 */
export function wordFontSize(word: string): number {
  return fitFontSize({
    text: word,
    maxWidth: CONTENT_W,
    max: WORD_SIZE_MAX,
    min: WORD_SIZE_MIN,
    charRatio: AVG_CHAR_RATIO,
  });
}

/**
 * Greedy word wrap to `maxWidth`, capped at `maxLines` with an ellipsis.
 *
 * Greedy rather than balanced: the alternative (Knuth-Plass style) produces
 * prettier ragged edges and needs the real metrics this cannot have, so the
 * simple algorithm is the honest one here.
 *
 * A single word longer than the line is left alone rather than hard-split —
 * see `wordFontSize`. It overflows a little; a mid-word break looks like a bug.
 */
export function wrapText(
  text: string,
  fontSize: number,
  maxWidth: number = CONTENT_W,
  maxLines: number = SENTENCE_MAX_LINES,
): string[] {
  const words = (text ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (line && estimateWidth(candidate, fontSize) > maxWidth) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else {
      line = candidate;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);

  if (lines.length === maxLines) {
    // Something was dropped only if we broke out early or the tail is unused.
    const used = lines.join(' ').split(/\s+/).length;
    if (used < words.length) {
      const last = lines[maxLines - 1];
      lines[maxLines - 1] = `${last.replace(/[.,;:]$/, '')}…`;
    }
  }
  return lines;
}

/** A filename that is safe on both platforms and identifies the word. */
export function shareFileName(word: string): string {
  const slug = (word ?? 'word')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `wordwise-${slug || 'word'}.png`;
}
