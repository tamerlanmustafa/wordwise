import { hasRenderableSentence, itemKey, type SentencePreviewMap } from '../sentencePreviews';

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
