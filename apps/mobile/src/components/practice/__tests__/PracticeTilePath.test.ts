import {
  buildWindow,
  offsetForIndex,
  visualOrder,
  sectionForIndex,
  isSectionStart,
  COMPLETED_BEHIND,
  LOCKED_AHEAD,
  SECTION_SIZE,
  WINDOW_SIZE,
} from '../PracticeTilePath';
describe('buildWindow', () => {
  it('renders a full window for a fresh user (cursor=0): one active + locked', () => {
    const w = buildWindow(0);
    expect(w).toHaveLength(WINDOW_SIZE);
    expect(w[0]).toEqual({ index: 0, state: 'active' });
    expect(w.slice(1).every((t) => t.state === 'locked')).toBe(true);
    expect(w.map((t) => t.index)).toEqual(
      Array.from({ length: WINDOW_SIZE }, (_, i) => i),
    );
  });

  it('shows one completed above when cursor=1', () => {
    const w = buildWindow(1);
    expect(w[0]).toEqual({ index: 0, state: 'completed' });
    expect(w[1]).toEqual({ index: 1, state: 'active' });
    expect(w.slice(2).every((t) => t.state === 'locked')).toBe(true);
  });

  it(`caps completed-below at ${COMPLETED_BEHIND} once the user is past it`, () => {
    const w = buildWindow(COMPLETED_BEHIND);
    expect(w.filter((t) => t.state === 'completed')).toHaveLength(COMPLETED_BEHIND);
    expect(w[COMPLETED_BEHIND]).toEqual({ index: COMPLETED_BEHIND, state: 'active' });
    expect(w.slice(COMPLETED_BEHIND + 1).every((t) => t.state === 'locked')).toBe(true);
  });

  it('slides the window once the cursor advances past the cap', () => {
    const cursor = COMPLETED_BEHIND + 3;
    const w = buildWindow(cursor);
    const start = cursor - COMPLETED_BEHIND;
    expect(w.map((t) => t.index)).toEqual(
      Array.from({ length: WINDOW_SIZE }, (_, i) => start + i),
    );
    expect(w[COMPLETED_BEHIND]).toEqual({ index: cursor, state: 'active' });
    expect(w.slice(0, COMPLETED_BEHIND).every((t) => t.state === 'completed')).toBe(true);
    expect(w.slice(COMPLETED_BEHIND + 1).every((t) => t.state === 'locked')).toBe(true);
  });

  it('puts the active tile 5th from the bottom of the path', () => {
    // The whole point of COMPLETED_BEHIND. `buildWindow` runs past → future
    // and `visualOrder` flips it, so "N completed below" in display order is
    // "N completed before" here — and the active tile lands in a fixed slot
    // counted up from the end of the rendered path.
    for (const cursor of [COMPLETED_BEHIND, 12, 99]) {
      const display = visualOrder(buildWindow(cursor));
      const fromBottom = display.length - display.findIndex((t) => t.state === 'active');
      expect(fromBottom).toBe(5);
    }
  });

  it('lets a new user sit lower rather than padding the slot', () => {
    // Day one has nothing behind you, and an empty row is a promise the path
    // cannot keep. The tile settles into its slot once four sessions are done.
    for (let cursor = 0; cursor < COMPLETED_BEHIND; cursor += 1) {
      const display = visualOrder(buildWindow(cursor));
      const fromBottom = display.length - display.findIndex((t) => t.state === 'active');
      expect(fromBottom).toBe(cursor + 1);
      expect(display).toHaveLength(WINDOW_SIZE);
    }
  });

  it('renders enough road ahead to scroll about three screens into', () => {
    // The shortest supported phone shows roughly eight 82pt tiles at once, and
    // four of the locked ones are already visible when the path opens at the
    // bottom. This is the assertion that fails if someone trims the window
    // back for render cost without noticing what it was sized for.
    const TILES_PER_SCREEN = 8;
    const VISIBLE_AHEAD_AT_REST = 4;
    expect(LOCKED_AHEAD - VISIBLE_AHEAD_AT_REST).toBeGreaterThanOrEqual(
      3 * TILES_PER_SCREEN,
    );
  });

  it('carries only an index and a state — every tile is the same lesson', () => {
    // The path used to rotate three kinds, so a tile had to say which one
    // it was. One deck now, so a tile is purely a position on the path.
    const w = buildWindow(3);
    expect(w[3]).toEqual({ index: 3, state: 'active' });
    expect(Object.keys(w[0]).sort()).toEqual(['index', 'state']);
  });

  it('handles a high cursor far into many cycles', () => {
    const w = buildWindow(100);
    expect(w[COMPLETED_BEHIND].index).toBe(100);
    expect(w[COMPLETED_BEHIND].state).toBe('active');
    expect(w.filter((t) => t.state === 'completed')).toHaveLength(COMPLETED_BEHIND);
    expect(w.filter((t) => t.state === 'locked')).toHaveLength(LOCKED_AHEAD);
    expect(w.filter((t) => t.state === 'active')).toHaveLength(1);
  });

  it('always shows the road ahead, never just the road behind', () => {
    // The window is what makes the tab read as a journey rather than a
    // button: shrink the tiles below the cursor and the path stops being one.
    for (const cursor of [0, 1, 7, 42]) {
      const ahead = buildWindow(cursor).filter((t) => t.state === 'locked');
      expect(ahead.length).toBeGreaterThanOrEqual(LOCKED_AHEAD);
    }
  });
});

describe('visualOrder (path climbs up the screen)', () => {
  it('renders future tiles first (top) and past tiles last (bottom)', () => {
    const display = visualOrder(buildWindow(5));
    const start = 5 - COMPLETED_BEHIND;
    expect(display.map((t) => t.index)).toEqual(
      Array.from({ length: WINDOW_SIZE }, (_, i) => start + WINDOW_SIZE - 1 - i),
    );
    // Topmost is the furthest future, bottommost the furthest past.
    expect(display[0].state).toBe('locked');
    expect(display[display.length - 1].state).toBe('completed');
  });

  it('keeps the active tile between the past below and the future above', () => {
    const display = visualOrder(buildWindow(5));
    const activeAt = display.findIndex((t) => t.state === 'active');
    expect(display.slice(0, activeAt).every((t) => t.state === 'locked')).toBe(true);
    expect(display.slice(activeAt + 1).every((t) => t.state === 'completed')).toBe(true);
  });

  it('does not mutate the window it is given', () => {
    const w = buildWindow(5);
    const before = w.map((t) => t.index);
    visualOrder(w);
    expect(w.map((t) => t.index)).toEqual(before);
    expect(before[0]).toBe(5 - COMPLETED_BEHIND);
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
    // The pill is 200pt wide, on a 320pt screen with 18pt of page
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
    // Past the cap, where the window actually slides. Below it the window is
    // still pinned at index 0 and consecutive cursors share a shape by design.
    expect(shapeAt(COMPLETED_BEHIND + 3)).not.toEqual(shapeAt(COMPLETED_BEHIND + 4));
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

  it('spaces dividers a whole section apart, however long the window gets', () => {
    // This used to cap dividers at two per window, which was really a
    // statement about a NINE-tile window's vertical room. The window is now
    // long enough to scroll through several screens, so the count is expected
    // to grow; what must stay true is the cadence — one divider every
    // SECTION_SIZE tiles, never two landing near each other.
    for (const cursor of [0, 3, 4, 5, 12, 99]) {
      const rows = buildWindow(cursor)
        .map((t, slot) => (isSectionStart(t.index) ? slot : -1))
        .filter((slot) => slot >= 0);
      for (let i = 1; i < rows.length; i += 1) {
        expect(rows[i] - rows[i - 1]).toBe(SECTION_SIZE);
      }
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
    const real = buildWindow(90).map((t) => t.index);

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

    expect(dividerSlots(0)).not.toEqual(dividerSlots(32));
  });

  it('starts the window at a different offset once there is progress', () => {
    // cursor 0 has nothing completed to show above it; a returning user does.
    expect(buildWindow(0)[0].index).toBe(0);
    expect(buildWindow(34)[0].index).toBeGreaterThan(0);
    expect(buildWindow(34)[0].index).toBe(34 - COMPLETED_BEHIND);
  });
});
