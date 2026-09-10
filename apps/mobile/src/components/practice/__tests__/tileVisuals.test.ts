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
import { TILE_H, TILE_RADIUS, TILE_EDGE, TILE_EDGE_RADIUS } from '../TilePill';

/**
 * One palette, both appearances.
 *
 * These used to run twice, once per theme, because the tile faces came from
 * whichever `ThemeColors` the caller handed in. They do not any more: a
 * practice tile is the same object on a cream page as on a black one, taken
 * from the dark palette it was designed against. So the assertions below check
 * the tiles against THAT palette, and `stairTiles.test.ts` carries the
 * separate contract that the appearance cannot change them.
 */
const tc: ThemeColors = themes.dark;

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

describe('the tile palette', () => {
  describe('a completed tile', () => {
    it('is green, not gold', () => {
      const done = tileVisual('completed');

      expect(greenness(done.face)).toBeGreaterThan(0);
      expect(done.face).not.toBe(tc.gold);
    });

    it('carries no glyph — the colour is the whole message', () => {
      expect(tileVisual('completed').glyph).toBeNull();
    });

    it('stays slightly receded, so the road behind you sits back', () => {
      expect(tileVisual('completed').faded).toBe(true);
    });

    it('is the same object as every other tile, in a different colour', () => {
      // Every state is described by the same six fields — two colours, two
      // depth alphas, a glyph and a fade. No state gets a treatment of its
      // own, which is what keeps the tiles reading as one flight of stone
      // rather than as four differently-built widgets in a row.
      const done = tileVisual('completed');

      expect(Object.keys(done).sort()).toEqual([
        'band',
        'edge',
        'face',
        'faded',
        'glyph',
        'markInk',
        'nosing',
      ]);
    });
  });

  describe('the active tile', () => {
    it('is still gold', () => {
      // Deliberately unchanged: it is the one tile the user can tap, and it
      // already earns attention from the ring and the bounce.
      expect(tileVisual('active').face).toBe(tc.gold);
    });

    it('carries no glyph either', () => {
      expect(tileVisual('active').glyph).toBeNull();
    });

    it('is not faded — it is the one tile in focus', () => {
      expect(tileVisual('active').faded).toBe(false);
    });
  });

  describe('locked tiles', () => {
    it('are stone with nothing on them', () => {
      const locked = tileVisual('locked');

      expect(locked.face).toBe(tc.nodeLocked);
      expect(locked.glyph).toBeNull();
    });

    it('keep full opacity even so', () => {
      // Their colours are already dim; fading them on top of that made the
      // road ahead disappear rather than recede.
      expect(tileVisual('locked').faded).toBe(false);
    });
  });

  describe('the repair tile', () => {
    it('keeps its alarm — it is an interruption, not a position', () => {
      const repair = tileVisual('repair');

      expect(repair.glyph).toBe('alarm');
      expect(repair.face).toBe(tc.error);
    });
  });

  describe('every state still reads as a solid object', () => {
    const states = ['active', 'completed', 'locked', 'repair'] as const;

    it.each(states)('%s has a lip darker than its face', (state) => {
      const { face, edge } = tileVisual(state);

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
        const { face, edge } = tileVisual(state);

        expect(luminance(face) - luminance(edge)).toBeGreaterThan(20);
      },
    );
  });

  it('gives every state a distinguishable face', () => {
    const faces = (['active', 'completed', 'locked', 'repair'] as const).map(
      (s) => tileVisual(s).face,
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
    // At the tile's flat left side the face runs from TILE_RADIUS to
    // TILE_H - TILE_RADIUS; the edge, pushed down by TILE_EDGE, starts at
    // TILE_EDGE + TILE_EDGE_RADIUS. The face covers the edge's top corner
    // only while the edge starts no lower than the face ends — otherwise a
    // sliver of background shows between them.
    //
    // The two radii are now independent, so this is the general form of the
    // old `TILE_H - 2 * TILE_RADIUS`: each radius spends from the same budget
    // at the same rate.
    expect(TILE_EDGE).toBeLessThanOrEqual(TILE_H - TILE_RADIUS - TILE_EDGE_RADIUS);
  });

  it('gives the face and the edge their own radius, on the layers themselves', () => {
    // A shared `layer` radius is what made them impossible to tune apart. If
    // the radius moves back onto `layer`, one of these two disappears and the
    // separation is silently gone.
    const s = pill();
    expect(s).toMatch(/face: \{\s*\n\s*top: 0,\s*\n\s*borderRadius: TILE_RADIUS,/);
    expect(s).toMatch(/edge: \{\s*\n\s*top: TILE_EDGE,\s*\n\s*borderRadius: TILE_EDGE_RADIUS,/);
    const layer = s.slice(s.indexOf('layer: {'), s.indexOf('edge: {'));
    expect(layer).not.toMatch(/borderRadius/);
  });

  it('starts the edge radius equal to the face, so the shape is unchanged', () => {
    // The split is a new dial, not a new look. Whoever turns it should be
    // the designer, not this refactor.
    expect(TILE_EDGE_RADIUS).toBe(TILE_RADIUS);
  });

  it('still models a flat tread, not a lit convex coin', () => {
    // The coin this replaced carried a gradient across the FACE, a white rim
    // that faded out by the equator, and a specular highlight near the top.
    // Those modelled a curved surface catching a point light, and a stair
    // tread is flat. They have not come back: the band and the nosing added
    // since describe the tread's relationship to its NEIGHBOURS — what is
    // above it, and where its front edge is — which is a different claim.
    //
    // Comments stripped: this bans the *names* of those effects, and the file
    // explains in prose which ones it dropped. Reading the explanation as if
    // it were code is how a guard fails on the change it was written for.
    const code = pill().replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    expect(code).not.toMatch(/specular|gloss|matte|rim/i);
    // One gradient down the riser and one at the top of the tread. A third
    // would be the face gradient coming back under another name.
    expect(code.match(/<LinearGradient/g)).toHaveLength(2);
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
    expect(s.slice(edgeAt - 400, edgeAt)).toMatch(/Static/);
    expect(s).toMatch(/\[styles\.layer, styles\.edge\]/);
    expect(s).toMatch(/pointerEvents="none"/);
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
    expect(s).toMatch(/borderRadius: TILE_RADIUS/);  // now on `face`
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

  it('marks the floor on press-in, and takes the mark back if the press is cancelled', () => {
    // Press-in, because `onPress` fires on release — by which time the
    // navigation this tile starts is already under way and there is nothing
    // left to watch.
    //
    // But press-in is not a commitment. Sliding a finger off cancels the
    // press, so the release has to be able to undo it, or the tile is left
    // permanently still and cracked after an action that never happened.
    // `pressLatch` owns the ordering; this only pins that all three handlers
    // are still wired to it.
    const s = tile();
    expect(s).toMatch(/onPressIn=/);
    expect(s).toMatch(/latch\.down\(\);\s*\n\s*setStruck\(true\);/);
    expect(s).toMatch(/onPress=/);
    expect(s).toMatch(/latch\.commit\(\);/);
    expect(s).toMatch(/onPressOut=/);
    expect(s).toMatch(/if \(latch\.settle\(\)\) setStruck\(false\);/);
  });

  it('rewinds the crack when the mark is taken back', () => {
    // Without the reset the value is left at 1, and the NEXT press opens the
    // crack with no animation — a bug that only appears on the second tap.
    expect(tile()).toMatch(/if \(!struck\) \{\s*\n\s*crack\.setValue\(0\);/);
  });

  it('clears the pending release check when the tile unmounts', () => {
    expect(tile()).toMatch(/clearTimeout\(releaseCheck\.current\)/);
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
