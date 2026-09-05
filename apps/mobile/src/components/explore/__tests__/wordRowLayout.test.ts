/**
 * The headword and its speaker, on one line, at any length and any width.
 *
 * The card is one word on a full screen, so the word is the whole design. It
 * used to render at a fixed 46pt with `flexShrink`, which meant a long lemma
 * wrapped onto a second line and the speaker — pinned to the first — floated
 * away from the word it belongs to. On a narrow phone even ordinary words did
 * it, because the usable width is not the screen: the action rail's lane is
 * subtracted from the end and the speaker takes a bite out of what remains.
 *
 * Two variables, and both have to be in the same calculation or the card only
 * works on the phone it was designed on: how long the word is, and how wide
 * the device is. These tests fix a handful of real devices and real lemmas so
 * a change to either can't quietly break the other.
 */

import { exploreMetrics } from '../metrics';
import {
  CARD_PADDING_START,
  SPEAKER_CHIP,
  SPEAKER_CHIP_COMPACT,
  SPEAKER_GAP,
  WORD_SIZE_MAX,
  WORD_SIZE_MIN,
  wordRowLayout,
} from '../wordRowLayout';

/** Lane for a given screen width, straight from the feed's own geometry —
 *  so these numbers move if the rail does. */
const laneFor = (width: number, viewport = 760) =>
  exploreMetrics({ viewport, width, topInset: 47, bottomOffset: 90 }).railLane;

/** The devices that actually matter: a small phone, a standard one, a big one. */
const DEVICES = [
  { name: 'iPhone SE', width: 375 },
  { name: 'iPhone 15', width: 393 },
  { name: 'Pixel 8 Pro', width: 448 },
];

/** The longest word in the production catalogue, per shareCardLayout's tests. */
const LONGEST = 'electroencephalograph'; // 21 characters

describe('a short word gets the display size', () => {
  it.each(DEVICES)('$name', ({ width }) => {
    expect(wordRowLayout({ word: 'run', width, lane: laneFor(width) }).fontSize).toBe(
      WORD_SIZE_MAX,
    );
  });

  it('does not shrink an empty word to the floor', () => {
    // A feed item with no word is a data problem, not a reason to render the
    // next card's headword at 18pt.
    expect(wordRowLayout({ word: '', width: 393, lane: 75 }).fontSize).toBe(WORD_SIZE_MAX);
  });
});

describe('a long word shrinks instead of wrapping', () => {
  it.each(DEVICES)('$name fits the catalogue’s longest word', ({ width }) => {
    const row = wordRowLayout({ word: LONGEST, width, lane: laneFor(width) });

    expect(row.fontSize).toBeLessThan(WORD_SIZE_MAX);
    expect(row.fits).toBe(true);
  });

  it('shrinks monotonically as the word grows', () => {
    const size = (word: string) => wordRowLayout({ word, width: 393, lane: 75 }).fontSize;

    expect(size('run')).toBeGreaterThanOrEqual(size('running'));
    expect(size('running')).toBeGreaterThanOrEqual(size('serendipitous'));
    expect(size('serendipitous')).toBeGreaterThanOrEqual(size(LONGEST));
  });

  it('never goes below the floor, however absurd the string', () => {
    // Past ~18pt the headword stops out-ranking the gloss beneath it and the
    // card has no focal point at all — worse than leaning on the renderer's
    // own shrink for the last few points.
    const row = wordRowLayout({ word: 'a'.repeat(200), width: 393, lane: 75 });

    expect(row.fontSize).toBe(WORD_SIZE_MIN);
    expect(row.fits).toBe(false); // and says so, rather than pretending
  });
});

describe('the narrower the phone, the smaller the word', () => {
  it('gives a long word less room on a small screen than a large one', () => {
    const small = wordRowLayout({ word: LONGEST, width: 375, lane: laneFor(375) });
    const large = wordRowLayout({ word: LONGEST, width: 448, lane: laneFor(448) });

    expect(small.fontSize).toBeLessThan(large.fontSize);
  });

  it('subtracts the card padding, the rail lane and the chip from the width', () => {
    // The available width is the *card's* width minus everything already spoken
    // for. Getting this wrong is how a word ends up under the action rail.
    const width = 393;
    const lane = laneFor(width);

    const row = wordRowLayout({ word: 'run', width, lane });

    expect(row.available).toBe(width - CARD_PADDING_START - lane - SPEAKER_CHIP - SPEAKER_GAP);
  });

  it('gives the chip’s width back when there is no speaker', () => {
    // Free tier: no speaker, so the word should use the space rather than
    // leaving a gap where the chip would have been.
    const withSpeaker = wordRowLayout({ word: 'run', width: 393, lane: 75 });
    const without = wordRowLayout({ word: 'run', width: 393, lane: 75, hasSpeaker: false });

    expect(without.available).toBe(withSpeaker.available + SPEAKER_CHIP + SPEAKER_GAP);
  });

  it('never returns a negative width, however greedy the lane', () => {
    // A lane wider than the screen is nonsense, but it should degrade to a
    // tiny positive width rather than an inverted layout.
    expect(wordRowLayout({ word: 'run', width: 320, lane: 400 }).available).toBeGreaterThan(0);
  });
});

describe('the speaker chip', () => {
  it('is a full-size tap target on an ordinary phone', () => {
    expect(wordRowLayout({ word: 'run', width: 393, lane: 75 }).chipSize).toBe(SPEAKER_CHIP);
  });

  it('trims only slightly on a narrow phone', () => {
    // A thumb does not get smaller on a smaller phone, so this shrinks by 4pt
    // and stops — it is not scaled with the screen like the chrome around it.
    const chip = wordRowLayout({ word: 'run', width: 320, lane: 66 }).chipSize;

    expect(chip).toBe(SPEAKER_CHIP_COMPACT);
    expect(chip).toBeGreaterThanOrEqual(40);
  });
});

describe('the type stays proportional as it shrinks', () => {
  it('scales the leading with the size', () => {
    const big = wordRowLayout({ word: 'run', width: 393, lane: 75 });
    const small = wordRowLayout({ word: LONGEST, width: 393, lane: 75 });

    expect(big.lineHeight / big.fontSize).toBeCloseTo(small.lineHeight / small.fontSize, 1);
  });

  it('scales the tracking with the size', () => {
    // The style used to carry a flat −1.2pt. Imperceptible at 46pt and 6% of
    // the em at 20 — which closes the counters and turns a shrunken word into
    // a smudge.
    const big = wordRowLayout({ word: 'run', width: 393, lane: 75 });
    const small = wordRowLayout({ word: LONGEST, width: 393, lane: 75 });

    expect(big.letterSpacing).toBeCloseTo(-1.2, 5);
    expect(Math.abs(small.letterSpacing)).toBeLessThan(Math.abs(big.letterSpacing));
  });
});
