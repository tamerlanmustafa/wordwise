/**
 * The word card makes room for its translation by folding the gloss — only
 * when it has to.
 *
 * Measured on a 667pt iPhone SE: the longest example sentence under a
 * three-line gloss ran its revealed translation past the card's bottom edge,
 * and the card is a pager page, so the last two lines could not be reached.
 * The 13 mini and every taller phone fit the same card with room to spare.
 */

import fs from 'fs';
import path from 'path';

import {
  REVEAL_GAP,
  SPACER_BOTTOM_MIN,
  SPACER_TOP_MIN,
  glossYieldsToReveal,
  spareHeight,
} from '../revealFit';

describe('spareHeight', () => {
  it('is what the spacers hold beyond their minimums', () => {
    expect(spareHeight(SPACER_TOP_MIN + 40, SPACER_BOTTOM_MIN + 40)).toBe(80);
  });

  it('is zero, never negative, when the content already fills the card', () => {
    expect(spareHeight(SPACER_TOP_MIN, SPACER_BOTTOM_MIN)).toBe(0);
    expect(spareHeight(0, 0)).toBe(0);
  });
});

describe('glossYieldsToReveal', () => {
  const base = { revealed: true, hasGloss: true, spare: 100, revealHeight: 150 };

  it('folds the gloss when the translation would not fit', () => {
    expect(glossYieldsToReveal(base)).toBe(true);
  });

  it('leaves it alone when the translation fits — every card on a tall phone', () => {
    expect(glossYieldsToReveal({ ...base, spare: 150 + REVEAL_GAP })).toBe(false);
    expect(glossYieldsToReveal({ ...base, spare: 400 })).toBe(false);
  });

  it('counts the gap above the translation, not just its height', () => {
    // A block that fits only if the 18pt gap is forgotten still overflows.
    expect(glossYieldsToReveal({ ...base, spare: 150 + REVEAL_GAP - 1 })).toBe(true);
  });

  it('never folds while the translation is closed', () => {
    expect(glossYieldsToReveal({ ...base, revealed: false })).toBe(false);
  });

  it('has nothing to fold on a card without a gloss', () => {
    expect(glossYieldsToReveal({ ...base, hasGloss: false })).toBe(false);
  });

  it('does not guess before the card has measured itself', () => {
    expect(glossYieldsToReveal({ ...base, spare: null })).toBe(false);
    expect(glossYieldsToReveal({ ...base, revealHeight: 0 })).toBe(false);
  });
});

describe('WordCard wires the fold', () => {
  const card = () => fs.readFileSync(path.join(__dirname, '..', 'WordCard.tsx'), 'utf8');

  it('takes the spacer minimums from the same constants the decision uses', () => {
    // A minimum changed in one place and not the other would decide against a
    // card that is not the one on screen.
    const s = card();
    expect(s).toMatch(/spacerTop: \{ flex: 1, minHeight: SPACER_TOP_MIN \}/);
    expect(s).toMatch(/spacerBottom: \{ flex: 1, minHeight: SPACER_BOTTOM_MIN \}/);
  });

  it('measures the room only with the translation closed', () => {
    const s = card();
    expect(s).toMatch(/if \(!revealed\) spacerTopH\.current = /);
    expect(s).toMatch(/if \(!revealed\) spacerBottomH\.current = /);
  });

  it('folds on the reveal’s own clock and curve, so the two movements are one', () => {
    const s = card();
    const fold = s.slice(s.indexOf('Animated.timing(glossAnim'), s.indexOf('Animated.timing(glossFade'));
    expect(fold).toMatch(/duration: REVEAL_MS/);
    expect(fold).toMatch(/easing: EXPLORE_EASING/);
    const reveal = s.slice(s.indexOf('Animated.timing(heightAnim'), s.indexOf('Animated.timing(fadeAnim'));
    expect(reveal).toMatch(/duration: REVEAL_MS/);
  });

  it('keeps height on the JS driver and opacity on the native one, in separate views', () => {
    // Mixing the two drivers on one view throws; animating layout natively is
    // not supported at all.
    const s = card();
    const fold = s.slice(s.indexOf('Animated.timing(glossAnim'), s.indexOf('Animated.timing(glossFade'));
    expect(fold).toMatch(/useNativeDriver: false/);
    const fade = s.slice(s.indexOf('Animated.timing(glossFade'), s.indexOf(']).start();'));
    expect(fade).toMatch(/useNativeDriver: true/);
    expect(s).toMatch(/<Animated\.View style=\{\{ opacity: glossFade \}\}>/);
  });

  it('measures the gloss from a hidden copy, never from the one that folds', () => {
    // Measured from the visible copy, a folded gloss reported the fold's height
    // and could never open again — caught on the SE simulator.
    const s = card();
    expect(s).toMatch(/gloss && glossHeight === 0 \? \(\s*<View\s+style=\{s\.measure\}/);
    const visible = s.slice(s.indexOf('<Animated.View style={{ opacity: glossFade }}>'), s.indexOf('</Animated.View>', s.indexOf('<Animated.View style={{ opacity: glossFade }}>')));
    expect(visible).not.toMatch(/onLayout/);
  });
});
