/**
 * Which words, and in which direction.
 *
 * The deck exists so a learner can follow a film's subtitles. What stops them
 * is the vocabulary above their level, so that band leads — but "above their
 * level" was being ordered rarest-first, the same as everything else, and that
 * turns out to select almost exactly the wrong words.
 *
 * Measured on a real script, the first twelve B2 cards a B1 reader was handed:
 *
 *   psst, twig, bod, prudence, tamara, sitter, fragrant, whew, rightfully,
 *   reptile, maddie, unprofessional
 *
 * Two proper nouns, two interjections, and a handful of words that appear once
 * in that film and never again. Not a coincidence: sorting a band by maximum
 * rarity selects for whatever is wrong with the data, because junk is rare by
 * construction. The same band, most-common-first, opens with `petition, patch,
 * nest, advisor, fury, persistent, obsession` — words a B1 reader will meet
 * again.
 *
 * So the two halves of the deck sort in OPPOSITE directions, and that is the
 * design rather than an inconsistency:
 *
 *   • above the reader's level — most common first (what they will meet again)
 *   • at or below it          — rarest first      (where their gaps are)
 *
 * The floor is the other half of the stretch band. The per-script classifier
 * puts `make`, `say` and `run` in B2, and common-first would hand those over
 * first; anything that common is either already known or misclassified.
 */

import {
  mostCommonFirst,
  rarestFirst,
  stretchBand,
  CEFR_LADDER,
  DECK_STRETCH_CAP,
  DECK_STRETCH_RANK_FLOOR,
  DECK_STRETCH_SHARE,
  DECK_TARGET_CARDS,
} from '../deckLogic';

const w = (word: string, frequency_rank: number | null) => ({ word, frequency_rank });

describe('ordering', () => {
  it('rarestFirst puts the rare tail at the front', () => {
    const out = rarestFirst([w('common', 200), w('rare', 40000), w('mid', 5000)]);
    expect(out.map((x) => x.word)).toEqual(['rare', 'mid', 'common']);
  });

  it('mostCommonFirst is its exact opposite', () => {
    const out = mostCommonFirst([w('common', 200), w('rare', 40000), w('mid', 5000)]);
    expect(out.map((x) => x.word)).toEqual(['common', 'mid', 'rare']);
  });

  it('sinks unranked words in BOTH directions', () => {
    // An unknown rank is an absence, not a signal. Sorting it to the front of
    // "rarest" would be the same mistake as the 100,000 sentinel, one level up.
    expect(rarestFirst([w('a', null), w('b', 900)]).map((x) => x.word)).toEqual(['b', 'a']);
    expect(mostCommonFirst([w('a', null), w('b', 900)]).map((x) => x.word)).toEqual(['b', 'a']);
  });

  it('does not mutate its input', () => {
    const input = [w('a', 100), w('b', 900)];
    rarestFirst(input);
    mostCommonFirst(input);
    expect(input.map((x) => x.word)).toEqual(['a', 'b']);
  });
});

describe('stretchBand', () => {
  const level = [
    w('make', 30),          // misclassified basic
    w('say', 60),           // misclassified basic
    w('petition', 4000),
    w('advisor', 6000),
    w('psst', 90000),       // interjection, rare by construction
    w('tamara', 30000),     // proper noun
  ];

  it('leads with the most common word that clears the floor', () => {
    expect(stretchBand([level])[0].word).toBe('petition');
  });

  it('drops what the classifier got wrong at the easy end', () => {
    const out = stretchBand([level]).map((x) => x.word);
    expect(out).not.toContain('make');
    expect(out).not.toContain('say');
  });

  it('demotes rather than deletes the junk at the rare end', () => {
    // Ordering cannot fix a proper noun — `word_classifications.pos` is NULL on
    // every row, so there is nothing to filter on. What common-first can do is
    // make sure `tamara` is the last card rather than the fifth.
    const out = stretchBand([level]).map((x) => x.word);
    expect(out).toContain('tamara');
    expect(out.indexOf('tamara')).toBeGreaterThan(out.indexOf('advisor'));
    expect(out[out.length - 1]).toBe('psst');
  });

  it('drops unranked words, which cannot clear a floor', () => {
    expect(stretchBand([[w('mystery', null), w('petition', 4000)]]).map((x) => x.word))
      .toEqual(['petition']);
  });

  it('exhausts one level before touching the next', () => {
    // A B1 reader should meet every worthwhile B2 word before being handed a
    // C1 one, even when the C1 word is the more common of the two.
    const up1 = [w('b2rare', 40000)];
    const up2 = [w('c1common', 900)];
    expect(stretchBand([up1, up2]).map((x) => x.word)).toEqual(['b2rare', 'c1common']);
  });

  it('sorts within a level, not across the concatenation', () => {
    const up1 = [w('b2rare', 40000), w('b2common', 900)];
    const up2 = [w('c1mid', 5000)];
    expect(stretchBand([up1, up2]).map((x) => x.word)).toEqual([
      'b2common',
      'b2rare',
      'c1mid',
    ]);
  });

  it('survives a level the film has none of', () => {
    expect(stretchBand([[], []])).toEqual([]);
  });
});

describe('the ratio', () => {
  it('reserves 70% of the deck for words above the reader', () => {
    expect(DECK_STRETCH_SHARE).toBe(0.7);
    expect(DECK_STRETCH_CAP).toBe(Math.round(DECK_TARGET_CARDS * DECK_STRETCH_SHARE));
    expect(DECK_STRETCH_CAP).toBe(42);
  });

  it('leaves a consolidation block worth having', () => {
    // The other 30% is the reader's own level, rarest first. Below about a
    // dozen cards it stops reading as a section of the deck and starts reading
    // as noise in it.
    expect(DECK_TARGET_CARDS - DECK_STRETCH_CAP).toBeGreaterThanOrEqual(12);
  });

  it('sets the floor above the misclassified basics', () => {
    // `make` (~30) and `say` (~60) are the measured offenders; the floor has to
    // clear them without eating the genuinely useful 1,000-5,000 band.
    expect(DECK_STRETCH_RANK_FLOOR).toBeGreaterThan(100);
    expect(DECK_STRETCH_RANK_FLOOR).toBeLessThan(1000);
  });

  it('keeps one copy of the CEFR ladder', () => {
    expect([...CEFR_LADDER]).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
  });
});
