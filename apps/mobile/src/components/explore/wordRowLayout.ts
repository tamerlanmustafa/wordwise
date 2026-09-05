/**
 * wordRowLayout — the headword and its speaker, on one line, at any length.
 *
 * The row used to be a fixed 46pt word with `flexShrink: 1`, which meant a long
 * lemma *wrapped*: "electroencephalograph" became two lines, and the speaker —
 * pinned to the first of them — drifted away from the word it belongs to. On a
 * narrow phone even ordinary words wrapped, because the usable width is not the
 * screen: the action rail's lane is subtracted from the end, and the speaker
 * takes a chunk off what is left.
 *
 * So the size is computed instead of hoped for. Two things vary, and both have
 * to be in the same calculation or the card only works on the phone it was
 * designed on:
 *
 *   • the word — 3 letters or 21;
 *   • the screen — the rail's lane grows and shrinks with the viewport.
 *
 * Pure, like `metrics`, and for the same reason: this is a function of the
 * device and the string, so it should be checkable without rendering anything.
 *
 * The floor is a real floor. Past ~18pt a headword stops being a headword, so
 * an absurd string is allowed to overflow the estimate and the component leans
 * on `adjustsFontSizeToFit` for the last few points rather than rendering type
 * nobody can read. `fits` reports which case the caller is in.
 */

import { estimateTextWidth, fitFontSize } from '../../utils/fitText';

/** Card padding on the leading edge. The style reads this, so the layout
 *  maths and the actual padding cannot drift apart. */
export const CARD_PADDING_START = 24;

/** Display size for a word that has room to breathe. */
export const WORD_SIZE_MAX = 46;
/**
 * Smallest size the headword is allowed to reach.
 *
 * Not lower: the word is the entire subject of the card, and below this it
 * stops out-ranking the IPA and gloss underneath it — at which point the card
 * has no focal point at all, which is worse than a word that needs the
 * renderer's own shrink for its last few points.
 */
export const WORD_SIZE_MIN = 18;

/**
 * Tracking, as a fraction of font size (−1.2pt at the 46pt display size).
 *
 * A ratio rather than the flat −1.2 the style used to carry: at 46pt that is
 * imperceptible tightening, and at 20pt it is 6% of the em, which closes the
 * counters and turns a shrunken word into a smudge.
 */
export const WORD_TRACKING_RATIO = -1.2 / WORD_SIZE_MAX;

/**
 * Average advance per character for the headword's face.
 *
 * The card asks for a serif the app never loads, so this is really the
 * platform's bold sans — SF or Roboto — at ~0.55em average for lower case.
 * Erring high is the safe direction: it shrinks the word slightly early rather
 * than letting it run under the action rail.
 */
const WORD_CHAR_RATIO = 0.55;

/** Below this width, a phone is narrow enough to trim the fixed chrome. */
const COMPACT_WIDTH = 360;

/**
 * The speaker's tap target.
 *
 * A chip, not a bare glyph. The whole card is the reveal control, so every
 * pixel the speaker does not claim is a pixel where "play this word" silently
 * becomes "show me the translation" — the two most confusable actions on the
 * screen. 44 is the platform minimum on both stores; the compact size stays
 * above 40 rather than scaling with the screen, because a thumb does not get
 * smaller on a smaller phone.
 */
export const SPEAKER_CHIP = 44;
export const SPEAKER_CHIP_COMPACT = 40;
/** Space between the word and the chip. */
export const SPEAKER_GAP = 12;

export interface WordRowInput {
  word: string;
  /** Full screen width. */
  width: number;
  /** The action rail's lane — the card's end padding (see `metrics`). */
  lane: number;
  /** False when the speaker is hidden (free tier), which gives the word the
   *  chip's width back rather than leaving a gap where it would have been. */
  hasSpeaker?: boolean;
}

export interface WordRowLayout {
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  chipSize: number;
  /** Width the headword may occupy. Set as `maxWidth` so the renderer's own
   *  shrink has a bound to work against — without one it does nothing. */
  available: number;
  /** True when the computed size fits the estimate. False means the string is
   *  pathological and the backstop is doing the last of the work. */
  fits: boolean;
}

export function wordRowLayout({
  word,
  width,
  lane,
  hasSpeaker = true,
}: WordRowInput): WordRowLayout {
  const compact = width < COMPACT_WIDTH;
  const chipSize = compact ? SPEAKER_CHIP_COMPACT : SPEAKER_CHIP;

  const available = Math.max(
    1,
    width - CARD_PADDING_START - lane - (hasSpeaker ? chipSize + SPEAKER_GAP : 0),
  );

  const fontSize = fitFontSize({
    text: word,
    maxWidth: available,
    max: WORD_SIZE_MAX,
    min: WORD_SIZE_MIN,
    charRatio: WORD_CHAR_RATIO,
    trackingRatio: WORD_TRACKING_RATIO,
  });

  return {
    fontSize,
    // The same 1.05 the fixed size used, kept proportional so a shrunken word
    // does not sit in a box sized for a bigger one.
    lineHeight: Math.round(fontSize * 1.05),
    letterSpacing: fontSize * WORD_TRACKING_RATIO,
    chipSize,
    available,
    fits:
      estimateTextWidth(word, fontSize, {
        charRatio: WORD_CHAR_RATIO,
        trackingRatio: WORD_TRACKING_RATIO,
      }) <= available,
  };
}
