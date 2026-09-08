/**
 * The practice path reads as a flight of stairs, or it reads as a stack of
 * pills. Nothing in between, and almost nothing here is a colour choice.
 *
 * Two halves, for the two ways this breaks:
 *
 *  1. **The values**, which are pure and can be asserted directly: how heavy
 *     each state's occlusion band is, which tile is allowed a loud lock, which
 *     side a check falls on.
 *  2. **The drawing**, which needs the source. Every failure mode in this
 *     design is a *direction* — a shadow at the bottom of the tread instead of
 *     the top, a highlight above the stroke instead of below it, a mark drawn
 *     under the face instead of on it. Each one still renders, still looks
 *     deliberate on a screenshot, and is wrong. No runtime assertion reaches
 *     them (mobile tests carry no render library on purpose — see
 *     `mobile-test-conventions`), so the source scan is what stands in.
 */

import fs from 'fs';
import path from 'path';

import { themes, shade, type ThemeColors } from '../../../theme/tokens';
import { tileVisual, tileMark } from '../tileVisuals';
import {
  CHECK_BOX,
  CHECK_FLOOR_DARKEN,
  CHECK_FLOOR_W,
  CHECK_LIP_W,
  LOCK_INK,
  MARK_TOP,
  SCUFF_H,
  SCUFF_START,
  SCUFF_W,
  markSideForIndex,
  mirroredStart,
} from '../TileMarks';
import {
  NOSING_H,
  NOSING_INSET,
  RISER_FOOT_DARKEN,
  TILE_H,
  TILE_RADIUS,
  TILE_W,
  TREAD_BAND_H,
} from '../TilePill';

const THEMES: Array<[string, ThemeColors]> = [
  ['light', themes.light],
  ['dark', themes.dark],
];

const src = (file: string) =>
  fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

/** Rec. 601 brightness, 0–255 — enough to compare two tones of one hue. */
function luminance(color: string): number {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  const fn = /^rgba?\(([^)]+)\)$/i.exec(color.trim());
  let r: number, g: number, b: number;
  if (hex) {
    r = parseInt(hex[1].slice(0, 2), 16);
    g = parseInt(hex[1].slice(2, 4), 16);
    b = parseInt(hex[1].slice(4, 6), 16);
  } else if (fn) {
    [r, g, b] = fn[1].split(',').map((n) => parseFloat(n.trim()));
  } else {
    throw new Error(`Not a colour this test can read: ${color}`);
  }
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Alpha out of an `rgba()` string. */
function alpha(color: string): number {
  const m = /^rgba\(([^)]+)\)$/i.exec(color.trim());
  if (!m) throw new Error(`Not an rgba colour: ${color}`);
  return parseFloat(m[1].split(',')[3]);
}

// ── The depth cues ───────────────────────────────────────────────────────────

describe.each(THEMES)('%s theme — the stair depth cues', (_name, tc) => {
  const band = (s: Parameters<typeof tileVisual>[0]) => tileVisual(s, tc).band;
  const nosing = (s: Parameters<typeof tileVisual>[0]) => tileVisual(s, tc).nosing;

  it('shades the road ahead hardest and the tile in focus least', () => {
    // This ordering is the whole reason the values are per-state rather than
    // one constant. The band is what makes a tile recede; the locked tiles are
    // the ones that should, and the active tile is the one that must not.
    expect(band('locked')).toBeGreaterThan(band('completed'));
    expect(band('completed')).toBeGreaterThan(band('active'));
  });

  it('lights the front lip in exactly the opposite order', () => {
    // A tile deep in shadow does not also have a bright lip. Getting these two
    // ramps to run the same way is the shape of the bug: every tile ends up
    // equally lit and equally shaded, which is a texture rather than a depth.
    expect(nosing('active')).toBeGreaterThan(nosing('completed'));
    expect(nosing('completed')).toBeGreaterThan(nosing('locked'));
  });

  it.each(['active', 'completed', 'locked', 'repair'] as const)(
    '%s keeps both alphas inside 0–1',
    (state) => {
      const v = tileVisual(state, tc);
      for (const a of [v.band, v.nosing]) {
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
      }
    },
  );

  it('lights the repair tile like the tile in focus, not like the road ahead', () => {
    // It is asking to be acted on now. A tile receding into the distance is
    // the opposite claim.
    expect(tileVisual('repair', tc).band).toBe(tileVisual('active', tc).band);
    expect(tileVisual('repair', tc).nosing).toBe(tileVisual('active', tc).nosing);
  });

  it('grades the riser darker at its foot than where it meets the tread', () => {
    for (const state of ['active', 'completed', 'locked', 'repair'] as const) {
      const { edge } = tileVisual(state, tc);
      expect(luminance(shade(edge, -RISER_FOOT_DARKEN))).toBeLessThan(luminance(edge));
    }
  });

  it('keeps the riser foot darker than the tread above it', () => {
    // The riser already had to be darker than the face; grading it must not
    // find a way to overshoot back past that and light the tile from below.
    for (const state of ['active', 'completed', 'locked', 'repair'] as const) {
      const { face, edge } = tileVisual(state, tc);
      expect(luminance(shade(edge, -RISER_FOOT_DARKEN))).toBeLessThan(luminance(face));
    }
  });
});

// ── Which mark, and where ────────────────────────────────────────────────────

describe('tileMark', () => {
  it('gives each position on the path its own mark', () => {
    expect(tileMark('completed')).toBe('check');
    expect(tileMark('active')).toBe('start');
    expect(tileMark('locked')).toBe('lock');
  });

  it('leaves the repair tile to its alarm', () => {
    // It is an interruption, not a position. A groove as well would be the
    // same thing said twice on the one tile that is already shouting.
    expect(tileMark('repair')).toBeNull();
  });

  it('locks every upcoming tile by default', () => {
    expect(tileMark('locked', { nextUp: false })).toBe('lock');
    expect(tileMark('locked', { nextUp: true })).toBe('lock');
  });

  it('keeps only the next step locked when marksOnAllLocked is off', () => {
    // The quiet road: one lock directly above you, bare stone beyond it.
    expect(tileMark('locked', { marksOnAllLocked: false, nextUp: true })).toBe('lock');
    expect(tileMark('locked', { marksOnAllLocked: false, nextUp: false })).toBeNull();
  });

  it('never lets that switch reach the tiles it is not about', () => {
    const off = { marksOnAllLocked: false, nextUp: false };
    expect(tileMark('completed', off)).toBe('check');
    expect(tileMark('active', off)).toBe('start');
  });
});

describe('markSideForIndex', () => {
  it('alternates, so the scuff does not draw a stripe down the flight', () => {
    // The check is centred on every tile now, so breaking that stripe is the
    // scuff's whole job — this is the only thing that varies down the path.
    expect(markSideForIndex(0)).toBe('right');
    expect(markSideForIndex(1)).toBe('left');
    expect(markSideForIndex(2)).toBe('right');
  });

  it('is keyed on the absolute index, like the zigzag', () => {
    // Keyed on the rendered slot instead, every mark would flip sides each
    // time the window slid by one — the same bug `offsetForIndex` documents.
    expect(markSideForIndex(8)).toBe(markSideForIndex(0));
    expect(markSideForIndex(9)).toBe(markSideForIndex(1));
  });

  it('handles a defensively negative index', () => {
    expect(markSideForIndex(-1)).toBe('left');
    expect(markSideForIndex(-2)).toBe('right');
  });
});

describe('the check is centred and the scuff works around it', () => {
  const sides = ['left', 'right'] as const;

  it('centres the check on both axes, exactly where the lock and START sit', () => {
    // All three marks share one home. That is what makes the states read as
    // one family rather than three differently-placed badges — and on a 56pt
    // tread a 30pt box centres to MARK_TOP, so the scuff keeps its baseline.
    expect(MARK_TOP).toBe((TILE_H - CHECK_BOX) / 2);
  });

  it('mirrors the two scuff positions about the tread centre', () => {
    const centres = sides.map((s) => SCUFF_START[s] + SCUFF_W / 2);
    expect(centres[0] + centres[1]).toBeCloseTo(TILE_W, 6);
  });

  it('keeps the scuff clear of the centred check on both sides', () => {
    // They are drawn in one face with no layout between them; overlap would
    // put a footprint under the check and read as a smudge on the groove.
    const checkStart = (TILE_W - CHECK_BOX) / 2;
    for (const side of sides) {
      const scuffStart = SCUFF_START[side];
      const gap =
        scuffStart > checkStart
          ? scuffStart - (checkStart + CHECK_BOX)
          : checkStart - (scuffStart + SCUFF_W);
      expect(gap).toBeGreaterThanOrEqual(8);
    }
  });

  it('keeps both marks inside the tread, which crops anything that is not', () => {
    // The face clips its children (it has to, or the occlusion band grows
    // square corners), so a mark that overruns is silently cut rather than
    // overflowing — which looks intentional in a screenshot.
    for (const side of sides) {
      for (const [start, w] of [
        [(TILE_W - CHECK_BOX) / 2, CHECK_BOX],
        [SCUFF_START[side], SCUFF_W],
      ] as const) {
        expect(start).toBeGreaterThanOrEqual(0);
        expect(start + w).toBeLessThanOrEqual(TILE_W);
      }
      expect(MARK_TOP).toBeGreaterThanOrEqual(0);
      expect(MARK_TOP + Math.max(CHECK_BOX, SCUFF_H)).toBeLessThanOrEqual(TILE_H);
    }
  });

  it('derives the leading scuff rather than typing a second number', () => {
    expect(SCUFF_START.left).toBe(mirroredStart(SCUFF_START.right, SCUFF_W, SCUFF_W));
  });

  it('clears the lit nosing, so a footprint never lands on the tread lip', () => {
    expect(MARK_TOP + Math.max(CHECK_BOX, SCUFF_H)).toBeLessThanOrEqual(TILE_H - NOSING_H);
  });
});

describe('the groove floor is the tile in shadow, not a second colour', () => {
  it.each(THEMES)('%s: reads darker than the face it is cut into', (_name, tc) => {
    const floor = shade(tc.nodeDone, -CHECK_FLOOR_DARKEN);
    expect(luminance(floor)).toBeLessThan(luminance(tc.nodeDone));
  });

  it('leaves the lips wider than the floor they flank', () => {
    // Equal widths and the floor covers both lips, which is a flat glyph in
    // three passes — the exact thing this construction exists to avoid.
    expect(CHECK_FLOOR_W).toBeLessThan(CHECK_LIP_W);
  });
});

describe('only the next step is a loud lock', () => {
  it('cuts the next-up tile deeper on both layers', () => {
    expect(alpha(LOCK_INK.nextUp.light)).toBeGreaterThan(alpha(LOCK_INK.base.light));
    expect(alpha(LOCK_INK.nextUp.dark)).toBeGreaterThan(alpha(LOCK_INK.base.dark));
  });

  it('keeps even the loud one quiet in absolute terms', () => {
    // Barely legible at arm's length is the target. A lock the user can read
    // across the room turns the road ahead into a wall.
    expect(alpha(LOCK_INK.nextUp.light)).toBeLessThan(0.25);
  });
});

// ── The drawing ──────────────────────────────────────────────────────────────

describe('the tread is drawn as a step under another step', () => {
  const pill = () => src('TilePill.tsx');

  it('puts the occlusion band at the TOP of the tread and the nosing at the BOTTOM', () => {
    // The one that renders perfectly and reads inside out. The shadow belongs
    // where the step above meets this one; the lit lip belongs on the front
    // edge. Swap them and the flight appears to be lit from underneath.
    const s = pill();
    const band = s.slice(s.indexOf('treadBand: {'), s.indexOf('nosing: {'));
    const nosing = s.slice(s.indexOf('nosing: {'));

    expect(band).toMatch(/top: 0,/);
    expect(band).not.toMatch(/bottom:/);
    expect(nosing).toMatch(/bottom: 0,/);
    expect(nosing).not.toMatch(/top:/);
  });

  it('fades the band to nothing rather than ending it on an edge', () => {
    // A flat band is a stripe painted across the tile. Only the falloff reads
    // as a shadow.
    expect(pill()).toMatch(/colors=\{\[`rgba\(0,0,0,\$\{band \* d\}\)`, 'rgba\(0,0,0,0\)'\]\}/);
  });

  it('clips the band to the face, so the tread does not grow square ears', () => {
    // The band is a full-width rectangle at y=0; the face's corners are
    // rounded. Without the clip the top two corners of every tile are dark
    // squares — and it is the sort of 12pt detail that survives a screenshot
    // review and does not survive a phone.
    const s = pill();
    const face = s.slice(s.indexOf('face: {'), s.indexOf('facePressed: {'));
    expect(face).toMatch(/borderRadius: TILE_RADIUS,/);
    expect(face).toMatch(/overflow: 'hidden',/);
  });

  it('stops the nosing before the corner starts curving', () => {
    // Past the radius the face's edge turns; a highlight that ran to the
    // corner would wrap it and read as a border rather than as a lip.
    expect(NOSING_INSET).toBe(TILE_RADIUS);
    expect(NOSING_H).toBeLessThan(TREAD_BAND_H);
  });

  it('keeps the band a band, not half the tread', () => {
    expect(TREAD_BAND_H).toBeLessThan(TILE_H / 2);
  });

  it('grades the riser from the state token rather than a frozen hex', () => {
    // Three states × two stops is six hexes that all stop tracking the palette
    // the moment anyone re-tunes an edge token.
    const s = pill();
    expect(s).toMatch(/colors=\{\[edge, shade\(edge, -RISER_FOOT_DARKEN\)\]\}/);
    expect(RISER_FOOT_DARKEN).toBeGreaterThan(0);
    expect(RISER_FOOT_DARKEN).toBeLessThan(1);
  });

  it('dials only the band and the nosing, never the riser', () => {
    // `depth` is a dial on how loudly the STACKING is asserted. The riser is
    // the tile's own thickness — a fact about the object — so turning depth
    // down must not make the tiles thinner.
    const s = pill();
    const riser = s.slice(s.indexOf('<LinearGradient'), s.indexOf('<View'));
    expect(riser).not.toMatch(/\* d\b/);
    expect(s).toMatch(/rgba\(0,0,0,\$\{band \* d\}\)/);
    expect(s).toMatch(/rgba\(255,255,255,\$\{nosing \* d\}\)/);
    expect(s).toMatch(/Math\.min\(Math\.max\(depth, 0\), 1\)/);
  });

  it('moves no geometry: same tile, same corners, same riser', () => {
    // Everything above is additive. If one of these has shifted, the change
    // stopped being a lighting change and became a redesign.
    expect([TILE_W, TILE_H, TILE_RADIUS]).toEqual([200, 56, 12]);
  });
});

describe('a mark is engraved, not embossed', () => {
  const marks = () => src('TileMarks.tsx');

  /** Where the transform attached to the layer inked `color` sits. */
  function transformAfter(color: string): string {
    const s = marks();
    const at = s.indexOf(color);
    expect(at).toBeGreaterThan(-1);
    return s.slice(at, at + 240);
  }

  it('offsets the dark lip UP and the light lip DOWN', () => {
    // The single most reversible line in the whole design. Both directions
    // render; one reads as a groove cut into stone and the other as a badge
    // stuck on top of it, and only the second disagrees with the tread shadow
    // two millimetres above it.
    expect(transformAfter('rgba(0,0,0,0.46)')).toMatch(/transform="translate\(0, -0\.4\)"/);
    expect(transformAfter('rgba(255,255,255,0.44)')).toMatch(/transform="translate\(0, 1\)"/);
  });

  it('draws the floor last and un-transformed, so the lips flank it', () => {
    const s = marks();
    expect(s.indexOf('rgba(0,0,0,0.46)')).toBeLessThan(s.indexOf('rgba(255,255,255,0.44)'));
    expect(s.indexOf('rgba(255,255,255,0.44)')).toBeLessThan(s.indexOf('CHECK_FLOOR_DARKEN)}'));
  });

  it('puts the lock highlight below the shadow too', () => {
    // Same rule, one layer thinner: light from above means the lit copy sits
    // lower, so the light layer takes the positive offset.
    const s = marks();
    const light = s.slice(s.indexOf('lockLight: {'), s.indexOf('lockDark: {'));
    const dark = s.slice(s.indexOf('lockDark: {'));
    expect(light).toMatch(/top: LOCK_LIP,/);
    expect(dark).toMatch(/top: 0,/);
  });

  it('punches the keyhole through the dark layer only, in the tile face colour', () => {
    // A keyhole on both layers is a smudge; one in its own dark ink is a mark
    // on the lock rather than a hole through it.
    const s = marks();
    expect(s).toMatch(/<LockShape color=\{light\} \/>/);
    expect(s).toMatch(/<LockShape color=\{dark\} keyhole=\{tc\.nodeLocked\} \/>/);
  });

  it('softens the scuff with radial gradients, not a blur that does not exist', () => {
    // Comments stripped first: the file names both banned techniques in prose
    // to say why it is not using them, and reading the explanation as if it
    // were code is how a guard fails on the change it was written for.
    const s = marks().replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    expect(s).not.toMatch(/feGaussianBlur|filter:\s*blur/);
    expect(s.match(/<RadialGradient/g)).toHaveLength(2);
  });

  it('asks the palette for the letterpress ink instead of inventing a brown', () => {
    expect(marks()).not.toMatch(/#4A2C00/i);
    expect(marks()).toMatch(/color: tc\.goldDeep/);
  });

  it('stacks two copies of the label, because Text carries one shadow', () => {
    // React Native takes a single `textShadow*` set per Text, and a letterpress
    // needs two: dark above the glyph, light below it.
    const s = marks();
    expect(s.match(/textShadowColor/g)).toHaveLength(2);
    expect(s).toMatch(/textShadowOffset: \{ width: 0, height: 1\.5 \}/);
    expect(s).toMatch(/textShadowOffset: \{ width: 0, height: -1 \}/);
    // Radius 0 is dropped outright by Android's shadow layer.
    expect(s).not.toMatch(/textShadowRadius: 0,/);
  });

  it('sets the label in the family the app actually ships', () => {
    // The design calls for JetBrains Mono. The app loads no custom fonts, so
    // naming it would resolve to the platform SANS and lose the mono entirely
    // — `MONO_FAMILY` is Menlo/monospace, which is the intent that survives.
    const s = marks();
    expect(s).not.toMatch(/JetBrainsMono/);
    expect(s).toMatch(/fontFamily: MONO_FAMILY/);
  });

  it('cancels the trailing letter-space so the word sits on centre', () => {
    const s = marks();
    expect(s).toMatch(/letterSpacing: 4\.6,/);
    expect(s).toMatch(/paddingStart: 4\.6,/);
  });

  it('translates the label rather than hardcoding one language of it', () => {
    expect(marks()).toMatch(/t\('start'\)/);
  });

  it('never lets a mark push the face out of shape', () => {
    // Every mark is absolutely positioned. A mark in normal flow would fight
    // the face's `justifyContent: 'center'` and shift the repair alarm.
    const s = marks();
    const styles = s.slice(s.indexOf('const styles = StyleSheet.create'));
    expect(styles.match(/position: 'absolute'/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

describe('the flight casts one shadow, not nine', () => {
  it('hangs it on the column, never on a tile', () => {
    // Nine shadows is nine objects lying on a floor. One is a staircase
    // standing on it, and the difference is which view owns the property.
    expect(src('PracticeTilePath.tsx')).toMatch(/shadowOpacity: 0\.55/);
    for (const file of ['PracticeTile.tsx', 'TilePill.tsx']) {
      expect(src(file)).not.toMatch(/shadowOpacity|shadowRadius|elevation/);
    }
  });

  it('leaves the column transparent, so iOS shadows the silhouette', () => {
    // The zigzag is what should fall on the floor. Give this view a
    // background and iOS shadows its bounding box instead — a tall rounded
    // rectangle behind the path.
    const s = src('PracticeTilePath.tsx');
    const wrap = s.slice(s.indexOf('wrap: {'), s.indexOf('tileRow: {'));
    expect(wrap).not.toMatch(/backgroundColor/);
    expect(wrap).toMatch(/\.\.\.FLIGHT_SHADOW,/);
  });

  it('never reaches for elevation on Android', () => {
    // `elevation` shadows the bounding box, and on a tile it also takes over
    // z-ordering — which lifts each riser above the face meant to cover it.
    // Documented in the film-feed card, which shipped that way for two commits.
    expect(src('PracticeTilePath.tsx')).not.toMatch(/^\s*elevation:/m);
  });
});
