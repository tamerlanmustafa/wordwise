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
 * A long capsule now, not a coin: the path reads as rungs on a ladder rather
 * than a trail of dots, and its tiles now sit flush against each other with
 * no gap, so the capsule shape is what keeps two adjacent tiles from reading
 * as one fused block — the rounded ends are the only seam between them.
 *
 * ## Why a capsule, not an ellipse
 *
 * Its sides are straight for most of the width and its end caps are half the
 * *height* in radius, so an offset copy still overlaps everywhere and the
 * only thing visible below the face is an even band — which is exactly what
 * the illusion needs and all it needs. An ellipse narrows to a point at its
 * ends instead: near those points the face and the edge stop overlapping and
 * the background shows through between them.
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

/** Face width — long enough to read as a rung, not a coin. */
export const TILE_W = 200;
/** Face height. */
export const TILE_H = 56;
/** Depth of the edge under the face, and how far the face travels on press —
 *  the same 4pt the quiz MCQ choices use. */
export const TILE_EDGE = 4;
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
    // Half the *height* — the property that keeps this a capsule instead of
    // an ellipse regardless of how wide the face is.
    borderRadius: TILE_H / 2,
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
