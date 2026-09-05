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
 * *objects*. `TileCoin` builds a lit crown and a shaded base out of the single
 * face colour it is handed, and stacks that on a darker lip. A face and lip
 * that are equally bright is a flat circle with a smudge under it, so every
 * state's pair is checked rather than eyeballed once and trusted.
 */

import { themes, type ThemeColors } from '../../../theme/tokens';
import { tileVisual } from '../tileVisuals';

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

    it('keeps its gloss — a done tile is still a polished coin', () => {
      // Only the locked tiles are matte. Making the completed ones matte too
      // would have flattened the entire path behind the cursor.
      expect(tileVisual('completed', tc).matte).toBe(false);
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
    it('are matte stone with nothing on them', () => {
      const locked = tileVisual('locked', tc);

      expect(locked.face).toBe(tc.nodeLocked);
      expect(locked.matte).toBe(true);
      expect(locked.glyph).toBeNull();
    });

    it('keep full opacity despite being matte', () => {
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
    // `locked` is deliberately excluded. Matte tiles are the road *ahead* —
    // dim, flat and unpressable on purpose — and the dark theme's pair sits
    // around 14. That is a design decision this change did not touch, and
    // asserting the lit threshold over it would be a test demanding a
    // redesign nobody asked for.
    it.each(states.filter((s) => !tileVisual(s, tc).matte))(
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
