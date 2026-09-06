import {
  buildWindow,
  offsetForIndex,
  sectionForIndex,
  isSectionStart,
  SECTION_SIZE,
} from '../PracticeTilePath';
describe('buildWindow', () => {
  it('renders 9 tiles for a fresh user (cursor=0): one active + eight locked', () => {
    const w = buildWindow(0);
    expect(w).toHaveLength(9);
    expect(w[0]).toEqual({ index: 0, state: 'active' });
    expect(w.slice(1).every((t) => t.state === 'locked')).toBe(true);
    expect(w.map((t) => t.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('shows one completed above when cursor=1', () => {
    const w = buildWindow(1);
    expect(w[0]).toEqual({ index: 0, state: 'completed' });
    expect(w[1]).toEqual({ index: 1, state: 'active' });
    expect(w.slice(2).every((t) => t.state === 'locked')).toBe(true);
  });

  it('caps completed-above at 2 once cursor >= 2', () => {
    const w = buildWindow(2);
    expect(w[0].state).toBe('completed');
    expect(w[1].state).toBe('completed');
    expect(w[2]).toEqual({ index: 2, state: 'active' });
    expect(w.slice(3).every((t) => t.state === 'locked')).toBe(true);
  });

  it('slides the window once cursor advances past 2', () => {
    const w = buildWindow(5);
    expect(w.map((t) => t.index)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(w[0].state).toBe('completed');
    expect(w[1].state).toBe('completed');
    expect(w[2]).toEqual({ index: 5, state: 'active' });
    expect(w.slice(3).every((t) => t.state === 'locked')).toBe(true);
  });

  it('carries only an index and a state — every tile is the same lesson', () => {
    // The path used to rotate three kinds, so a tile had to say which one
    // it was. One deck now, so a tile is purely a position on the path.
    const w = buildWindow(3);
    expect(w[2]).toEqual({ index: 3, state: 'active' });
    expect(Object.keys(w[0]).sort()).toEqual(['index', 'state']);
  });

  it('handles a high cursor far into many cycles', () => {
    const w = buildWindow(100);
    expect(w[2].index).toBe(100);
    expect(w[2].state).toBe('active');
    expect(w.filter((t) => t.state === 'completed')).toHaveLength(2);
    expect(w.filter((t) => t.state === 'locked')).toHaveLength(6);
    expect(w.filter((t) => t.state === 'active')).toHaveLength(1);
  });

  it('always shows the road ahead, never just the road behind', () => {
    // The window is what makes the tab read as a journey rather than a
    // button: shrink the tiles below the cursor and the path stops being one.
    for (const cursor of [0, 1, 7, 42]) {
      const ahead = buildWindow(cursor).filter((t) => t.state === 'locked');
      expect(ahead.length).toBeGreaterThanOrEqual(6);
    }
  });
});

describe('offsetForIndex (zigzag anchored to absolute index)', () => {
  it('is keyed on absolute index, repeating every 8', () => {
    expect(offsetForIndex(0)).toBe(0);
    expect(offsetForIndex(1)).toBe(28);
    expect(offsetForIndex(8)).toBe(offsetForIndex(0));
    expect(offsetForIndex(9)).toBe(offsetForIndex(1));
  });

  it('sways as a wave, so consecutive tiles lean into each other', () => {
    // The jitter it replaced ([0, 24, -16, 12, …]) crossed the centre line on
    // every step, which reads as noise once the trail of dots between tiles is
    // gone and the coins themselves have to describe the road.
    const wave = Array.from({ length: 8 }, (_, i) => offsetForIndex(i));
    expect(wave).toEqual([0, 28, 40, 28, 0, -28, -40, -28]);
    // One sign change per half-period, not one per step.
    const crossings = wave.filter((v, i) => i > 0 && Math.sign(v) * Math.sign(wave[i - 1]) < 0);
    expect(crossings).toHaveLength(0);
  });

  it('stays inside the narrowest phone the app supports', () => {
    // The pill is TILE_W (200) wide, on a 320pt screen with 18pt of page
    // padding on each side: an amplitude that clips would only show up on
    // hardware.
    const halfTile = 100;
    const halfScreen = 320 / 2 - 18;
    for (let i = 0; i < 8; i += 1) {
      expect(Math.abs(offsetForIndex(i)) + halfTile).toBeLessThanOrEqual(halfScreen);
    }
  });

  it('handles a defensively negative index', () => {
    // ((-1 % 8) + 8) % 8 === 7 → last offset.
    expect(offsetForIndex(-1)).toBe(-28);
  });

  it('scrolls the path shape as the cursor advances (not frozen)', () => {
    // The bug this fixes: keying the offset on the rendered slot made
    // every window an identical frozen shape. Keying on the absolute
    // index means consecutive cursors render a shifted zigzag.
    const shapeAt = (cursor: number) =>
      buildWindow(cursor).map((t) => offsetForIndex(t.index));
    expect(shapeAt(3)).not.toEqual(shapeAt(4));
  });
});

describe('section checkpoints', () => {
  it('groups indices into 1-based sections of SECTION_SIZE', () => {
    expect(sectionForIndex(0)).toBe(1);
    expect(sectionForIndex(SECTION_SIZE - 1)).toBe(1);
    expect(sectionForIndex(SECTION_SIZE)).toBe(2);
    expect(sectionForIndex(SECTION_SIZE * 2)).toBe(3);
  });

  it('marks only the first index of each section as a section start', () => {
    expect(isSectionStart(0)).toBe(true);
    expect(isSectionStart(SECTION_SIZE)).toBe(true);
    expect(isSectionStart(SECTION_SIZE * 2)).toBe(true);
    expect(isSectionStart(1)).toBe(false);
    expect(isSectionStart(SECTION_SIZE - 1)).toBe(false);
  });

  it('puts at most two dividers in one window', () => {
    // Each divider is ~30pt of vertical room. Three of them in a nine-tile
    // window would undo the density this window size exists for.
    for (const cursor of [0, 3, 4, 5, 12, 99]) {
      const dividers = buildWindow(cursor).filter((t) => isSectionStart(t.index));
      expect(dividers.length).toBeLessThanOrEqual(2);
    }
  });
});

// ── Why the screen waits for the cursor ────────────────────────────────────
//
// The store starts at 0 and hydrates from AsyncStorage a few milliseconds
// later. PracticeScreen holds the path back until then, and these are the
// assertions that say why: the first paint would not be a slightly different
// path, it would be a different set of tiles with the section dividers in
// different rows — a visible re-layout every time the tab is opened.
describe('the window before and after the cursor is known', () => {
  it('shows entirely different tiles', () => {
    const cold = buildWindow(0).map((t) => t.index);
    const real = buildWindow(34).map((t) => t.index);

    expect(cold).not.toEqual(real);
    expect(cold.filter((i) => real.includes(i))).toEqual([]);
  });

  it('puts the section dividers in different rows', () => {
    // Each divider is its own row, so one landing a slot earlier shifts every
    // tile below it — this is the part that reads as the header shoving the
    // path down.
    const dividerSlots = (cursor: number) =>
      buildWindow(cursor)
        .map((t, slot) => (isSectionStart(t.index) ? slot : -1))
        .filter((slot) => slot >= 0);

    expect(dividerSlots(0)).not.toEqual(dividerSlots(34));
  });

  it('starts the window at a different offset once there is progress', () => {
    // cursor 0 has nothing completed to show above it; a returning user does.
    expect(buildWindow(0)[0].index).toBe(0);
    expect(buildWindow(34)[0].index).toBeGreaterThan(0);
  });
});
