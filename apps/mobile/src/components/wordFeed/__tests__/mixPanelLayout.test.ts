/**
 * The mix panel does not scroll and clips what overflows, so "does it fit" is
 * a real correctness property rather than a polish one — an over-tall layout
 * on a small phone is a Done button the user cannot reach.
 *
 * The panel's height is handed to it by `exploreMetrics`, so these are the
 * heights that function actually produces: 285 on the reference phone, ~224 on
 * a 4.7" one, and 190 at the clamp's floor.
 */
import { exploreMetrics } from '../metrics';
import { mixPanelLayout } from '../mixPanelLayout';

const PAD = 14 + 16;

/** What the panel has to lay out in, after its own padding. */
const room = (height: number) => height - PAD;

describe('mixPanelLayout — it has to fit', () => {
  it.each([190, 200, 224, 240, 250, 260, 285])('fits inside a %ipt panel', (height) => {
    for (const hasNote of [false, true]) {
      expect(mixPanelLayout(height, hasNote).contentHeight).toBeLessThanOrEqual(room(height));
    }
  });

  it('fits on every panel height exploreMetrics can produce', () => {
    // Sweep the real input space rather than three sampled phones: viewport
    // from a 4.7" screen to a tall one, at both bar offsets.
    for (let viewport = 500; viewport <= 1000; viewport += 10) {
      for (const bottomOffset of [0, 64, 96]) {
        const { railHeight } = exploreMetrics({
          viewport,
          width: 375,
          topInset: 0,
          bottomOffset,
        });
        for (const hasNote of [false, true]) {
          const layout = mixPanelLayout(railHeight, hasNote);
          expect(layout.contentHeight).toBeLessThanOrEqual(room(railHeight));
        }
      }
    }
  });
});

describe('mixPanelLayout — the bar is the residual', () => {
  it('draws the bar at its design height on the reference panel', () => {
    expect(mixPanelLayout(285).barHeight).toBe(86);
  });

  it('never exceeds the design height however tall the panel gets', () => {
    expect(mixPanelLayout(400).barHeight).toBe(86);
  });

  it('shrinks the bar rather than clipping it on a compact panel', () => {
    const compact = mixPanelLayout(224).barHeight;
    expect(compact).toBeLessThan(86);
    expect(compact).toBeGreaterThanOrEqual(34);
  });

  it('holds the bar at its floor when there is nothing left to give', () => {
    expect(mixPanelLayout(190).barHeight).toBe(34);
  });
});

describe('mixPanelLayout — what gets cut first', () => {
  it('spends the second hint line only on a tall panel', () => {
    expect(mixPanelLayout(285).hintLines).toBe(2);
    expect(mixPanelLayout(250).hintLines).toBe(2);
    expect(mixPanelLayout(224).hintLines).toBe(1);
  });

  it('drops the thin-level note before it eats into the bar', () => {
    expect(mixPanelLayout(285, true).showsNote).toBe(true);
    expect(mixPanelLayout(285, true).barHeight).toBe(86);
    expect(mixPanelLayout(190, true).showsNote).toBe(false);
  });

  it('never claims a note it was not given', () => {
    for (const height of [190, 224, 285, 400]) {
      expect(mixPanelLayout(height, false).showsNote).toBe(false);
    }
  });
});
