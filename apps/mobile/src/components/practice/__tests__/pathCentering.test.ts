/**
 * The Practice path opens with the active tile centred, on every screen, and
 * offers a way back once it has scrolled out of sight.
 *
 * Measured before: on a 667pt iPhone SE the tab opened with START 8pt under
 * the streak panel and no road ahead in view, because the path was parked at
 * its bottom with four completed tiles under the active one.
 */

import fs from 'fs';
import path from 'path';

import {
  activeTileSide,
  bottomRunway,
  centeredOffset,
  type PathViewport,
} from '../pathCentering';
import {
  COMPLETED_BEHIND,
  PATH_PAD_TOP,
  activeTileCenterY,
  buildWindow,
  pathBelowActiveCenter,
  visualOrder,
} from '../PracticeTilePath';
import { TILE_BLOCK } from '../TilePill';

/** Scroller heights (screen minus top inset minus the 100pt header) and the
 *  bar that covers each one's bottom — iPhone SE, 13 mini, 17 Pro, 17 Pro Max,
 *  and an Android phone with the pinned bar and 3-button navigation. */
const SCREENS: PathViewport[] = [
  { height: 547, bottomObstruction: 81 },
  { height: 662, bottomObstruction: 91 },
  { height: 712, bottomObstruction: 91 },
  { height: 794, bottomObstruction: 91 },
  { height: 516, bottomObstruction: 103 },
];
const CURSORS = [0, 1, 3, COMPLETED_BEHIND - 1, COMPLETED_BEHIND, COMPLETED_BEHIND + 1, 15, 99];
const MIN_PAD = 115;

describe('where the active tile is', () => {
  it('matches the row the window actually draws it in, at every cursor', () => {
    // The geometry is arithmetic rather than a measurement, so it has to agree
    // with `buildWindow`. It did not the first time: it assumed a constant
    // thirty rows above, but the window tops itself up with road ahead while
    // the history is short, and the path opened centred on tile 30-odd.
    for (const cursor of CURSORS) {
      const rows = visualOrder(buildWindow(cursor));
      const row = rows.findIndex((t) => t.state === 'active');
      expect(activeTileCenterY(cursor)).toBe(PATH_PAD_TOP + row * TILE_BLOCK + TILE_BLOCK / 2);

      const rowsBelow = rows.length - 1 - row;
      expect(pathBelowActiveCenter(cursor)).toBe(TILE_BLOCK / 2 + rowsBelow * TILE_BLOCK + 24);
    }
  });
});

describe('centeredOffset', () => {
  it('puts the tile in the middle of what is visible, not of the scroller', () => {
    // The bar is drawn over the scroller's bottom; the middle of the box is
    // half a bar lower than the middle of what the user can see.
    const v = { height: 712, bottomObstruction: 91 };
    const y = centeredOffset(2000, v);
    expect(y + (v.height - v.bottomObstruction) / 2).toBe(2000);
  });

  it('never asks for a negative offset', () => {
    expect(centeredOffset(40, { height: 712, bottomObstruction: 91 })).toBe(0);
  });
});

describe('bottomRunway', () => {
  it('lets the tile reach the middle on every screen, at every cursor', () => {
    // Without it a new user — nothing completed below — would have the tile
    // stuck near the bottom: the scroller cannot go past its content.
    for (const v of SCREENS) {
      for (const cursor of CURSORS) {
        const center = 8 + activeTileCenterY(cursor);
        const below = pathBelowActiveCenter(cursor);
        const content = center + below + bottomRunway(below, v, MIN_PAD);
        const y = centeredOffset(center, v);
        expect(y).toBeLessThanOrEqual(content - v.height);
      }
    }
  });

  it('adds nothing beyond the usual clearance when history already fills it', () => {
    const v = SCREENS[2];
    expect(bottomRunway(pathBelowActiveCenter(COMPLETED_BEHIND), v, MIN_PAD)).toBe(MIN_PAD);
  });

  it('pads a brand-new user', () => {
    const v = SCREENS[0];
    expect(bottomRunway(pathBelowActiveCenter(0), v, MIN_PAD)).toBeGreaterThan(MIN_PAD);
  });

  it('keeps the usual clearance before the scroller has a height', () => {
    expect(bottomRunway(0, { height: 0, bottomObstruction: 81 }, MIN_PAD)).toBe(MIN_PAD);
  });
});

describe('activeTileSide — when to offer the way back', () => {
  const v = { height: 712, bottomObstruction: 91 };
  const center = 2000;
  const rest = centeredOffset(center, v);

  it('offers nothing at rest', () => {
    expect(activeTileSide(rest, center, TILE_BLOCK, v)).toBeNull();
  });

  it('offers nothing while any of the tile is still on screen', () => {
    // A nudge is not lost. Bottom edge still one point inside the top.
    const y = center + TILE_BLOCK / 2 - 1;
    expect(activeTileSide(y, center, TILE_BLOCK, v)).toBeNull();
  });

  it('points up once the tile has left by the top — the user scrolled into history', () => {
    expect(activeTileSide(center + TILE_BLOCK / 2, center, TILE_BLOCK, v)).toBe('above');
  });

  it('points down once it has left by the bottom — the user climbed the road ahead', () => {
    const visible = v.height - v.bottomObstruction;
    expect(activeTileSide(center - TILE_BLOCK / 2 - visible, center, TILE_BLOCK, v)).toBe('below');
  });

  it('counts a tile under the bar as out of sight', () => {
    // It is behind a translucent capsule: visible, not reachable.
    const visible = v.height - v.bottomObstruction;
    const y = center - TILE_BLOCK / 2 - visible; // tile top at the bar's edge
    expect(activeTileSide(y + 1, center, TILE_BLOCK, v)).toBeNull();
    expect(activeTileSide(y, center, TILE_BLOCK, v)).toBe('below');
  });

  it('offers nothing before the scroller has a height', () => {
    expect(activeTileSide(99999, center, TILE_BLOCK, { height: 0, bottomObstruction: 91 })).toBeNull();
  });
});

describe('PracticeScreen wires it up', () => {
  const read = (...p: string[]) =>
    fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
  const screen = () => read('PracticeScreen.tsx');

  it('centres rather than parking the path at its bottom', () => {
    expect(screen()).not.toMatch(/scrollToEnd/);
    expect(screen()).toMatch(/centeredOffset\(activeCenterY, measured\)/);
    expect(screen()).toMatch(/paddingBottom: runway/);
  });

  it('centres once per cursor, so a scroll is never yanked back', () => {
    expect(screen()).toMatch(/if \(anchoredFor\.current === cursor\) return;/);
  });

  it('ignores the zero height a hidden tab reports', () => {
    expect(screen()).toMatch(/if \(h > 0 && h !== viewportH\)/);
  });

  it('clears the way-back button after a programmatic centring', () => {
    // A scroll without animation fires no scroll event.
    const s = screen();
    const fn = s.slice(s.indexOf('const centerPath'), s.indexOf('useEffect(() => {\n    centerPath();'));
    expect(fn).toMatch(/setTileSide\(null\)/);
  });

  it('draws the way-back button over the path', () => {
    expect(screen()).toMatch(/<BackToStartButton\s+side=\{tileSide\}\s+onPress=\{scrollBackToTile\}/);
  });

  it('does not redraw every tile when the screen around the path re-renders', () => {
    // Height, scroll side and the reveal all set state on the screen.
    expect(read('practice', 'PracticeTilePath.tsx')).toMatch(
      /export const PracticeTilePath = memo\(function PracticeTilePath/,
    );
  });
});
