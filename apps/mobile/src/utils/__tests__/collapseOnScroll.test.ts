import {
  reduceCollapse,
  initialCollapseState,
  type CollapseState,
  WORD_CARD_COLLAPSE_RUN,
  WORD_CARD_MIN_COLLAPSE_Y,
  WORD_CARD_REVEAL_RUN,
  WORD_CARD_TOP_Y,
} from '../collapseOnScroll';

// Feed a sequence of absolute scroll offsets through the reducer and return
// the final state — mirrors how onScroll drives it in HomeScreen.
function run(offsets: number[], start: CollapseState = initialCollapseState): CollapseState {
  return offsets.reduce(reduceCollapse, start);
}

describe('reduceCollapse', () => {
  it('starts expanded and stays expanded near the top', () => {
    expect(initialCollapseState.collapsed).toBe(false);
    expect(run([0, WORD_CARD_TOP_Y]).collapsed).toBe(false);
  });

  it('collapses after a sustained downward scroll past the minimum', () => {
    const y = WORD_CARD_MIN_COLLAPSE_Y + WORD_CARD_COLLAPSE_RUN + 10;
    expect(run([0, y]).collapsed).toBe(true);
  });

  it('does not collapse until the downward run passes the threshold', () => {
    let s: CollapseState = { collapsed: false, lastY: 200, run: 0 };
    s = reduceCollapse(s, 210); // +10
    s = reduceCollapse(s, 220); // +10 → run 20, still under COLLAPSE_RUN
    expect(s.collapsed).toBe(false);
    s = reduceCollapse(s, 235); // +15 → run 35 ≥ 30
    expect(s.collapsed).toBe(true);
  });

  it('reveals after scrolling back up ~a row, WITHOUT reaching the top', () => {
    // Scroll way down (collapsed), then scroll up by the reveal run while still
    // far from the top.
    const deep = 900;
    const collapsed = run([0, deep]);
    expect(collapsed.collapsed).toBe(true);
    const revealed = reduceCollapse(collapsed, deep - WORD_CARD_REVEAL_RUN - 5);
    expect(revealed.collapsed).toBe(false);
    // …and it happened mid-feed, nowhere near the top.
    expect(revealed.lastY).toBeGreaterThan(500);
  });

  it('holds collapsed on a small up-jitter below the reveal run', () => {
    const deep = 900;
    const collapsed = run([0, deep]);
    const jittered = reduceCollapse(collapsed, deep - 20);
    expect(jittered.collapsed).toBe(true);
  });

  it('re-collapses when the user scrolls down again after revealing', () => {
    const deep = 900;
    let s = run([0, deep]); // collapsed
    s = reduceCollapse(s, deep - WORD_CARD_REVEAL_RUN - 5); // revealed mid-feed
    expect(s.collapsed).toBe(false);
    s = reduceCollapse(s, deep - WORD_CARD_REVEAL_RUN - 5 + WORD_CARD_COLLAPSE_RUN + 5);
    expect(s.collapsed).toBe(true);
  });

  it('always reveals at the very top regardless of run', () => {
    const collapsed = run([0, 900]);
    expect(reduceCollapse(collapsed, WORD_CARD_TOP_Y).collapsed).toBe(false);
    expect(reduceCollapse(collapsed, 0).collapsed).toBe(false);
  });
});
