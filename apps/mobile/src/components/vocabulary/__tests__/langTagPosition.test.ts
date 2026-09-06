/**
 * The card's translation-language tag stays put through the reveal.
 *
 * The word-translation slot is two absolutely-stacked layers that cross-fade:
 * a dashed rule while hidden, the translation once revealed. Both layers carry
 * the same two-letter language tag, so anything that differs in their layout
 * is not a fade — it is the tag visibly travelling across the card every time
 * a word is turned over.
 *
 * It used to lead the hidden layer and trail the revealed one, so it crossed
 * the whole card on reveal and landed a different distance along each time,
 * because the distance was the length of the translation.
 *
 * No component-render library in this suite by project rule (see CLAUDE.md),
 * so this pins the source contract instead.
 */

import fs from 'fs';
import path from 'path';

const DECK = path.join(__dirname, '..', 'WordCardDeck.tsx');
const src = () => fs.readFileSync(DECK, 'utf8');

/**
 * One entry from the StyleSheet block, by name.
 *
 * Sliced to the closing brace at its own indent rather than matched with
 * `[^}]*` — these blocks carry prose comments, and a comment that mentions a
 * JSX prop ends that character class early, so the assertion silently stops
 * looking before it reaches the properties it is about. That is exactly how
 * the first version of this test failed against correct code.
 */
function styleBlock(name: string): string {
  const s = src();
  const start = s.indexOf(`    ${name}: {`);
  if (start === -1) throw new Error(`no style block named ${name}`);
  return s.slice(start, s.indexOf('\n    },', start));
}

/** The three tag call sites, in source order: static face, hidden, revealed. */
function tagOffsets(s: string): number[] {
  const out: number[] = [];
  const re = /langTag(?:Dashed|Solid)\b/g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    // Style definitions live at the bottom of the file; only count the JSX.
    if (s.slice(m.index - 40, m.index).includes('style={s.')) out.push(m.index);
  }
  return out;
}

describe('the language tag is pinned to the trailing edge', () => {
  it('still has all three call sites', () => {
    // Two on the live card (hidden + revealed layers) and one on the static
    // face the fly-away overlay renders. A change that fixes two of three
    // makes the tag jump on exactly one gesture, which is harder to spot.
    expect(tagOffsets(src())).toHaveLength(3);
  });

  it('puts the dashed rule before the tag, not after it', () => {
    // Both hidden layers: the rule takes the line and the tag follows it, so
    // the tag lands where the solid one does on the layer above.
    const s = src();
    const matches = s.match(/<DashedRule color=\{dashColor\}[^]*?langTagDashed/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(1);
    // …and never the other way round.
    expect(s).not.toMatch(/langTagDashedText[^]{0,200}?<DashedRule color=\{dashColor\} style=\{s\.flexSpacer\}/);
  });

  it('lets the translation take the line so the tag is pushed to the end', () => {
    // Without the grow, the revealed layer reads [translation][tag] packed to
    // the leading edge, and the tag sits a variable distance in.
    expect(styleBlock('wordTranslation')).toMatch(/flexGrow: 1/);
  });

  it('lets the translation shrink, so a long one cannot push the tag off', () => {
    // `minWidth: 0` is the half that actually permits it: a flex child will
    // not go below its own content width without it, and the row cannot wrap.
    const block = styleBlock('wordTranslation');
    expect(block).toMatch(/flexShrink: 1/);
    expect(block).toMatch(/minWidth: 0/);
    expect(src()).toMatch(/style=\{\[\s*s\.wordTranslation[^]*?numberOfLines=\{1\}/);
  });

  it('keeps the row on one line', () => {
    // The reveal must not be able to wrap the tag under the translation.
    expect(styleBlock('wordTrRow')).not.toMatch(/flexWrap/);
  });
});

describe('one card, one band colour', () => {
  it('paints the chip, the translation and the highlighted word the same', () => {
    // Three marks on one card that all mean "this word is C1". In three
    // colours they read as three unrelated decorations, and the level stops
    // being a fact the card states and becomes a badge in a corner.
    const s = src();
    expect(s).toMatch(/const levelColor = levelColorFor\(level\)/);
    // The chip.
    expect(s).toMatch(/s\.levelChipText, \{ color: levelColor \}/);
    // The translation.
    expect(s).toMatch(/s\.wordTranslation,[^]{0,700}\{ color: levelColor \}/);
    // The target word inside the example sentence.
    expect(s).toMatch(/highlightColorFor\(level, levelColor\)/);
  });

  it('still lets "same as English" opt out', () => {
    // That line is a statement about the word, not a translation of it —
    // lighter and unbolded so it does not read as the answer. Its override has
    // to come after the band colour or the band colour would win.
    const s = src();
    const at = s.indexOf('s.wordTranslation,');
    const block = s.slice(at, at + 900);
    expect(block.indexOf('{ color: levelColor }')).toBeLessThan(
      block.indexOf('wtSameAsSource && s.wordTranslationSameAsSource'),
    );
  });
});

describe('the hero is the backdrop and the title', () => {
  const hero = () =>
    fs.readFileSync(path.join(__dirname, '..', '..', 'screens', 'MovieDetailHero.tsx'), 'utf8');
  const screen = () =>
    fs.readFileSync(path.join(__dirname, '..', '..', 'screens', 'MovieDetailScreen.tsx'), 'utf8');

  it('has no poster left, nor a zoom for it', () => {
    // It was the single full-colour object on a screen whose subject is one
    // word, so the eye landed on it first on every open. The backdrop wash
    // says which film this is from behind the type instead of beside it.
    const h = hero();
    expect(h).not.toMatch(/posterPath|onPosterPress|POSTER_[WH]/);
    const sc = screen();
    expect(sc).not.toMatch(/posterZoomOpen|posterZoom/);
  });

  it('keeps the title and the meta line on the backdrop', () => {
    const h = hero();
    expect(h).toMatch(/movieTitleTier\(title\)/);
    expect(h).toMatch(/s\.metaGold/);
    expect(h).toMatch(/s\.wash/);
  });

  it('gives the freed height to the column rather than keeping it empty', () => {
    // The block was the poster's height because the poster was the tallest
    // thing in it. With the poster gone it only has to hold the title.
    const metrics = fs.readFileSync(
      path.join(__dirname, '..', 'deckMetrics.ts'), 'utf8',
    );
    const h = Number(/HERO_PLATE = \{ gap: \d+, height: (\d+) \}/.exec(metrics)?.[1]);
    // Two title lines at the larger tier (2 x 29) plus the meta line.
    expect(h).toBeGreaterThanOrEqual(58);
    expect(h).toBeLessThan(100);
  });

  it('centres the deck in what the column has left', () => {
    // The slack used to pool below the deck, which read as the card hanging
    // off the hero rather than being the screen's subject.
    expect(styleBlock('wrap')).toMatch(/justifyContent: 'center'/);
  });
});
