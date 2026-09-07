/**
 * TilePill — the pressable body every practice tile is drawn on.
 *
 * Two layers and nothing else: a face, and an edge under it in a darker tone.
 * Pressing sinks the face onto the edge, so the button physically depresses
 * instead of dimming. It is the same construction the quiz MCQ choices and
 * the word deck's buttons use (`MCQChoice`'s tile/edge, `pillFace` /
 * `pillEdge` in WordCardDeck) — one shape, one darker copy of it offset down
 * — and it is deliberately the same, because every "button you press down"
 * in this app should be built the same way.
 *
 * A long, shallow-cornered rectangle now, not a capsule: the path reads as a
 * staircase of steps rather than a chain of pills. Each tile's edge is tall
 * enough to read as a riser — the vertical face of a stair — rather than a
 * thin lip, and its tiles sit flush against each other with no gap, so
 * consecutive steps read as a continuous flight rather than floating tiles.
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
 * ## Why the gradients went
 *
 * There were four more effects layered on to sell the depth on the coin this
 * replaced: a vertical gradient across the face, a white rim that faded out
 * by the equator, a specular oval near the top, and a second gradient on the
 * edge. They were doing the work the offset already does, and each one was a
 * place for the two shapes to disagree. The whole thing was drawn in SVG to
 * make them possible; without them it is two views, which also means it costs
 * no SVG root per tile on a path that mounts a dozen.
 */

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

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

export interface TilePillProps {
  /** Face colour, flat. */
  face: string;
  /** Edge colour. Always darker than the face — that difference *is* the
   *  thickness, now that nothing else is drawing it. */
  edge: string;
  /** Face pushed down onto its edge while a finger is on it. */
  pressed?: boolean;
  /** Centred on the face, and a child of it, so it sinks on press without a
   *  transform of its own. */
  children?: ReactNode;
}

export function TilePill({ face, edge, pressed = false, children }: TilePillProps) {
  return (
    <View style={styles.body}>
      {/* Static. Only the face moves, which is what makes the press read as
          depth rather than as the whole tile sliding down. */}
      <View style={[styles.layer, styles.edge, { backgroundColor: edge }]} pointerEvents="none" />
      <View
        style={[
          styles.layer,
          styles.face,
          { backgroundColor: face },
          pressed && styles.facePressed,
        ]}
      >
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
  },
  face: {
    top: 0,
    borderRadius: TILE_RADIUS,
  },
  facePressed: {
    transform: [{ translateY: TILE_EDGE }],
  },
});
