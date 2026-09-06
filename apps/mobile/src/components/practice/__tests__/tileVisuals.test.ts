import fs from 'fs';
import path from 'path';
/**
 * Colour is the only thing telling the user where they are on the path.
 *
 * The tiles used to say it twice — a check glyph on the completed ones, a
 * START callout on the active one — over colours that already made both
 * obvious, plus a speech bubble that every tile shared and that therefore
 * distinguished nothing. All of that is gone, so the state → colour mapping
 * is now load-bearing on its own: get it wrong and a user cannot tell what
 * they have done from what they have not.
 *
 * The other property here is the one that keeps the tiles looking like
 * *objects*. `TilePill` builds a lit crown and a shaded base out of the single
 * face colour it is handed, and stacks that on a darker lip. A face and lip
 * that are equally bright is a flat pill with a smudge under it, so every
 * state's pair is checked rather than eyeballed once and trusted.
 */

import { themes, type ThemeColors } from '../../../theme/tokens';
import { tileVisual } from '../tileVisuals';
import { TILE_H, TILE_RADIUS, TILE_EDGE } from '../TilePill';

const THEMES: Array<[string, ThemeColors]> = [
  ['light', themes.light],
  ['dark', themes.dark],
];

/** Perceived brightness, 0–255. Rec. 601 weights — good enough to compare two
 *  tones of the same hue, which is all this file asks of it. */
function luminance(color: string): number {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  const rgbFn = /^rgba?\(([^)]+)\)$/i.exec(color.trim());
  let r: number, g: number, b: number;
  if (hex) {
    r = parseInt(hex[1].slice(0, 2), 16);
    g = parseInt(hex[1].slice(2, 4), 16);
    b = parseInt(hex[1].slice(4, 6), 16);
  } else if (rgbFn) {
    [r, g, b] = rgbFn[1].split(',').map((n) => parseInt(n.trim(), 10));
  } else {
    throw new Error(`Not a colour this test can read: ${color}`);
  }
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** How green a colour is, relative to its red — the cheap way to assert
 *  "this is the green one" without pinning a hex nobody may re-tune. */
function greenness(color: string): number {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!hex) throw new Error(`Not a hex colour: ${color}`);
  return parseInt(hex[1].slice(2, 4), 16) - parseInt(hex[1].slice(0, 2), 16);
}

describe.each(THEMES)('%s theme', (_name, tc) => {
  describe('a completed tile', () => {
    it('is green, not gold', () => {
      const done = tileVisual('completed', tc);

      expect(greenness(done.face)).toBeGreaterThan(0);
      expect(done.face).not.toBe(tc.gold);
    });

    it('carries no glyph — the colour is the whole message', () => {
      expect(tileVisual('completed', tc).glyph).toBeNull();
    });

    it('stays slightly receded, so the road behind you sits back', () => {
      expect(tileVisual('completed', tc).faded).toBe(true);
    });

    it('is the same object as every other tile, in a different colour', () => {
      // There is no second surface treatment any more. `TilePill` draws a flat
      // face over a darker edge and nothing else, so a state is exactly two
      // colours — which is what makes this mapping the whole design.
      const done = tileVisual('completed', tc);

      expect(Object.keys(done).sort()).toEqual(['edge', 'face', 'faded', 'glyph']);
    });
  });

  describe('the active tile', () => {
    it('is still gold', () => {
      // Deliberately unchanged: it is the one tile the user can tap, and it
      // already earns attention from the ring and the bounce.
      expect(tileVisual('active', tc).face).toBe(tc.gold);
    });

    it('carries no glyph either', () => {
      expect(tileVisual('active', tc).glyph).toBeNull();
    });

    it('is not faded — it is the one tile in focus', () => {
      expect(tileVisual('active', tc).faded).toBe(false);
    });
  });

  describe('locked tiles', () => {
    it('are stone with nothing on them', () => {
      const locked = tileVisual('locked', tc);

      expect(locked.face).toBe(tc.nodeLocked);
      expect(locked.glyph).toBeNull();
    });

    it('keep full opacity even so', () => {
      // Their colours are already dim; fading them on top of that made the
      // road ahead disappear rather than recede.
      expect(tileVisual('locked', tc).faded).toBe(false);
    });
  });

  describe('the repair tile', () => {
    it('keeps its alarm — it is an interruption, not a position', () => {
      const repair = tileVisual('repair', tc);

      expect(repair.glyph).toBe('alarm');
      expect(repair.face).toBe(tc.error);
    });
  });

  describe('every state still reads as a solid object', () => {
    const states = ['active', 'completed', 'locked', 'repair'] as const;

    it.each(states)('%s has a lip darker than its face', (state) => {
      const { face, edge } = tileVisual(state, tc);

      expect(luminance(edge)).toBeLessThan(luminance(face));
    });

    // The lit states are the ones that have to read as pressable objects. A
    // few points of difference reads as an anti-aliasing artefact rather than
    // as thickness; the gold pair sits around 40, and that is the bar the new
    // green had to clear to look like the same coin.
    //
    // `locked` is deliberately excluded. Those tiles are the road *ahead* —
    // dim and unpressable on purpose — and the dark theme's pair sits around
    // 14. That is a design decision this change did not touch, and asserting
    // the lit threshold over it would be a test demanding a redesign nobody
    // asked for.
    it.each(states.filter((s) => s !== 'locked'))(
      '%s has a lip that is visibly darker, not a hairline',
      (state) => {
        const { face, edge } = tileVisual(state, tc);

        expect(luminance(face) - luminance(edge)).toBeGreaterThan(20);
      },
    );
  });

  it('gives every state a distinguishable face', () => {
    const faces = (['active', 'completed', 'locked', 'repair'] as const).map(
      (s) => tileVisual(s, tc).face,
    );

    expect(new Set(faces).size).toBe(faces.length);
  });
});

describe('the tile is built like the deck buttons', () => {
  const pill = () =>
    fs.readFileSync(path.join(__dirname, '..', 'TilePill.tsx'), 'utf8');
  const deck = () =>
    fs.readFileSync(
      path.join(__dirname, '..', '..', 'vocabulary', 'WordCardDeck.tsx'),
      'utf8',
    );

  it('never lets the edge peek through at the tile\'s own left/right edges', () => {
    // A rounded rectangle's narrowest vertical slice is at its flat left and
    // right sides, where rounding has already eaten TILE_RADIUS off both the
    // top and the bottom: local height there is TILE_H - 2*TILE_RADIUS, and
    // it is never smaller than that anywhere else on the shape. The edge
    // layer is the same shape offset straight down by TILE_EDGE, so the two
    // only stay seamless everywhere as long as the edge never sinks further
    // than that narrowest slice is tall.
    expect(TILE_EDGE).toBeLessThanOrEqual(TILE_H - 2 * TILE_RADIUS);
  });

  it('draws a face over an edge and nothing else', () => {
    // The gradient, the fading rim, the specular oval and the edge's own
    // second gradient were all doing the work the offset already does, and
    // each was a place for the two shapes to disagree.
    //
    // Comments stripped: this bans the *names* of those effects, and the file
    // explains in prose which ones it dropped. Reading the explanation as if
    // it were code is how a guard fails on the change it was written for.
    const code = pill().replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    expect(code).not.toMatch(/LinearGradient|Stop |stopOpacity|specular|gloss|matte/i);
    expect(code).not.toMatch(/\bshade\(/);
  });

  it('moves only the face on press, by exactly the edge depth', () => {
    // Sinking both would read as the whole tile sliding down rather than as a
    // button depressing. Same rule the deck's pills follow.
    expect(pill()).toMatch(/facePressed: \{\s*\n\s*transform: \[\{ translateY: TILE_EDGE \}\]/);
    expect(deck()).toMatch(/pillFacePressed: \{\s*\n\s*transform: \[\{ translateY: PILL_EDGE_PRESSED_DROP \}\]/);
  });

  it('keeps the edge static under the moving face', () => {
    const s = pill();
    const edgeAt = s.indexOf('styles.edge');
    expect(s.slice(edgeAt - 200, edgeAt)).toMatch(/Static/);
    expect(s).toMatch(/styles\.edge, \{ backgroundColor: edge \}\] \} pointerEvents="none"|styles\.edge, \{ backgroundColor: edge \}\]\} pointerEvents="none"/);
  });
});

describe('the tile is a long pill, alone, and lands when tapped', () => {
  const pill = () =>
    fs.readFileSync(path.join(__dirname, '..', 'TilePill.tsx'), 'utf8');
  const tile = () =>
    fs.readFileSync(path.join(__dirname, '..', 'PracticeTile.tsx'), 'utf8');
  const crack = () =>
    fs.readFileSync(path.join(__dirname, '..', 'TileCrack.tsx'), 'utf8');

  it('is wider than it is tall, with corners shallow enough to read as a step', () => {
    const s = pill();
    expect(s).toMatch(/export const TILE_W = 200/);
    expect(s).toMatch(/export const TILE_H = 56/);
    expect(s).toMatch(/borderRadius: TILE_RADIUS/);
    // Rectangular, not a pill: a full capsule would need TILE_RADIUS === TILE_H / 2.
    expect(TILE_RADIUS).toBeLessThan(TILE_H / 2);
    expect(s).not.toMatch(/<Ellipse|react-native-svg/);
  });

  it('has no ring turning around it any more', () => {
    // The bounce already marks the one tappable tile. A second permanent
    // animation on the same object was two things competing to say one thing.
    expect(fs.existsSync(path.join(__dirname, '..', 'TileRing.tsx'))).toBe(false);
    const s = tile();
    expect(s).not.toMatch(/TileRing|RING_SIZE|ringLayer|rotate/);
  });

  it('stops bouncing once struck, and never restarts for that mount', () => {
    // The tap is a commitment; a tile that keeps hovering after you have
    // chosen it is still asking to be chosen.
    const s = tile();
    expect(s).toMatch(/if \(state !== 'active' \|\| struck\) return;/);
    expect(s).toMatch(/\}, \[state, struck, bounce\]\)/);
  });

  it('marks the floor on press-in, not on press', () => {
    // `onPress` fires on release, by which time the navigation this tile
    // starts is already under way and there is nothing left to watch.
    expect(tile()).toMatch(/onPressIn=\{tappable \? \(\) => setStruck\(true\) : undefined\}/);
  });

  it('draws the crack under the tile, so the fissures come out from beneath', () => {
    // Rendered before the pill and anchored to its baseline: the tile's own
    // body covers every line's origin and only what escapes is visible.
    const s = tile();
    expect(s.indexOf('<TileCrack')).toBeLessThan(s.indexOf('<TilePill'));
    expect(crack()).toMatch(/bottom: 0/);
  });

  it('inks the crack from the text token, so it survives both themes', () => {
    // A fixed dark crack is invisible on a near-black floor. Inverting with
    // the theme gives a dark fissure on light and a lit one on dark.
    expect(crack()).toMatch(/withAlpha\(tc\.text, 0\.34\)/);
  });

  it('animates the crack on the native driver only', () => {
    // A tap here starts a navigation; the mark must not compete with it.
    const s = crack();
    expect(s).not.toMatch(/useNativeDriver:\s*false/);
    expect(s).toMatch(/opacity: progress/);
  });
});
