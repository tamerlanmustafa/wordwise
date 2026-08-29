import {
  reduceCollapse,
  makeCollapseReducer,
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

describe('reducer arity', () => {
  // The reducer is driven as `offsets.reduce(reduceCollapse, start)`, and
  // Array.prototype.reduce passes (acc, value, index, array). If thresholds
  // were ever added as a third *positional* parameter they would silently
  // receive the element index instead — hence the curried factory. This pins
  // that shape so the trap can't be reintroduced.
  it('exposes two-argument reducers safe to pass straight to Array.reduce', () => {
    expect(reduceCollapse).toHaveLength(2);
  });

  it('gives the same answer through Array.reduce as through direct calls', () => {
    const offsets = [0, 120, 300, 260, 900];
    const viaReduce = offsets.reduce(reduceCollapse, initialCollapseState);
    let viaCalls = initialCollapseState;
    for (const y of offsets) viaCalls = reduceCollapse(viaCalls, y);
    expect(viaReduce).toEqual(viaCalls);
  });
});

describe('makeCollapseReducer', () => {
  it('builds independent reducers from arbitrary thresholds', () => {
    const eager = makeCollapseReducer({
      minCollapseY: 0,
      collapseRun: 1,
      revealRun: 1,
      topY: 0,
    });
    expect(eager(initialCollapseState, 5).collapsed).toBe(true);

    const stubborn = makeCollapseReducer({
      minCollapseY: 10_000,
      collapseRun: 10_000,
      revealRun: 10_000,
      topY: 0,
    });
    expect(stubborn(initialCollapseState, 5).collapsed).toBe(false);
  });
});
