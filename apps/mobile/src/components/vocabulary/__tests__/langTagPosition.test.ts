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

describe('the card behind carries the swipe intent', () => {
  it('paints both panels on the ghost, not under the top card', () => {
    // "On the card behind" is the whole design: the answer appears on a
    // surface being uncovered, so the eye is already there. Backdrops under
    // the moving card would slide with nothing and read as the card itself
    // changing colour.
    // Ordering, not proximity. A `[^]{0,N}` window between the two names is a
    // character budget that anyone writing a comment between them breaks —
    // which is exactly how the first draft of this test failed against correct
    // code. Where the panels sit in the tree is the actual contract.
    const s = src();
    const ghost = s.lastIndexOf('s.ghost,');
    const nextPanel = s.indexOf('s.intentNext');
    const learnPanel = s.indexOf('s.intentLearn');
    const focusedCard = s.indexOf('key={currentKey}');
    expect(ghost).toBeGreaterThan(-1);
    expect(ghost).toBeLessThan(nextPanel);
    expect(nextPanel).toBeLessThan(learnPanel);
    // Both inside the ghost, which is drawn before the card that covers it.
    expect(learnPanel).toBeLessThan(focusedCard);
  });

  it('pairs each panel with the edge that gesture uncovers', () => {
    // Drag toward the trailing edge → advance → the leading half of the card
    // behind comes out from under the top card. So "next" is the leading
    // panel. Reversing this is invisible in review and instantly wrong in the
    // hand.
    const next = styleBlock('intentNext');
    const learn = styleBlock('intentLearn');
    expect(next).toMatch(/start: 0/);
    expect(learn).toMatch(/end: 0/);
    // Logical edges, so the pairing survives RTL along with the gesture.
    expect(next).not.toMatch(/left:|right:/);
    expect(learn).not.toMatch(/left:|right:/);
  });

  it('keeps each panel the colour of the control it replaced', () => {
    // The pills were gold-on-goldDeep and a green outline. Someone arriving
    // at these panels cold should not have to guess which is which.
    expect(styleBlock('intentNext')).toMatch(/backgroundColor: tc\.gold/);
    expect(styleBlock('intentLearn')).toMatch(/backgroundColor: tc\.success/);
  });

  it('drives the fade off the drag itself', () => {
    // Off `translate`, the same value the top card rides, so the promise
    // cannot lag the finger — and clamped, so dragging past the commit point
    // does not keep brightening something already fully lit.
    const s = src();
    expect(s).toMatch(/const nextIntent = translate\.interpolate\(/);
    expect(s).toMatch(/const learnIntent = translate\.interpolate\(/);
    expect(s).toMatch(/inputRange: \[0, INTENT_FULL_DX\]/);
    expect(s).toMatch(/inputRange: \[-INTENT_FULL_DX, 0\]/);
    expect((s.match(/extrapolate: 'clamp'/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('has no Next or Know it button left', () => {
    // Both are the gesture now. A button that duplicates a gesture is a second
    // thing to keep in step, and it cost a third of the deck's height.
    const s = src();
    expect(s).not.toMatch(/doLearn\('button'\)/);
    expect(s).not.toMatch(/doAdvance\('button'\)/);
    expect(s).not.toMatch(/pillFace|pillEdge|knowLabel|nextLabel/);
  });
});
