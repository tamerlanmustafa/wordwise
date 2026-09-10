/**
 * TilePill — the pressable body every practice tile is drawn on.
 *
 * A face over a riser. Pressing sinks the face onto the riser, so the button
 * physically depresses instead of dimming. It is the same construction the
 * quiz MCQ choices and the word deck's buttons use (`MCQChoice`'s tile/edge,
 * `pillFace` / `pillEdge` in WordCardDeck) — one shape, one darker copy of it
 * offset down — and it is deliberately the same, because every "button you
 * press down" in this app should be built the same way.
 *
 * A long, shallow-cornered rectangle, not a capsule, and its tiles sit flush
 * against each other with no gap: the path is meant to read as a flight of
 * stairs rather than a chain of pills.
 *
 * ## Why a face over a riser was not enough
 *
 * The offset alone gives you nine separate objects that each happen to have a
 * thickness. It does not give you a staircase, because in a real flight the
 * treads are not independent — each one sits *under* the one above it and is
 * lit accordingly. Three of the four things below are that relationship, and
 * they are what turn a stack into a flight:
 *
 *  1. **The tread occlusion band.** A shadow across the top of every tread,
 *     cast down onto it by the step above. This is the load-bearing one. It is
 *     what says "there is something above me"; without it every tile floats
 *     independently no matter how deep its own riser is.
 *  2. **The lit nosing.** A hairline highlight along the tread's front lip —
 *     the edge that catches the light the step above is blocking. Inset from
 *     both sides so it stops before the corner radius rather than wrapping
 *     around it, which is what a lip does and a border does not.
 *  3. **The graded riser.** The riser falls away from the tread, so it is
 *     darker at its foot than at its top rather than one flat tone.
 *  4. **One shadow under the whole flight**, not one per tile. That one lives
 *     in `PracticeTilePath`, because it is a property of the flight and not of
 *     any tile in it.
 *
 * The four are additive: the face and riser are exactly where they were, at
 * exactly the same size. Nothing here moves geometry.
 *
 * Every one of them is a *depth cue*, which is why they share the `depth`
 * dial: the honest version of "it is too much" is one number, turned once, in
 * one place — not three opacities re-tuned by hand until they disagree.
 *
 * ## The corner-radius / edge-depth arithmetic
 *
 * Look at the tile's flat left side, x=0. The face occupies y from
 * `TILE_RADIUS` down to `TILE_H - TILE_RADIUS` there — rounding has eaten the
 * rest. The edge is the same rectangle pushed down by `TILE_EDGE`, so at that
 * same x it starts at `TILE_EDGE + TILE_EDGE_RADIUS`.
 *
 * For the face to still cover the edge's top corner — no sliver of background
 * showing through between them at the tile's own left and right sides — the
 * edge has to start no lower than the face ends:
 *
 *     TILE_EDGE + TILE_EDGE_RADIUS <= TILE_H - TILE_RADIUS
 *
 * or, rearranged into the ceiling on how far the edge may sink:
 *
 *     TILE_EDGE <= TILE_H - TILE_RADIUS - TILE_EDGE_RADIUS
 *
 * Each radius costs the same as the other, which is the useful thing to know
 * when tuning them: rounding the edge's feet by 4 buys you exactly as much
 * headroom as rounding the face by 4 would, and spends it from the same
 * budget. At `TILE_H` = 56 with both radii at 12 the ceiling is 32. A test
 * asserts this rather than leaving it as a comment, because the failure is a
 * one-pixel seam that is easy to miss on a screenshot and obvious on a phone.
 *
 * ## What is still not here
 *
 * The coin this replaced carried a gradient across the *face*, a white rim
 * that faded out by the equator, and a specular oval near the top. Those went
 * and have not come back: they were modelling a lit convex disc, and a stair
 * tread is a flat surface seen from above. The band and the nosing describe
 * the tread's *relationship to its neighbours*, which is a different claim and
 * the only one the path needs.
 */

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { shade } from '../../theme/tokens';

/** Face width — long enough to read as a stair tread, not a coin. */
export const TILE_W = 200;
/** Face height. */
export const TILE_H = 56;
/** Corner radius of the FACE. Shallow on purpose — see the arithmetic above —
 *  so the tile reads as a rectangular step rather than a pill. */
export const TILE_RADIUS = 12;
/**
 * Corner radius of the EDGE, tunable independently of the face.
 *
 * Only the bottom corners of this ever show: the edge is the same rectangle
 * offset down by `TILE_EDGE`, so its top half sits behind the face and its
 * top radius is invisible whatever you set here. Raising it rounds off the
 * riser's feet; lowering it squares them under a still-rounded face.
 *
 * Equal to the face by default, which is the shape the path shipped with.
 */
export const TILE_EDGE_RADIUS = 12;
/** Depth of the edge under the face, and how far the face travels on press.
 *  Tall enough to read as a stair's riser rather than a hairline lip — see
 *  the arithmetic above for why it stays under
 *  `TILE_H - TILE_RADIUS - TILE_EDGE_RADIUS`. */
export const TILE_EDGE = 26;
/** Total painted height of one tile, face plus the edge showing beneath it. */
export const TILE_BLOCK = TILE_H + TILE_EDGE;
/** Side of the square box a glyph is drawn in, centred on the face. */
export const GLYPH_BOX = 24;

/** How far down the tread the occlusion band reaches before it has faded out.
 *  A little over a third of the tread: short enough to read as a cast edge
 *  rather than as the tile being two colours. */
export const TREAD_BAND_H = 20;
/** Thickness of the lit nosing along the tread's front lip. */
export const NOSING_H = 1.5;
/**
 * How far in from each side the nosing stops.
 *
 * Equal to the face radius, and that is the whole point: past this inset the
 * face's edge is curving away, so a highlight that ran to the corner would
 * wrap around it and read as a border rather than as a lip catching light.
 */
export const NOSING_INSET = TILE_RADIUS;
/** How much darker the riser is at its foot than at its top. The riser falls
 *  away from the tread rather than facing the same way it does. */
export const RISER_FOOT_DARKEN = 0.3;

/**
 * The outline around the whole tile.
 *
 * Both layers carry it, which is what makes it read as one border rather than
 * two. The riser is the lower, taller silhouette, so its outline draws the
 * tile's sides and its rounded feet; the face's outline draws the top and the
 * front lip where the tread meets the riser. Between them they trace the
 * complete shape.
 *
 * Before this the only line on the tile was the riser showing beneath the
 * face, which reads as a bottom border and nothing else — an outline on one
 * side of a shape looks like an unfinished border, not a deliberate one.
 */
export const TILE_BORDER_W = 2;
/**
 * How much darker than the riser the outline is.
 *
 * Derived rather than a fixed colour, so every tile state — gold, green,
 * stone, the repair red — gets an outline in its own family instead of a black
 * rectangle around it.
 *
 * Tuned on a device rather than picked: the riser is already the dark member
 * of each pair, so a gentle darkening of it disappeared into the tile on the
 * two states that matter most (gold, because it is the only one you tap, and
 * the locked stone, because it is nearly black to begin with). This is the two
 * knobs worth touching if the outline ever needs to be louder or quieter.
 */
export const TILE_BORDER_DARKEN = 0.72;

export interface TilePillProps {
  /** Face colour, flat. */
  face: string;
  /** Riser colour at its top, where it meets the tread. Always darker than
   *  the face — that difference *is* the thickness — and graded darker still
   *  toward the foot by {@link RISER_FOOT_DARKEN}. */
  edge: string;
  /** Alpha of the black occlusion band across the top of the tread. */
  band: number;
  /** Alpha of the white nosing along the tread's front lip. */
  nosing: number;
  /**
   * 0–1 dial on both depth cues, multiplied into the band and the nosing.
   *
   * Not into the riser gradient or the flight shadow: those two describe the
   * tile's own thickness and the flight's weight on the floor, which are facts
   * about the object. The band and the nosing describe how strongly the
   * *stacking* is being asserted, and that is the thing worth being able to
   * take back in one place after seeing it on a real screen.
   */
  depth?: number;
  /** Face pushed down onto its riser while a finger is on it. */
  pressed?: boolean;
  /** Centred on the face, and a child of it, so it sinks on press without a
   *  transform of its own. */
  children?: ReactNode;
}

export function TilePill({
  face,
  edge,
  band,
  nosing,
  depth = 1,
  pressed = false,
  children,
}: TilePillProps) {
  const d = Math.min(Math.max(depth, 0), 1);

  return (
    <View style={styles.body}>
      {/* Static. Only the face moves, which is what makes the press read as
          depth rather than as the whole tile sliding down. */}
      <LinearGradient
        colors={[edge, shade(edge, -RISER_FOOT_DARKEN)]}
        style={[
          styles.layer,
          styles.edge,
          { borderColor: shade(edge, -TILE_BORDER_DARKEN) },
        ]}
        pointerEvents="none"
      />
      <View
        style={[
          styles.layer,
          styles.face,
          { backgroundColor: face, borderColor: shade(edge, -TILE_BORDER_DARKEN) },
          pressed && styles.facePressed,
        ]}
      >
        {/* The shadow the step above casts down onto this tread. Clipped by
            the face's own radius — `overflow: 'hidden'` on `face` — so it
            follows the tread's corners instead of squaring them off. */}
        <LinearGradient
          colors={[`rgba(0,0,0,${band * d})`, 'rgba(0,0,0,0)']}
          style={styles.treadBand}
          pointerEvents="none"
        />
        {/* The front lip, catching the light the step above is blocking. */}
        <View
          style={[styles.nosing, { backgroundColor: `rgba(255,255,255,${nosing * d})` }]}
          pointerEvents="none"
        />
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    width: TILE_W,
    height: TILE_BLOCK,
  },
  // Everything the two layers share EXCEPT the corner radius — that is now
  // each layer's own, so the riser's feet can be tuned without reshaping the
  // face. See the arithmetic in the file docblock for how far they may
  // diverge before a seam opens at the tile's left and right sides.
  layer: {
    position: 'absolute',
    start: 0,
    width: TILE_W,
    height: TILE_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  edge: {
    top: TILE_EDGE,
    borderRadius: TILE_EDGE_RADIUS,
    borderWidth: TILE_BORDER_W,
    // Android clips a gradient to its own bounds, not to the border radius,
    // without this — which squares off the riser's feet under a rounded face.
    overflow: 'hidden',
  },
  face: {
    top: 0,
    borderRadius: TILE_RADIUS,
    borderWidth: TILE_BORDER_W,
    // Load-bearing: the band is a full-width rectangle at the top of the
    // tread, and this is the only thing rounding its top corners to match the
    // tile's. Without it the tread grows two dark square ears.
    overflow: 'hidden',
  },
  facePressed: {
    transform: [{ translateY: TILE_EDGE }],
  },
  treadBand: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: TREAD_BAND_H,
  },
  nosing: {
    position: 'absolute',
    bottom: 0,
    left: NOSING_INSET,
    right: NOSING_INSET,
    height: NOSING_H,
    borderRadius: 1,
  },
});
