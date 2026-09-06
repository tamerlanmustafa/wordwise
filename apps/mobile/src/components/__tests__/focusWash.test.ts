/**
 * Receding surfaces, at two strengths.
 *
 * The app has two reasons a surface steps back, and they must not look like
 * two unrelated effects:
 *
 *   modal    — something is over this and it cannot be reached (search's
 *              panel, a bottom sheet). The dim is also the promise that a tap
 *              lands on the scrim.
 *   ambient  — nothing covers it; it is simply not the subject. The word
 *              deck's film hero. Everything under it stays legible and live.
 *
 * `dimColors` is the one place those depths are decided, and this pins the
 * relationships between them rather than the hex values — a designer retuning
 * the numbers should not have to update a test, but reversing the two
 * strengths should fail immediately.
 */

import fs from 'fs';
import path from 'path';
import { dimColors } from '../../theme/dim';

/** Alpha out of an `rgba(r,g,b,a)` string. */
function alpha(color: string): number {
  const m = /rgba?\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)/.exec(color);
  if (!m) throw new Error(`not an rgba colour: ${color}`);
  return Number(m[1]);
}

const SCHEMES = ['light', 'dark'] as const;

describe('dimColors', () => {
  it.each(SCHEMES)('%s: the edge is darker than the middle', (scheme) => {
    // That difference is the vignette. Equal values would render two flat
    // layers and the effect would be a grey sheet rather than depth.
    for (const strength of ['modal', 'ambient'] as const) {
      const { base, edge } = dimColors(strength, scheme);
      expect(alpha(edge)).toBeGreaterThan(alpha(base));
    }
  });

  it.each(SCHEMES)('%s: ambient keeps a lighter centre than modal', (scheme) => {
    // The centre of an ambient screen is its subject — the word deck — so
    // nothing should be sitting on top of it there.
    const m = dimColors('modal', scheme);
    const a = dimColors('ambient', scheme);
    expect(alpha(a.base)).toBeLessThan(alpha(m.base));
  });

  it.each(SCHEMES)('%s: ambient falls off harder toward the edges', (scheme) => {
    // This assertion replaced "ambient is lighter than modal at both stops",
    // which was wrong and shipped: a mid alpha of black over a bright film
    // still does not read as dark, it reads as GREY, and the poster sat in
    // the middle of the range instead of behind the deck.
    //
    // The two are different shapes, not two strengths of one. Modal is a flat
    // barrier answering "can I touch this?"; ambient is a vignette answering
    // "where do I look?", so its edges — which is where the poster and the
    // backdrop actually are — go darker than modal's while its centre stays
    // lighter.
    const m = dimColors('modal', scheme);
    const a = dimColors('ambient', scheme);
    expect(alpha(a.edge)).toBeGreaterThan(alpha(m.edge));
    expect(alpha(a.edge) - alpha(a.base)).toBeGreaterThan(alpha(m.edge) - alpha(m.base));
  });

  it.each(['modal', 'ambient'] as const)('%s: light mode uses a lighter hand', (strength) => {
    // The same alpha that reads as "behind something" on a dark ground reads
    // as "broken" on a pale one.
    const light = dimColors(strength, 'light');
    const dark = dimColors(strength, 'dark');
    expect(alpha(light.base)).toBeLessThan(alpha(dark.base));
    expect(alpha(light.edge)).toBeLessThan(alpha(dark.edge));
  });

  it('never dims so far that what is behind it is gone', () => {
    // These are washes over content, not replacements for it.
    for (const scheme of SCHEMES) {
      for (const strength of ['modal', 'ambient'] as const) {
        const { base, edge } = dimColors(strength, scheme);
        expect(alpha(base)).toBeGreaterThan(0);
        expect(alpha(edge)).toBeLessThan(0.9);
      }
    }
  });
});

describe('both surfaces read the same source', () => {
  const SRC = path.join(__dirname, '..');
  const read = (...p: string[]) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

  it('neither overlay hard-codes its own alphas', () => {
    // There was one copy of these values in SearchDimOverlay, and a second in
    // FocusWash would have drifted — a screen that dims to one depth behind a
    // sheet and another behind a wash reads as two states, not one idea.
    for (const f of [
      ['filmFeed', 'SearchDimOverlay.tsx'],
      ['common', 'FocusWash.tsx'],
    ]) {
      const s = read(...f);
      expect(s).toMatch(/dimColors\((?:'modal'|'ambient'), scheme\)/);
      expect(s).not.toMatch(/rgba\(0,0,0,0\.\d+\)/);
    }
  });

  it('both use the shared vignette rather than drawing their own edges', () => {
    // The reach differs — FocusWash has a specific block to cover and passes
    // its own — but the gradient itself is one component, so a screen that
    // has receded looks the same whichever reason it receded for.
    for (const f of [
      ['filmFeed', 'SearchDimOverlay.tsx'],
      ['common', 'FocusWash.tsx'],
    ]) {
      expect(read(...f)).toMatch(/<Vignette color=\{edge\}/);
    }
  });

  it('reaches past the film hero it has to push back', () => {
    // The hero runs to roughly 206pt on a notched phone: safe area, the back
    // row, then the poster's own 100. A shorter reach leaves the poster's
    // lower half outside the dark part, bright, which is exactly what this
    // number exists to answer.
    const reach = Number(/const REACH = (\d+)/.exec(read('common', 'FocusWash.tsx'))?.[1]);
    expect(reach).toBeGreaterThan(206);
  });
});

describe('the wash on MovieDetail', () => {
  const SRC = path.join(__dirname, '..');
  const read = (...p: string[]) => fs.readFileSync(path.join(SRC, ...p), 'utf8');
  const screen = () => read('screens', 'MovieDetailScreen.tsx');
  /** The file with its prose removed — these check for style *properties*,
   *  and the docblock explains the ones it must not have. */
  const washCode = () => read('common', 'FocusWash.tsx').replace(/\/\*[^]*?\*\/|\/\/[^\n]*/g, '');

  it('sits after the hero and before everything the deck is made of', () => {
    // Placement is the configuration: it dims what was drawn before it and
    // nothing after. So the hero recedes, and the card counter, the deck and
    // the controls under it — one block, as far as the eye is concerned —
    // all stay at full strength.
    const s = screen();
    const hero = s.indexOf('<MovieDetailHero');
    const wash = s.indexOf('<FocusWash />');
    const deck = s.indexOf('<WordCardDeck');
    expect(hero).toBeGreaterThan(-1);
    expect(wash).toBeGreaterThan(hero);
    expect(deck).toBeGreaterThan(wash);
  });

  it('takes no touches, so the back button and poster still work', () => {
    // Burying navigation under a scrim to make a list look better is a trade
    // worth refusing — this is ambient, not modal.
    expect(washCode()).toMatch(/pointerEvents="none"/);
  });

  it('carries no zIndex, so its position in the JSX is what decides', () => {
    // A zIndex would let it be dropped anywhere and then need a second number
    // to say what it meant — which is how two elements end up fighting over
    // an order neither file states.
    expect(washCode()).not.toMatch(/zIndex/);
  });
});
