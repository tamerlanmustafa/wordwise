/**
 * glossLine — "(noun) a place where money is kept" on the Explore card and the
 * movie-detail card deck.
 *
 * The rule these defend: the two halves arrive from different producers at
 * different times — `pos` when a script is classified, `definition` when the
 * definition worker later reaches the lemma — so all four combinations are
 * live in production, and neither half may gate the other. A card must never
 * print a bare "(noun)" with nothing after it, and must never drop a gloss
 * because the parser had no tag for the word.
 */
import { glossLine } from '../glossLine';

// U+2068/U+2069 — the isolates the label is wrapped in. Spelled with
// fromCharCode here for the same reason as in the source: an invisible
// character pasted into a test file is a test nobody can read.
const FSI = String.fromCharCode(0x2068);
const PDI = String.fromCharCode(0x2069);
const label = (pos: string) => `${FSI}(${pos})${PDI}`;

describe('glossLine', () => {
  it('composes the full line when both halves are present', () => {
    const line = glossLine('noun', 'the land at the edge of a river');

    expect(line).toEqual({
      pos: label('noun'),
      definition: 'the land at the edge of a river',
      text: `${label('noun')} the land at the edge of a river`,
    });
  });

  it('prints the definition alone when the lemma was never tagged', () => {
    // ~14% of the registry has a NULL pos. Losing the gloss over a missing
    // grammatical label would trade the useful half for the decorative one.
    const line = glossLine(null, 'the land at the edge of a river');

    expect(line?.pos).toBeNull();
    expect(line?.text).toBe('the land at the edge of a river');
  });

  it('prints the label alone when the definition worker has not arrived', () => {
    // The dominant case in production today, and the reason the label is not
    // rendered as a prefix of the definition string.
    const line = glossLine('verb', null);

    expect(line?.definition).toBeNull();
    expect(line?.text).toBe(label('verb'));
  });

  it('is null when there is nothing to print, so the card renders no line', () => {
    expect(glossLine(null, null)).toBeNull();
    expect(glossLine(undefined, undefined)).toBeNull();
  });

  it('treats blank strings as absent rather than printing empty brackets', () => {
    // A server that starts sending "" instead of null must not put "()" on
    // every card in the deck.
    expect(glossLine('', '')).toBeNull();
    expect(glossLine('   ', 'to stop early')?.pos).toBeNull();
    expect(glossLine('noun', '   ')?.definition).toBeNull();
  });

  it('trims stray whitespace out of both halves', () => {
    const line = glossLine(' noun ', ' a river edge ');

    expect(line?.text).toBe(`${label('noun')} a river edge`);
  });

  it('wraps the label in bidi isolates so its brackets cannot mirror', () => {
    // Under an RTL app language the opening bracket is a neutral character at
    // the start of the line: without the isolate it takes the paragraph's
    // direction and "(noun)" renders as ")noun(".
    const line = glossLine('noun', 'a river edge');

    expect(line?.pos?.startsWith(FSI)).toBe(true);
    expect(line?.pos?.endsWith(PDI)).toBe(true);
  });

  it('measures the label as part of the line, not the definition alone', () => {
    // `text` is what the deck's definitionTier sizes against. Sizing on the
    // definition alone is how a line that "fits" ends up clipped.
    const definition = 'a'.repeat(40);
    const line = glossLine('noun', definition);

    expect(line?.text.length).toBeGreaterThan(definition.length);
  });
});
