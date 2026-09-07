/**
 * `splitAroundWord` — finding the target word inside its example sentence.
 *
 * The failure mode is not a crash. A sloppy match highlights the wrong run of
 * letters and the card confidently underlines "act" inside "factory", which
 * looks like a bug in the data rather than in the regex. A missed match, by
 * contrast, is invisible: the sentence renders plainly. So the rule is to be
 * conservative — highlight only what is certainly the word.
 */

import { shouldShowExample, splitAroundWord } from '../wordCardText';

describe('splitAroundWord', () => {
  it('splits around the word', () => {
    expect(splitAroundWord('She had to run home.', 'run')).toEqual({
      before: 'She had to ',
      match: 'run',
      after: ' home.',
    });
  });

  it('matches whole words only', () => {
    // The one that matters: "act" must not light up inside "factory".
    expect(splitAroundWord('He toured the factory.', 'act')).toBeNull();
    expect(splitAroundWord('A running joke.', 'run')).toBeNull();
  });

  it('is case-insensitive but keeps the sentence’s own casing', () => {
    // The match is re-rendered from the sentence, so a capitalised sentence
    // opener stays capitalised rather than being replaced by the lemma.
    expect(splitAroundWord('Run for it.', 'run')?.match).toBe('Run');
  });

  it('takes the first occurrence only', () => {
    const parts = splitAroundWord('Run, and run again.', 'run')!;
    expect(parts.before).toBe('');
    expect(parts.match).toBe('Run');
    expect(parts.after).toBe(', and run again.');
  });

  it('reassembles into the original sentence exactly', () => {
    // The three pieces are rendered back to back, so anything lost here is a
    // character missing from the card.
    const sentence = 'The plan was to run before dawn.';
    const p = splitAroundWord(sentence, 'run')!;
    expect(p.before + p.match + p.after).toBe(sentence);
  });

  it('returns null rather than guessing when the word is inflected away', () => {
    // Plenty of sentences use a form the lemma does not match. No highlight is
    // invisible; a wrong one is a visible defect.
    expect(splitAroundWord('She ran home.', 'run')).toBeNull();
  });

  it('escapes regex metacharacters instead of interpreting them', () => {
    // Unescaped, '.' matches any character and 'a.c' would light up the "a b c"
    // below — a confident highlight of the wrong letters.
    expect(splitAroundWord('a b c', 'a.c')).toBeNull();
    expect(splitAroundWord('The cost is a.c today', 'a.c')?.match).toBe('a.c');
  });

  it('declines a word that ends in punctuation rather than mis-matching it', () => {
    // `\b` needs a word character on one side, and "C++" has none after the
    // plus signs, so no boundary exists there. That is the conservative half
    // of this function working as intended: no highlight beats a wrong one.
    expect(splitAroundWord('Look at the C++ code.', 'C++')).toBeNull();
  });

  it('handles empty inputs without throwing', () => {
    expect(splitAroundWord('', 'run')).toBeNull();
    expect(splitAroundWord('She ran.', '')).toBeNull();
  });
});

/**
 * The same lookup, read the other way round. On a definition card the sentence
 * is half the question and the word in it is blanked, so "cannot locate it" is
 * no longer a missed highlight — it is the answer printed above the four
 * options. A quarter of the corpus uses an inflected form, so this is the
 * common case, not the edge one.
 */
describe('shouldShowExample', () => {
  it('shows the sentence on an ordinary card whether or not the word is found', () => {
    expect(shouldShowExample('She had to run home.', 'run', false)).toBe(true);
    // Inflected away: no highlight, but the sentence is still worth reading.
    expect(shouldShowExample('She ran home.', 'run', false)).toBe(true);
  });

  it('shows the sentence on a definition card when the word can be blanked', () => {
    expect(shouldShowExample('She had to run home.', 'run', true)).toBe(true);
  });

  it('hides the sentence on a definition card when the word cannot be blanked', () => {
    // "ran" is the answer to "to move quickly on foot", sitting above the grid.
    expect(shouldShowExample('She ran home.', 'run', true)).toBe(false);
    expect(shouldShowExample('A running joke.', 'run', true)).toBe(false);
  });

  it('has nothing to show without a sentence', () => {
    expect(shouldShowExample(null, 'run', true)).toBe(false);
    expect(shouldShowExample(undefined, 'run', false)).toBe(false);
    expect(shouldShowExample('', 'run', false)).toBe(false);
  });
});
