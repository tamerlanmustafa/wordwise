import { isSameAsSource, wordTranslationDisplay } from '../translationDisplay';

// The seven words that were actually in prod's reveal cache with a Turkish
// gloss identical to the English (word_sentence_examples, 2026-08-30). `khat`
// is the one a reader hit on Mission: Impossible - The Final Reckoning.
const LOANWORDS_TR = ['khat', 'tweeter', 'grappa', 'beanbag', 'argon', 'sampler', 'malt'];

describe('isSameAsSource', () => {
  it.each(LOANWORDS_TR)('flags %s, which really is the same in Turkish', (word) => {
    expect(isSameAsSource(word, word)).toBe(true);
  });

  it('ignores casing and surrounding whitespace from the provider', () => {
    expect(isSameAsSource('khat', 'Khat')).toBe(true);
    expect(isSameAsSource('khat', '  khat ')).toBe(true);
    expect(isSameAsSource('Malt', 'malt')).toBe(true);
  });

  it('leaves a real translation alone', () => {
    expect(isSameAsSource('gallant', 'cesur')).toBe(false);
    // A translation that merely starts with the word is still a translation.
    expect(isSameAsSource('malt', 'malta')).toBe(false);
  });

  it('treats a missing translation as not-same rather than same', () => {
    // Guards the empty-string trap: '' === ''.trim() would otherwise match a
    // term of '' and silently claim an untranslated card is a loanword.
    expect(isSameAsSource('khat', null)).toBe(false);
    expect(isSameAsSource('khat', undefined)).toBe(false);
    expect(isSameAsSource('khat', '')).toBe(false);
    expect(isSameAsSource('', '')).toBe(false);
  });
});

describe('wordTranslationDisplay', () => {
  it('shows a real translation, lowercased for the card voice', () => {
    expect(wordTranslationDisplay('gallant', 'Cesur')).toEqual({
      kind: 'translation',
      text: 'cesur',
    });
  });

  it('says same-as-source instead of echoing the word back', () => {
    // The bug this exists for: the card read "khat / khat [TR]".
    expect(wordTranslationDisplay('khat', 'khat')).toEqual({ kind: 'sameAsSource' });
    expect(wordTranslationDisplay('Grappa', 'grappa')).toEqual({ kind: 'sameAsSource' });
  });

  it('reports nothing-yet for an empty or absent translation', () => {
    expect(wordTranslationDisplay('khat', null)).toEqual({ kind: 'unavailable' });
    expect(wordTranslationDisplay('khat', '   ')).toEqual({ kind: 'unavailable' });
  });
});
