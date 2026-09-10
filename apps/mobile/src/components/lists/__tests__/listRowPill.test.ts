/**
 * A list row is a pill: a face over a darker edge, sinking under a finger.
 *
 * The same object the film-feed card is, and the same rim — `goldOnSurface`
 * over `nodeGoldEdge`. What differs is height: a card is a fixed 116pt, a list
 * row grows with however many lines of text landed in it. That is why the rows
 * go through `ui/PressablePill` (which sizes to its content) rather than
 * restating the card's fixed-height layers, and why the primitive exists at
 * all — this was the sixth place about to hand-roll the same three views.
 *
 * Source-reading, not rendering: mobile tests are logic + integration only, so
 * like `cardPress.test.ts` and `deckCardRim.test.ts` this asserts on source.
 */

import fs from 'fs';
import path from 'path';
import { METRICS } from '../listStyles';
import { CARD_EDGE, CARD_RADIUS } from '../../filmFeed/cardVisuals';

const read = (...p: string[]) =>
  fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');

const row = () => read('lists', 'ListRow.tsx');
const pill = () => read('ui', 'PressablePill.tsx');
const index = () => read('screens', 'ListsIndexScreen.tsx');

/**
 * The body of one `StyleSheet.create` entry, by name.
 *
 * Counts braces rather than looking for a `\n  },` terminator. The files this
 * reads nest their stylesheets at different depths and write some entries on
 * one line, and a fixed terminator gets both wrong: against a more deeply
 * indented block it runs past the end and swallows the styles after it, which
 * is how the first version of this file reported an `elevation` belonging to a
 * style three entries further down. A negative assertion that reads too much
 * source fails loudly; one that reads too little passes while the thing it
 * guards is broken, so this is worth getting right rather than approximating.
 */
function styleBlock(src: string, name: string): string {
  const opener = src.match(new RegExp(`(^|[\\s{])${name}: \\{`, 'm'));
  if (!opener || opener.index === undefined) throw new Error(`no style named ${name}`);
  const from = src.indexOf('{', opener.index);
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(from, i + 1);
  }
  throw new Error(`could not find the end of ${name}`);
}

/**
 * Source with its comments removed — both `//` and `/* *\/` — for the negative
 * assertions below.
 *
 * A guard that says "this must not appear here" reads the whole block,
 * comments included, so the comment explaining *why* something is absent fails
 * the very test it documents. This file hit that twice: once on the word
 * `elevation` in a line comment, once on `withTap` inside a doc block.
 * Stripping them means an explanation can name the thing it is explaining,
 * which is the point of writing one.
 */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('the row wears the film-feed card’s rim and edge', () => {
  it('takes both colours from the same tokens the card does', () => {
    // Not a light/dark branch and not a hex pair: the palette already answers
    // that, and a frozen pair here is another place to miss when gold moves.
    const s = row();
    expect(styleBlock(s, 'row')).toMatch(/borderColor: tc\.goldOnSurface/);
    expect(s).toMatch(/edge=\{tc\.nodeGoldEdge\}/);
    expect(s).not.toMatch(/borderColor: isDark \?/);
  });

  it('keeps the hairline at 1pt, like the card', () => {
    expect(styleBlock(row(), 'row')).toMatch(/borderWidth: 1,/);
  });

  it('sinks by the card’s depth, not the practice path’s riser', () => {
    // 4 is a button you tap. The path's 24 is a stair tread you climb, and a
    // 24pt lip under a list row would read as a shelf it is sitting on.
    expect(METRICS.rowEdge).toBe(CARD_EDGE);
  });

  it('rounds the same amount as the card', () => {
    expect(METRICS.rowRadius).toBe(CARD_RADIUS);
  });
});

describe('the face and the edge stay separate jobs', () => {
  it('paints on the face and lays out on the slot', () => {
    // Margin on the face would put the gap inside the pill, between the face
    // and its own edge.
    const slot = styleBlock(row(), 'slot');
    expect(slot).toMatch(/marginBottom: METRICS\.rowGap/);
    expect(styleBlock(row(), 'row')).not.toMatch(/marginBottom/);
  });

  it('casts one shadow, from the edge rather than the face', () => {
    // A blurred shadow under the face plus a hard edge beneath it is two depth
    // cues at once, and the face's would fall on its own edge.
    expect(styleBlock(row(), 'row')).not.toMatch(/shadowOpacity/);
    expect(styleBlock(row(), 'edgeShadow')).toMatch(/shadowOpacity/);
    expect(row()).toMatch(/shadow=\{s\.edgeShadow\}/);
  });

  it('puts no elevation on an edge layer, in either pill', () => {
    // The Android trap, and the reason this assertion covers the film-feed
    // card too. `elevation` sets z-order there, so an elevated edge draws
    // ABOVE the face beside it and the whole surface renders as a solid block
    // of edge colour with a few points of content showing at the top. The
    // film-feed card shipped that way for two commits.
    expect(code(styleBlock(row(), 'edgeShadow'))).not.toMatch(/elevation:/);
    const card = read('filmFeed', 'RankedMovieList.tsx');
    expect(code(styleBlock(card, 'cardEdge'))).not.toMatch(/elevation:/);
  });

  it('is no longer a TouchableOpacity fading to 85%', () => {
    const s = row();
    expect(s).not.toMatch(/TouchableOpacity/);
    expect(s).not.toMatch(/activeOpacity/);
  });

  it('buzzes once, wrapped on the element that owns the press', () => {
    // The row had no haptic at all, and it wraps the callback it is handed, so
    // the screen that hands it one must not wrap as well.
    //
    // Scoped to the ListRow call site rather than to the whole file: the
    // screen has its own buttons (Retry, New list) that own their presses and
    // do wrap, and a file-wide ban read as "this screen may not have haptics",
    // which is the opposite of the rule.
    expect(row()).toMatch(/onPress=\{withTap\(onPress\)\}/);
    // Through `code()` like every other assertion here: the call site carries a
    // comment explaining why it is bare, and that comment names `withTap`.
    const stripped = code(index());
    const usage = stripped.slice(stripped.indexOf('<ListRow'));
    expect(usage.slice(0, usage.indexOf('/>'))).not.toMatch(/withTap/);
  });
});

describe('PressablePill', () => {
  it('moves only the face — the edge is static', () => {
    // If both layers moved, the pill would slide down the page instead of
    // compressing, which is a different gesture entirely.
    const p = pill();
    const edge = p.slice(p.indexOf('StyleSheet.absoluteFill'), p.indexOf('<Animated.View'));
    expect(edge).not.toMatch(/transform/);
    expect(p).toMatch(/<Animated\.View[\s\S]{0,200}translateY: press\.interpolate/);
  });

  it('stops the face one point short of the edge’s bottom', () => {
    // A face that lands flush reads as the button vanishing rather than as it
    // bottoming out — the same -1 the quiz CTA and the MCQ choices use.
    const p = pill();
    expect(p).toMatch(/const PRESS_SHORTFALL = 1/);
    expect(p).toMatch(/outputRange: \[0, edgeDepth - PRESS_SHORTFALL\]/);
  });

  it('reserves the depth in the flow, so a press shifts nothing below', () => {
    expect(pill()).toMatch(/<View style=\{\{ height: edgeDepth \}\}/);
  });

  it('offsets the edge by exactly the depth, at the face’s radius', () => {
    // absoluteFill then `top: edgeDepth` leaves the edge exactly the face's
    // height — the two layers are the same rectangle, which is what keeps them
    // seamless at the corners.
    expect(pill()).toMatch(/\{ top: edgeDepth, borderRadius: radius, backgroundColor: edge \}/);
  });

  it('holds the press value across re-renders', () => {
    // A pill that re-renders mid-press (a poster landing, a count resolving)
    // must not get a fresh Animated.Value and snap back up under the finger.
    expect(pill()).toMatch(/const press = useRef\(new Animated\.Value\(0\)\)\.current/);
  });

  it('fires no haptic of its own, so a caller’s withTap cannot double up', () => {
    // The opposite contract to PressableScale, which owns its haptic. That
    // difference is the reason they are two components.
    expect(code(pill())).not.toMatch(/from '\.\.\/\.\.\/utils\/feedback'/);
    expect(code(pill())).not.toMatch(/withTap|feedback\./);
  });

  it('lets a caller keep its own press-in work', () => {
    // The film-feed card prefetches images on press-in; any pill adopting this
    // primitive has to be able to do the same alongside the sink.
    const p = pill();
    expect(p).toMatch(/onPressIn\?\.\(e\)/);
    expect(p).toMatch(/onPressOut\?\.\(e\)/);
  });
});

describe('the loading placeholder is the size of the row it stands in for', () => {
  it('reserves the full painted block, edge included', () => {
    expect(index()).toMatch(/height=\{METRICS\.rowMinHeight \+ METRICS\.rowEdge\}/);
  });

  it('carries the same gap the real rows do', () => {
    expect(styleBlock(index(), 'rowSkeleton')).toMatch(/marginBottom: METRICS\.rowGap/);
  });

  it('states no dimension of its own', () => {
    // The house rule: a skeleton reads the real component's numbers or the
    // list jumps the moment the data lands.
    const skeleton = index().slice(index().indexOf('<Skeleton'), index().indexOf('/>', index().indexOf('<Skeleton')));
    expect(skeleton).not.toMatch(/height=\{\d/);
    expect(skeleton).not.toMatch(/radius=\{\d/);
  });
});
