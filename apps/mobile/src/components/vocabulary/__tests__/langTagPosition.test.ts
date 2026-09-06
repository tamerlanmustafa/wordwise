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
