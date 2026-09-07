/**
 * The deck's three card faces wear one rim.
 *
 * A word card exists in three styles at three moments — `ghost` while it is
 * stacked behind, `card` while it is focused, `outgoingCard` while it flies
 * away under a swipe — and they are the same card a moment apart. A rim that
 * only one of them wore would change colour mid-animation, which reads as a
 * flicker rather than as a design.
 *
 * That rim is `goldOnSurface`: the one the "Knew it" pill under the deck wears
 * (`knowFace`) and the one the film-feed card wears. Tokens, so light
 * (#8B5A00) and dark (#FFD166) come from the palette rather than from a branch
 * in the component.
 *
 * Source-reading, not rendering: mobile tests are logic + integration only, so
 * like `nextButtonDesign.test.ts` and `cardPress.test.ts` this asserts on the
 * component's source.
 */

import fs from 'fs';
import path from 'path';

const deck = () =>
  fs.readFileSync(path.join(__dirname, '..', 'WordCardDeck.tsx'), 'utf8');

/** The body of one `StyleSheet.create` entry, by name. */
function styleBlock(src: string, name: string): string {
  const start = src.indexOf(`    ${name}: {`);
  if (start === -1) throw new Error(`no style named ${name}`);
  return src.slice(start, src.indexOf('\n    },', start));
}

const FACES = ['ghost', 'card', 'outgoingCard'] as const;

describe('every card face wears the same rim', () => {
  it.each(FACES)('%s is bordered in goldOnSurface', (name) => {
    expect(styleBlock(deck(), name)).toMatch(/borderColor: tc\.goldOnSurface/);
  });

  it.each(FACES)('%s keeps a 1pt border, not a heavier one', (name) => {
    // The pill under the deck wears 1.5 because it is a control. These are
    // surfaces; the rim defines the card without competing with the type.
    expect(styleBlock(deck(), name)).toMatch(/borderWidth: 1,/);
  });

  it('leaves none of them on the neutral border token', () => {
    // The specific regression: changing the focused card and forgetting the
    // two it turns into.
    for (const name of FACES) {
      expect(styleBlock(deck(), name)).not.toMatch(/borderColor: tc\.border/);
    }
  });

  it('shares the rim with the button below it', () => {
    // `knowFace` is "Knew it". If that pill moves off the token, this is the
    // test that says the deck no longer matches it.
    expect(styleBlock(deck(), 'knowFace')).toMatch(/borderColor: tc\.goldOnSurface/);
  });

  it('picks the colour from a token, never a per-theme hex', () => {
    for (const name of FACES) {
      const block = styleBlock(deck(), name);
      expect(block).not.toMatch(/borderColor: light \?/);
      expect(block).not.toMatch(/borderColor: '#/);
    }
  });
});

describe('the faces stay the same shape as each other', () => {
  it.each(FACES)('%s keeps the deck corner radius', (name) => {
    // A rim is only visible as one shape if all three round identically.
    expect(styleBlock(deck(), name)).toMatch(/borderRadius: 22,/);
  });

  it.each(FACES)('%s is painted on paper', (name) => {
    expect(styleBlock(deck(), name)).toMatch(/backgroundColor: tc\.paper,/);
  });
});
