/**
 * The card behind shows its face while the top card slides.
 *
 * The deck used to be a stack of blank paper: dragging the top card aside
 * uncovered a rimmed rectangle with nothing on it, so a swipe was a jump —
 * you found out what you had advanced to only after you could no longer
 * choose not to. The near ghost now carries the next card's face, faded up by
 * the drag itself, which turns the same gesture into a decision the reader can
 * back out of.
 *
 * Two things are pinned here, and they fail in different ways:
 *
 *   • The ramp (`behindRevealRamp`) — pure, so it is evaluated directly. Its
 *     job is to be legible BEFORE the commit threshold, and symmetric, since
 *     "Knew it" and "Next" advance to the same card.
 *   • The wiring — source-read, because mobile tests are logic + integration
 *     only (see `deckCardRim.test.ts` for the same shape). What it guards is
 *     that the face shown is the ADVANCE target and that it rides the same
 *     native-driven value as the drag.
 */

import fs from 'fs';
import path from 'path';
import {
  BEHIND_REVEAL_FULL,
  BEHIND_REVEAL_START,
  behindRevealRamp,
  peekNextIndex,
  SWIPE_THRESHOLD,
} from '../deckLogic';

const DRAG_CLAMP = 160;
const ramp = behindRevealRamp(DRAG_CLAMP);

/** Evaluate the ramp the way Animated would: piecewise linear, clamped. */
function opacityAt(dx: number): number {
  const { inputRange, outputRange } = ramp;
  if (dx <= inputRange[0]) return outputRange[0];
  const last = inputRange.length - 1;
  if (dx >= inputRange[last]) return outputRange[last];
  for (let i = 0; i < last; i += 1) {
    const lo = inputRange[i];
    const hi = inputRange[i + 1];
    if (dx >= lo && dx <= hi) {
      const t = hi === lo ? 0 : (dx - lo) / (hi - lo);
      return outputRange[i] + t * (outputRange[i + 1] - outputRange[i]);
    }
  }
  return outputRange[last];
}

describe('behindRevealRamp', () => {
  it('is a valid Animated input range — strictly increasing', () => {
    // Animated throws on a non-monotonic inputRange, and it throws at the
    // moment a card mounts rather than at the moment the constants were
    // edited, so nothing points at the line that broke it.
    const { inputRange, outputRange } = ramp;
    expect(inputRange).toHaveLength(outputRange.length);
    for (let i = 1; i < inputRange.length; i += 1) {
      expect(inputRange[i]).toBeGreaterThan(inputRange[i - 1]);
    }
  });

  it('shows nothing on a deck at rest', () => {
    // The design is a stack of blank paper until the reader asks. A ghost
    // carrying type at rest competes with the card in front of it.
    expect(opacityAt(0)).toBe(0);
  });

  it('stays blank through the wobble of a touch that is not a drag', () => {
    expect(opacityAt(BEHIND_REVEAL_START - 1)).toBe(0);
    expect(opacityAt(-(BEHIND_REVEAL_START - 1))).toBe(0);
  });

  it('is fully legible before the swipe commits', () => {
    // The whole point is to inform the choice. Arriving at the same moment as
    // the commit would be a reveal nobody had time to read.
    expect(BEHIND_REVEAL_FULL).toBeLessThan(SWIPE_THRESHOLD);
    expect(opacityAt(SWIPE_THRESHOLD)).toBe(1);
    expect(opacityAt(-SWIPE_THRESHOLD)).toBe(1);
  });

  it('treats both commits alike', () => {
    // "Knew it" (toward the leading edge) and "Next" (toward the trailing one)
    // record different things but advance to the SAME card, so a preview on
    // one and not the other would teach that only one of them advances.
    for (const dx of [4, 12, 30, BEHIND_REVEAL_FULL, 120, DRAG_CLAMP]) {
      expect(opacityAt(-dx)).toBeCloseTo(opacityAt(dx), 6);
    }
  });

  it('rises with the drag rather than snapping', () => {
    const mid = opacityAt((BEHIND_REVEAL_START + BEHIND_REVEAL_FULL) / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('covers the whole of the drag it is given', () => {
    // The clamp is the furthest a finger can push the card. A ramp that ended
    // short of it would leave Animated extrapolating past its last stop.
    expect(ramp.inputRange[0]).toBe(-DRAG_CLAMP);
    expect(ramp.inputRange[ramp.inputRange.length - 1]).toBe(DRAG_CLAMP);
  });
});

describe('the face behind is the advance target', () => {
  it('wraps at the end of the deck, like the commits do', () => {
    // On the last card the reader is looking at card 1 coming round again.
    // Reading `index + 1` straight out of the list would show blank paper on
    // exactly the card where a preview is most surprising.
    const keys = ['a', 'b', 'c'];
    expect(peekNextIndex({ keys, index: 2 })).toBe(0);
    expect(peekNextIndex({ keys, index: 0 })).toBe(1);
  });

  it('has nothing behind it in a one-card deck', () => {
    expect(peekNextIndex({ keys: ['a'], index: 0 })).toBe(-1);
    expect(peekNextIndex({ keys: [], index: -1 })).toBe(-1);
  });
});

const deck = () => fs.readFileSync(path.join(__dirname, '..', 'WordCardDeck.tsx'), 'utf8');

describe('the deck wires the face to the drag', () => {
  it('takes the behind card from the same function the warm window uses', () => {
    // `warmWindowKeys` fetches the focused card and the one behind it. If the
    // card shown and the card fetched came from two different answers to
    // "what is next", the preview would be the one card guaranteed to be cold.
    expect(deck()).toMatch(/const behindIndex = peekNextIndex\(displayDeck\)/);
  });

  it('renders the shared static body, not a second copy of the anatomy', () => {
    // `renderStaticBody` is what the fly-away overlay draws too. Three faces,
    // one function — a second copy would drift and the card would pop at the
    // instant the ghost is promoted.
    expect(deck()).toMatch(/renderStaticBody\(behindItem\)/);
  });

  it('drives the reveal off the drag value, not off React state', () => {
    // A `useState` per move event would re-render sixty times a second, on the
    // JS thread, during the one gesture that must not drop a frame.
    expect(deck()).toMatch(/behindOpacity: translate\.interpolate\(behindRevealRamp\(DRAG_CLAMP\)\)/);
    expect(deck()).toMatch(/\{ opacity: behindOpacity \}/);
  });

  it('leaves the far ghost blank', () => {
    // Only its rim is ever visible — the near ghost covers it to within a few
    // points — so a face on it is work nobody can see.
    const src = deck();
    const far = src.indexOf('GHOSTS[1].top');
    const near = src.indexOf('GHOSTS[0].top');
    expect(far).toBeGreaterThan(-1);
    expect(near).toBeGreaterThan(far);
    expect(src.slice(far, near)).not.toMatch(/renderStaticBody/);
  });

  it('keeps the face out of the accessibility tree', () => {
    // Opacity is not something VoiceOver or TalkBack respect, and the two
    // platforms need different props to be told. Without both, the deck reads
    // out two words and two sentences and the reader cannot tell which card
    // the swipe is on.
    const src = deck();
    const near = src.indexOf('GHOSTS[0].top');
    const block = src.slice(src.lastIndexOf('{total > 1 ?', near), near);
    expect(block).toMatch(/accessibilityElementsHidden/);
    expect(block).toMatch(/importantForAccessibility="no-hide-descendants"/);
  });

  it('clips the face to the ghost rim', () => {
    // The ghost is inset 7pt each side, so a line that fitted the focused
    // card's width has nowhere to go here.
    const src = deck();
    const start = src.indexOf('    ghost: {');
    expect(src.slice(start, src.indexOf('\n    },', start))).toMatch(/overflow: 'hidden'/);
  });

  it('insets all three faces by the same constant', () => {
    // `ghost`, `card` (via `cardPress`) and `outgoingCard` are one card a
    // moment apart. Type that moved between them would read as a jump at the
    // instant of promotion rather than as a stack stepping forward.
    const src = deck();
    for (const name of ['ghostBody', 'cardPress', 'outgoingCard']) {
      const start = src.indexOf(`    ${name}: {`);
      expect(start).toBeGreaterThan(-1);
      expect(src.slice(start, src.indexOf('\n    },', start))).toMatch(
        /padding: CARD_PADDING,/,
      );
    }
  });
});
