/**
 * VocabularySheet — the panel behind a film card's vocabulary ring.
 *
 * No component-render library in this suite by project rule, so this pins the
 * two things about the sheet that are contracts rather than styling:
 *
 *   1. The bar and its legend must take a band's colour from the *same* place.
 *      They are the only two views of one array, and the failure mode when
 *      they drift is that A2 is one colour in the bar and another in the list
 *      directly beneath it — which reads as a data bug, not a styling one.
 *   2. The sheet has repeatedly grown explanatory prose and had it removed
 *      again. The lines are gone from every locale, so a re-added `t()` call
 *      would render a raw key on screen.
 */

import fs from 'fs';
import path from 'path';

const HOME = path.join(__dirname, '..');
const LOCALES = path.join(__dirname, '..', '..', '..', 'i18n', 'locales');
const src = () => fs.readFileSync(path.join(HOME, 'VocabularySheet.tsx'), 'utf8');

describe('colour means difficulty, from one source', () => {
  it('takes every band colour from the shared ramp', () => {
    // Not a local map and not withAlpha-on-gold: two copies of a six-colour
    // scale is how `theme/index.ts` and `theme/palette.ts` ended up
    // disagreeing about what colour C2 is.
    const s = src();
    expect(s).toMatch(/from '\.\.\/\.\.\/theme\/cefrRamp'/);
    expect(s).toMatch(/const ramp = cefrRampFor\(tc\)/);
  });

  it('gives the bar and the legend the same `seg.color`', () => {
    const s = src();
    expect(s).toMatch(/backgroundColor: seg\.color/);
    expect(s).toMatch(/\{ color: seg\.color \}/);
  });

  it('does not shade by the reader’s level any more', () => {
    // The bar used to be gold at-or-below your level and grey above, so the
    // same segment was a different colour on two accounts and neither the bar
    // nor the legend could be read on its own.
    const s = src();
    expect(s).not.toMatch(/\bknown\b/);
    expect(s).not.toMatch(/\bcut\b/);
    expect(s).not.toMatch(/level=/);
  });
});

describe('the legend is codes and counts, nothing else', () => {
  it('has no swatch in front of each label', () => {
    // The colour is in the type. A square saying it again was the widest
    // thing in the row, so it set the rhythm to the decoration.
    const s = src();
    expect(s).not.toMatch(/swatch/i);
  });

  it('separates the pairs with a pipe', () => {
    expect(src()).toMatch(/legendSep/);
    expect(src()).toMatch(/\|/);
  });
});

describe('the explanatory prose stays gone', () => {
  const removed = ['body', 'caveat'];

  it.each(removed)('does not render vocabSheet.%s', (key) => {
    expect(src()).not.toMatch(new RegExp(`vocabSheet\\.${key}`));
  });

  it.each(removed)('has no vocabSheet.%s left in any locale', (key) => {
    // Guards the other direction: a stale string in one of six locale files is
    // an invitation for the next person to wire it back up.
    for (const locale of fs.readdirSync(LOCALES)) {
      const file = path.join(LOCALES, locale, 'home.json');
      if (!fs.existsSync(file)) continue;
      const home = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(home.vocabSheet?.[key]).toBeUndefined();
    }
  });

  it('keeps the word "distinct" in factWords, which now carries the caveat', () => {
    // `cefr_distribution` counts distinct words, not spoken words. The caveat
    // line that said so is gone, so this label is the only place left that
    // stops the number reading as an amount of listening.
    const en = JSON.parse(fs.readFileSync(path.join(LOCALES, 'en', 'home.json'), 'utf8'));
    expect(en.vocabSheet.factWords).toMatch(/distinct/i);
  });
});

describe('every pressable taps back', () => {
  it('wraps Done in withTap', () => {
    const s = src();
    expect(s).toMatch(/onPress=\{withTap\(onClose\)\}/);
    expect(s).toMatch(/from '\.\.\/\.\.\/utils\/feedback'/);
  });
});
