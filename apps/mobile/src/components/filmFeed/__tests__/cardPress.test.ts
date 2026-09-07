/**
 * The film-feed card is a button you press down, not one that dims.
 *
 * Every pressable surface in this app is built the same way — a face, and a
 * darker copy of the same shape offset straight down, which the face sinks
 * onto under a finger. `practice/TilePill` states the rule and the quiz's
 * `MCQCard` CTA, `MCQChoice` and `SessionComplete` all follow it. The feed
 * card was the odd one out: a `TouchableOpacity` fading to 90% opacity.
 *
 * Source-reading, not rendering: mobile tests are logic + integration only, so
 * like `nextButtonDesign.test.ts` and `tileVisuals.test.ts` this asserts on
 * the component's source.
 */

import fs from 'fs';
import path from 'path';
import { CARD_BLOCK, CARD_EDGE, CARD_H, CARD_RADIUS } from '../cardVisuals';

const card = () =>
  fs.readFileSync(path.join(__dirname, '..', 'RankedMovieList.tsx'), 'utf8');

describe('the card depresses rather than dimming', () => {
  it('is a Pressable driving a press value, not an activeOpacity fade', () => {
    const s = card();
    expect(s).toMatch(/<Pressable\s+style=\{s\.cardBody\}/);
    expect(s).toMatch(/onPressIn=\{\(\) => \{/);
    expect(s).toMatch(/press\.setValue\(1\)/);
    expect(s).toMatch(/onPressOut=\{\(\) => press\.setValue\(0\)\}/);
  });

  it('still prefetches the images it always did on press-in', () => {
    // The press handler grew a second job; the original one must survive it.
    expect(card()).toMatch(/prefetchMovieImages\(movie\);/);
  });

  it('sinks the face onto the edge by the edge depth, less one', () => {
    // A face that lands flush with the edge's bottom reads as the button
    // vanishing rather than as it bottoming out — the same -1 the quiz CTA
    // and the MCQ choices use.
    expect(card()).toMatch(
      /outputRange: \[0, CARD_EDGE - 1\]/,
    );
  });

  it('moves only the face — the edge is static', () => {
    // If both layers moved, the whole card would slide down the page instead
    // of compressing, which is a different gesture entirely.
    const s = card();
    const edge = s.slice(s.indexOf('cardEdge: {'), s.indexOf('    card: {'));
    expect(edge).not.toMatch(/transform/);
  });

  it('covers the whole painted block when swiped, not just the face', () => {
    // A revealed swipe action 4pt shorter than the card shows the page
    // through its bottom edge.
    expect(card()).toMatch(/height=\{CARD_BLOCK\}/);
  });

  it('keeps the haptic on the press, wrapped once', () => {
    // Every pressable gets one buzz. `withTap` on the card's own onPress, and
    // not a second one inside the handler.
    const s = card();
    expect(s).toMatch(/onPress=\{withTap\(onPress\)\}/);
  });
});

describe('the two layers are the same rectangle', () => {
  it('gives the edge the face radius, offset by exactly the edge depth', () => {
    const s = card();
    const edge = s.slice(s.indexOf('cardEdge: {'), s.indexOf('    card: {'));
    expect(edge).toMatch(/top: CARD_EDGE,/);
    expect(edge).toMatch(/bottom: 0,/);
    expect(edge).toMatch(/borderRadius: CARD_RADIUS,/);
  });

  it('reserves the depth in the block so a press shifts nothing below it', () => {
    const s = card();
    expect(s).toMatch(/cardBody: \{\s*\n\s*height: CARD_BLOCK,/);
    // Slot is face + edge, so `top: CARD_EDGE / bottom: 0` is exactly CARD_H.
    expect(CARD_BLOCK - CARD_EDGE).toBe(CARD_H);
  });

  it('casts one shadow, from the edge rather than the face', () => {
    // A blurred shadow under the face plus a hard edge beneath it is two
    // depth cues drawn at once, and the face's would fall on its own edge.
    const s = card();
    const edge = s.slice(s.indexOf('cardEdge: {'), s.indexOf('    card: {'));
    const face = s.slice(s.indexOf('    card: {'), s.indexOf('backdropWrap'));
    expect(edge).toMatch(/shadowOpacity/);
    expect(face).not.toMatch(/shadowOpacity/);
  });

  it('takes both its colours from tokens, so both themes come free', () => {
    // The rim and the edge are the ones "Knew it" wears (`knowFace` /
    // `knowEdge` in WordCardDeck). Tokens, not hexes and not a light/dark
    // branch: the palette already answers that question, and a frozen pair
    // here is two more places to miss when the accent moves.
    const s = card();
    expect(s).toMatch(/const edgeColor = tc\.nodeGoldEdge/);
    expect(s).toMatch(/borderColor: tc\.goldOnSurface/);
    expect(s).not.toMatch(/borderColor: isDark \?/);
  });

  it('holds the press value across re-renders', () => {
    // A card that re-renders mid-press (its ring resolving, a poster landing)
    // must not get a fresh Animated.Value and snap back up under the finger.
    expect(card()).toMatch(/const press = useRef\(new Animated\.Value\(0\)\)\.current/);
  });
});

describe('geometry stays inside what the shape allows', () => {
  it('never sinks further than the corner radius leaves room for', () => {
    expect(CARD_EDGE).toBeLessThanOrEqual(CARD_H - 2 * CARD_RADIUS);
  });

  it('uses the tap-button depth, not the practice path riser', () => {
    // 4 matches the quiz CTA. The path's 24 is a stair tread you climb; a
    // feed card is a button you tap, and a 24pt lip under it would read as a
    // shelf the card is sitting on.
    expect(CARD_EDGE).toBe(4);
  });
});
