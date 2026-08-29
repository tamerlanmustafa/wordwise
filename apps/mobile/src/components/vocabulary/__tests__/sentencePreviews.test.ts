import {
  hasRenderableSentence,
  isTopItemReady,
  itemKey,
  type SentencePreviewMap,
} from '../sentencePreviews';

const hit = { sentence: 'The rain made the track slick.', word_position: 3, matched_form: 'rain' };
const miss = { sentence: '', word_position: 0, matched_form: 'which' };

describe('itemKey', () => {
  it('reads the word off a word item', () => {
    expect(itemKey({ word: 'brittle' })).toBe('brittle');
  });

  it('reads the phrase off an idiom item', () => {
    expect(itemKey({ phrase: 'run out of' })).toBe('run out of');
  });
});

describe('hasRenderableSentence', () => {
  const previews: SentencePreviewMap = { rain: hit, which: miss };

  it('keeps a word whose batch lookup found a sentence', () => {
    expect(hasRenderableSentence('rain', previews)).toBe(true);
  });

  it('drops a word the batch confirmed has no sentence', () => {
    expect(hasRenderableSentence('which', previews)).toBe(false);
  });

  it('keeps a word whose batch lookup is still in flight', () => {
    expect(hasRenderableSentence('hollow', previews)).toBe(true);
  });

  it('keeps idioms, which are never in the batch map', () => {
    expect(hasRenderableSentence('run out of', previews)).toBe(true);
  });
});

describe('deck + rows agree on what is renderable', () => {
  // The bug: the rows hid "which" and the deck showed it as a card with an
  // empty EXAMPLE SENTENCE slot. Both lists now run the same predicate, so
  // any list built from the same previews holds the same items.
  const items = [{ word: 'rain' }, { word: 'which' }, { phrase: 'run out of' }, { word: 'hollow' }];
  const previews: SentencePreviewMap = { rain: hit, which: miss };
  const visible = items.filter((i) => hasRenderableSentence(itemKey(i), previews));

  it('excludes only the confirmed miss', () => {
    expect(visible.map(itemKey)).toEqual(['rain', 'run out of', 'hollow']);
  });

  it('drops the word once a late miss lands, without touching the rest', () => {
    const later: SentencePreviewMap = { ...previews, hollow: miss };
    expect(items.filter((i) => hasRenderableSentence(itemKey(i), later)).map(itemKey)).toEqual([
      'rain',
      'run out of',
    ]);
  });
});

// The splash holds until this says yes, so a "yes" that is really "still
// loading" puts a skeleton on screen and a "no" that never flips traps the
// reader behind the wordmark until the deadline.
describe('isTopItemReady (loading-splash gate)', () => {
  const filtered = (
    items: ({ word: string } | { phrase: string })[],
    previews: SentencePreviewMap,
  ) => items.filter((i) => hasRenderableSentence(itemKey(i), previews));

  it('is not ready while the top item is still in flight', () => {
    expect(isTopItemReady([{ word: 'rain' }], {})).toBe(false);
  });

  it('is ready once the top item has its sentence', () => {
    expect(isTopItemReady([{ word: 'rain' }], { rain: hit })).toBe(true);
  });

  it('is ready with nothing to wait for on an empty list', () => {
    expect(isTopItemReady([], {})).toBe(true);
  });

  it('is ready for an idiom on top, which is never in the batch', () => {
    expect(isTopItemReady([{ phrase: 'run out of' }], {})).toBe(true);
  });

  // The bug this pairing exists to prevent: a confirmed miss on top must not
  // read as "ready" — it is dropped, and the gate moves to the card that will
  // really be on top, which may still be loading.
  it('follows the filter past a confirmed miss to the next card', () => {
    const items = [{ word: 'which' }, { word: 'rain' }];
    const missOnly: SentencePreviewMap = { which: miss };
    expect(isTopItemReady(filtered(items, missOnly), missOnly)).toBe(false);

    const bothIn: SentencePreviewMap = { which: miss, rain: hit };
    expect(isTopItemReady(filtered(items, bothIn), bothIn)).toBe(true);
  });
});
