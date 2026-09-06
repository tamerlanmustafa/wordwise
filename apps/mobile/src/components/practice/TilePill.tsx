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
 * A rounded rectangle's *narrowest* vertical slice is at its flat left and
 * right edges (x=0 and x=`TILE_W`), where rounding has already eaten
 * `TILE_RADIUS` off both the top and the bottom: the local height there is
 * `TILE_H - 2 * TILE_RADIUS`, and it is never smaller than that anywhere else
 * on the shape (the corners themselves only add height back, up to the full
 * `TILE_H` a couple of pixels in from the edge). The edge layer is the same
 * shape, offset straight down by `TILE_EDGE` and nothing else, so the two
 * layers only stay seamless everywhere — no sliver of background showing
 * through at the tile's own left/right edges — as long as
 *
 *     TILE_EDGE <= TILE_H - 2 * TILE_RADIUS
 *
 * i.e. the edge can never sink further than the shape's narrowest slice is
 * tall. At `TILE_H` = 56 and `TILE_RADIUS` = 12 that ceiling is 32; the tile
 * uses `TILE_EDGE` = 24, an 8pt margin under the limit rather than sitting
 * exactly on it.
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
/** Corner radius. Shallow on purpose — see the arithmetic above — so the
 *  tile reads as a rectangular step rather than a pill. */
export const TILE_RADIUS = 12;
/** Depth of the edge under the face, and how far the face travels on press.
 *  Tall enough to read as a stair's riser rather than a hairline lip — see
 *  the arithmetic above for why it stays under `TILE_H - 2 * TILE_RADIUS`. */
export const TILE_EDGE = 24;
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
  layer: {
    position: 'absolute',
    start: 0,
    width: TILE_W,
    height: TILE_H,
    // See the corner-radius/edge-depth arithmetic in the file docblock: this
    // has to stay <= (TILE_H - TILE_EDGE) / 2 for the edge to never peek
    // through at the tile's own left/right edges.
    borderRadius: TILE_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  edge: {
    top: TILE_EDGE,
  },
  face: {
    top: 0,
  },
  facePressed: {
    transform: [{ translateY: TILE_EDGE }],
  },
});
