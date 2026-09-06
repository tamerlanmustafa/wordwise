/**
 * TileCoin — the pressable body every practice tile is drawn on.
 *
 * Two layers and nothing else: a face, and an edge under it in a darker tone.
 * Pressing sinks the face onto the edge, so the button physically depresses
 * instead of dimming. It is the same construction the word deck's buttons use
 * (`pillFace` / `pillEdge` in WordCardDeck) — one shape, one darker copy of it
 * offset down — and it is deliberately the same, because two controls in one
 * app that are both "a button you press down" should be built the same way.
 *
 * ## Why it stopped being an ellipse
 *
 * The face and the edge used to be ellipses, one offset {@link COIN_EDGE}
 * below the other, and that produced a visible gap either side. An ellipse
 * narrows to a point at its left and right extremes: near those points the
 * face occupies a sliver of height around its own centre line and the edge
 * occupies a sliver around a centre line 8pt lower, so the two shapes stop
 * overlapping and the background shows through between them. The result read
 * as a cave under each side of the coin rather than as thickness.
 *
 * A capsule does not have that failure. Its sides are straight for most of
 * the height and its end caps are half the height in radius, so an offset
 * copy still overlaps everywhere and the only thing visible below the face is
 * an even band — which is exactly what the illusion needs and all it needs.
 *
 * ## Why the gradients went
 *
 * There were four more effects layered on to sell the depth: a vertical
 * gradient across the face, a white rim that faded out by the equator, a
 * specular oval near the top, and a second gradient on the edge. They were
 * doing the work the offset already does, and each one was a place for the
 * two shapes to disagree. The whole thing was drawn in SVG to make them
 * possible; without them it is two views, which also means it costs no SVG
 * root per tile on a path that mounts a dozen.
 */

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

/** Face width. */
export const COIN_W = 72;
/** Face height. Also the corner radius, twice over — this is a capsule. */
export const COIN_H = 56;
/** Depth of the edge under the face, and how far the face travels on press. */
export const COIN_EDGE = 8;
/** Total painted height of one tile, face plus the edge showing beneath it. */
export const COIN_BLOCK = COIN_H + COIN_EDGE;
/** Side of the square box a glyph is drawn in, centred on the face. */
export const GLYPH_BOX = 24;

export interface TileCoinProps {
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

export function TileCoin({ face, edge, pressed = false, children }: TileCoinProps) {
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
    width: COIN_W,
    height: COIN_BLOCK,
  },
  layer: {
    position: 'absolute',
    start: 0,
    width: COIN_W,
    height: COIN_H,
    // Half the height: the end caps are semicircles, so an offset copy of
    // this shape overlaps it everywhere. See the note at the top.
    borderRadius: COIN_H / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  edge: {
    top: COIN_EDGE,
  },
  face: {
    top: 0,
  },
  facePressed: {
    transform: [{ translateY: COIN_EDGE }],
  },
});
