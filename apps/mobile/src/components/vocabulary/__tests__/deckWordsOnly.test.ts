/**
 * The deck shows words. Not idioms, not phrasal verbs.
 *
 * A film's vocabulary arrives as words plus idioms, and the deck used to mix
 * them. That interacted badly with the one filter standing between the list and
 * the cards: `hasRenderableSentence` drops a word whose AI-authored example
 * sentence came back empty, but idioms are never batched for sentences at all
 * (they carry their own), so absence reads as "still loading" and every one of
 * them survives. On a level where SentenceBank is thin the words fell away and
 * the phrasal verbs did not — a reader switching to a level tab got a deck of
 * nothing but idioms.
 *
 * The quieter half: mixed into the top 60, each idiom took a slot a word could
 * have had, so "60 cards" was never 60 words.
 *
 * Both are fixed upstream of the filter rather than at it, which is what the
 * source assertions at the bottom pin: ONE list decides what the deck holds,
 * and the sentence batch fetches for that same list. Split them and a card can
 * appear for a word nobody asked the backend about — a skeleton sentence slot
 * that never resolves, because "not fetched" and "no sentence" are the same
 * absence in the preview map.
 */

import fs from 'fs';
import path from 'path';
import { deckWordsOnly } from '../deckLogic';

const word = (w: string, rank: number | null = 1) => ({
  word: w,
  lemma: w,
  confidence: 1,
  frequency_rank: rank,
});
const idiom = (phrase: string) => ({
  phrase,
  type: 'phrasal_verb' as const,
  cefr_level: 'B2',
  words: phrase.split(' '),
});

describe('deckWordsOnly', () => {
  it('drops idioms and phrasal verbs', () => {
    const items = [word('candour'), idiom('put up with'), word('brittle')];
    expect(deckWordsOnly(items).map((w) => w.word)).toEqual(['candour', 'brittle']);
  });

  it('keeps the order it was given', () => {
    // The list arrives sorted by rarity. Filtering must not reshuffle it, or
    // the deck stops matching the order the bookmark was written against.
    const items = [word('a', 900), idiom('run into'), word('b', 500), word('c', 100)];
    expect(deckWordsOnly(items).map((w) => w.word)).toEqual(['a', 'b', 'c']);
  });

  it('counts the cap in WORDS, not in items', () => {
    // The regression this exists to stop: `slice(0, 60)` then filter, which
    // gives 60 minus however many idioms happened to sort into the window.
    const items = [
      idiom('give up'),
      word('one'),
      idiom('take on'),
      word('two'),
      word('three'),
    ];
    expect(deckWordsOnly(items, 2).map((w) => w.word)).toEqual(['one', 'two']);
  });

  it('returns everything when no cap is given', () => {
    // The level tabs are uncapped — the level IS the filter there, and capping
    // it would hide part of a level the reader explicitly asked to see.
    const items = [word('a'), idiom('x y'), word('b'), word('c')];
    expect(deckWordsOnly(items)).toHaveLength(3);
  });

  it('takes fewer than the cap rather than padding to it', () => {
    expect(deckWordsOnly([word('a'), idiom('x y')], 10)).toHaveLength(1);
  });

  it('survives a list with nothing in it and a list of only idioms', () => {
    // Only idioms is the exact shape of the bug report. It has to come out
    // empty — an empty deck is honest; a deck of phrasal verbs is not.
    expect(deckWordsOnly([])).toEqual([]);
    expect(deckWordsOnly([idiom('put up with'), idiom('give up')], 60)).toEqual([]);
  });

  it('carries the extra fields the suggestion pool adds', () => {
    // "For You" items are words plus a `cefr_level` the pool stamped on. The
    // card's level chip reads it, so a filter that returned bare words would
    // silently fall back to the active level on every For You card.
    const suggested = [{ ...word('candour'), cefr_level: 'C1' }, idiom('put up with')];
    expect(deckWordsOnly(suggested)[0].cefr_level).toBe('C1');
  });
});

const screen = () =>
  fs.readFileSync(
    path.join(__dirname, '..', '..', 'screens', 'MovieDetailScreen.tsx'),
    'utf8',
  );

describe('MovieDetail feeds the deck words-only bands', () => {
  it('strips idioms from the level-tab band', () => {
    // `activeItems` is the shared row list and keeps its idioms; the deck's
    // copy of it must not.
    expect(screen()).toMatch(/deckWordsOnly\(activeItems\)/);
  });

  it('builds the For You bands from a source that has no idioms in it', () => {
    // `top_words_by_level` is words; idioms arrive in their own
    // `vocabulary.idioms` array and are grouped into `idiomsByLevel` for the
    // row list. Reading the word map directly is what makes the For You deck
    // idiom-free by construction rather than by a filter someone can drop.
    const s = screen();
    const bands = s.slice(s.indexOf('const deckBands = useMemo'), s.indexOf('const deckPool'));
    expect(bands).toMatch(/vocabulary\.top_words_by_level\[level\]/);
    expect(bands).not.toMatch(/idiomsByLevel/);
  });

  it('leaves the bands uncapped', () => {
    // Load-bearing: `planDeck` applies the target and the stretch ceiling
    // AFTER the usability filter, so every band needs spares behind it. A band
    // capped at its own quota puts the ceiling back in front of the filter,
    // which is the arrangement that made the card count shrink on screen.
    const s = screen();
    expect(s).not.toMatch(/deckWordsOnly\(suggestedWords, SUGGESTED_CAP\)/);
    expect(s).toMatch(/cap: DECK_STRETCH_CAP/);
  });

  it('sorts the two halves of the deck in opposite directions', () => {
    // Above the reader: most common first, floored — the words they will meet
    // again. At and below: rarest first — where their gaps are.
    const s = screen();
    expect(s).toMatch(/stretchBand\(\[at\(idx \+ 1\), at\(idx \+ 2\)\]\)/);
    expect(s).toMatch(/\{ items: rarestFirst\(at\(idx\)\) \}/);
    expect(s).toMatch(/rarestFirst\(at\(idx - 1\)\), \.\.\.rarestFirst\(at\(idx - 2\)\)/);
  });

  it('batches example sentences for exactly the prefix the plan walked', () => {
    // The batch used to re-derive the list with its own copy of the cap and
    // its own idiom filter — two chances to disagree with what is on screen,
    // and the disagreement shows up as a card that never finishes loading.
    expect(screen()).toMatch(/const words = deckPlan\.scanned\.map\(\(w\) => w\.word\);/);
  });

  it('derives the deck from the plan, not from the mixed lists', () => {
    const s = screen();
    expect(s).toMatch(/const deckItems = deckPlan\.cards;/);
    expect(s).toMatch(/planDeck\(\s*\n\s*deckBands,/);
    expect(s).not.toMatch(/wordsView === 'foryou' \? suggestedVisible : activeItems/);
  });

  it('asks the pool, not the mixed list, whether there is anything to show', () => {
    expect(screen()).toMatch(/wordsView === 'foryou' && deckPool\.length === 0/);
  });

  it('does not tear the deck down for the rows skeleton', () => {
    // `isSwitching` covers ~100 WordRow mounts. The deck mounts one card, so
    // gating it there bought nothing and cost a full remount on every level
    // tap — and two fast taps re-armed the 140ms timer before it fired, which
    // is how the header ended up reading CARD 0 / 0.
    expect(screen()).not.toMatch(/viewMode === 'cards' && !isSwitching/);
    expect(screen()).toMatch(/\{viewMode === 'cards' \? \(/);
  });

  it('retries a first-pass miss on the timer, not on every re-render', () => {
    // The plan changes every time a chunk lands — that is how a replacement
    // word gets fetched — so a re-run must not also re-ask about words still
    // waiting out their 5 seconds, or the delay is decorative.
    expect(screen()).toMatch(/isRetryRun && s === 'miss-recent'/);
  });
});
