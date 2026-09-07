/**
 * "Knew it" is a label on a word, not a way to delete it.
 *
 * The bug this pins: `handleMarkLearned` wrote a global `user_words` marker,
 * `MovieDetailScreen` subtracted every marked word from the lists it fed the
 * deck, and so a left swipe removed the card. Repeat it and a film's deck
 * emptied — permanently, and from every other film too. `/user/words/unlearn`
 * would have put a word back, but its only caller (LearnedWordsScreen) sits
 * behind `vocabulary`, a screen nothing in the app navigates to. So the deck
 * had a control that destroyed content with no reachable way back.
 *
 * Two halves have to hold for that to stay fixed, and they live in different
 * files, which is exactly why a test says so in one place:
 *
 *   1. the deck ADVANCES on a left swipe (WordCardDeck.doLearn), and
 *   2. the parent does not FILTER by the marker (MovieDetailScreen).
 *
 * Either one alone still empties the deck. The reducer half is covered by
 * deckLogic.test.ts — `advance` has always wrapped; what changed is which
 * commits reach it.
 *
 * Source-reading, not rendering: mobile tests are logic + integration only, so
 * like `movieDetailFeedback.test.ts` and `cardPress.test.ts` this asserts on
 * the components' source.
 */

import fs from 'fs';
import path from 'path';

const src = (...p: string[]) =>
  fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');

const deck = () => src('vocabulary', 'WordCardDeck.tsx');
const screen = () => src('screens', 'MovieDetailScreen.tsx');
const row = () => src('vocabulary', 'BookmarkRowWrapper.tsx');

/** The body of a top-level `const name = (…) => { … };` arrow function. */
function fnBody(source: string, name: string): string {
  const start = source.indexOf(`  const ${name} = (`);
  if (start === -1) throw new Error(`no function named ${name}`);
  const end = source.indexOf('\n  };', start);
  if (end === -1) throw new Error(`could not find the end of ${name}`);
  return source.slice(start, end);
}

describe('a left swipe advances the deck instead of shrinking it', () => {
  it('dispatches the same advance the Next pill does', () => {
    const learn = fnBody(deck(), 'doLearn');
    expect(learn).toMatch(/dispatch\(\{ type: 'advance' \}\)/);
  });

  it('moves the bookmark to the NEXT key, wrapping past the end', () => {
    // It used to write `promotedKeyAfterRemoval` — where focus would land once
    // the parent's list had shrunk by one. With nothing leaving the list, that
    // is simply the next card, and the modulo is what keeps the last card of a
    // deck from walking off the end.
    const learn = fnBody(deck(), 'doLearn');
    expect(learn).toMatch(/displayDeck\.keys\[\(displayDeck\.index \+ 1\) % total\]/);
    expect(learn).toMatch(/onAdvanceBookmark\(nextKey\)/);
  });

  it('does not hide the focused card, because nothing is about to unmount it', () => {
    // `focusOpacity.setValue(0)` covered the beat between the commit and the
    // parent's list catching up. There is no such beat now, and a card hidden
    // for one that never arrives is a blank deck.
    expect(deck()).not.toMatch(/focusOpacity/);
  });

  it('still records the mark, and records it before the early return', () => {
    // A one-card deck has nowhere to advance to and springs back — but the
    // reader still said they knew the word, so the mark cannot sit after the
    // `total <= 1` guard.
    const learn = fnBody(deck(), 'doLearn');
    const marked = learn.indexOf('onMarkLearned(currentKey)');
    const guard = learn.indexOf('total <= 1');
    expect(marked).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(marked);
  });

  it('keeps flying toward the leading edge, so the two commits stay distinct', () => {
    // Both gestures advance now. If they also looked the same, the deck would
    // be teaching that a left swipe and a right swipe are one swipe.
    expect(fnBody(deck(), 'doLearn')).toMatch(/pushOutgoing\(-1,/);
    expect(fnBody(deck(), 'doAdvance')).toMatch(/pushOutgoing\(1,/);
  });
});

describe('the parent never filters a list by the marker', () => {
  it('builds the level list from the unfiltered words and idioms', () => {
    const s = screen();
    expect(s).toMatch(
      /const arr: RowItem\[\] = \[\.\.\.\(activeWords \?\? \[\]\), \.\.\.\(activeIdioms \?\? \[\]\)\]/,
    );
    expect(s).not.toMatch(/filteredActiveWords|filteredActiveIdioms/);
  });

  it('leaves known words in the For You pool as well', () => {
    // The less obvious half. `suggestedVisible` reads like a ranking, where
    // demoting a word you know would be fair — but it is also the deck's item
    // list when `wordsView === 'foryou'`, so a skip there empties that deck by
    // exactly the same mechanism.
    const s = screen();
    expect(s).not.toMatch(/if \(learnedWords\.has\(w\.word\)\) continue;/);
    expect(s).not.toMatch(/if \(learnedWords\.has\(i\.phrase\)\) continue;/);
  });

  it('never subtracts the set from a collection anywhere on the screen', () => {
    // The catch-all: any new `.filter(… !learnedWords.has(…))` is the bug
    // coming back in a place these named assertions do not look.
    expect(screen()).not.toMatch(/!learnedWords\.has\(/);
  });

  it('feeds the set to the deck as a badge input, under a name that says so', () => {
    expect(screen()).toMatch(/knownWords=\{learnedWords\}/);
    expect(deck()).toMatch(/knownWords: Set<string>/);
  });
});

describe('a mark still leaves a visible trace', () => {
  it('badges the card on both faces that draw the meta row', () => {
    // The focused card and the fly-away overlay render the row twice. One
    // badge component, so they cannot drift apart and pop at the detach.
    const d = deck();
    expect(d.match(/<KnownBadge s=\{s\}/g) ?? []).toHaveLength(2);
    expect(d).toMatch(/knownWords\.has\(currentKey\)/);
    expect(d).toMatch(/knownWords\.has\(term\)/);
  });

  it('recesses a known row rather than collapsing it away', () => {
    // Collapsing the row is what the removal used to look like. Opacity keeps
    // the row present and tappable while still answering the swipe.
    const r = row();
    expect(r).toMatch(/const KNOWN_ROW_OPACITY = 0\.55/);
    expect(r).toMatch(/opacity: isKnown && !revealing \? KNOWN_ROW_OPACITY : 1/);
  });

  it('leaves the row at full strength while it slides', () => {
    // A translucent row mid-swipe shows the reveal pane straight through its
    // own text — the reason the paper fill is painted under it at all.
    expect(row()).toMatch(/!revealing/);
  });

  it('carries the flag on the wrapper, so every row type gets it once', () => {
    // Four call sites, three different row components (ForYouWordRow, IdiomRow
    // and the words row) — the wrapper is the one place they share.
    const s = screen();
    expect(s.match(/isKnown=\{learnedWords\.has\(key\)\}/g) ?? []).toHaveLength(4);
  });

  it('names the badge in every language the app ships', () => {
    for (const lang of ['en', 'es', 'pt', 'tr', 'ru', 'ar']) {
      const json = JSON.parse(
        fs.readFileSync(
          path.join(__dirname, '..', '..', '..', 'i18n', 'locales', lang, 'vocabulary.json'),
          'utf8',
        ),
      );
      expect(typeof json.deck.knownBadge).toBe('string');
      expect(json.deck.knownBadge.length).toBeGreaterThan(0);
    }
  });
});

describe('the reversal is reachable', () => {
  it('undoes the mark against the server', () => {
    // The endpoint was never broken. What was broken is that nothing called
    // it: LearnedWordsScreen is the only caller and lives behind `vocabulary`,
    // which nothing navigates to. The toast's Undo is now a live caller.
    expect(screen()).toMatch(/wordwiseApi\.unlearnWord\(word\)/);
  });

  it('rolls the badge back off when either write fails', () => {
    // Optimistic on both sides: the badge appears on the swipe and disappears
    // on the Undo, so both directions need the server's answer to be able to
    // put it back.
    const s = screen();
    expect(s).toMatch(/wordwiseApi\.markWordLearned\(word\)\.catch\(rollback\)/);
    expect(s).toMatch(/wordwiseApi\.unlearnWord\(word\)\.catch\(/);
  });
});
