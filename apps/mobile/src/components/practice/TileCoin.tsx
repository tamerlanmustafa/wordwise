/**
 * TileCoin — the 3D body every practice tile is drawn on.
 *
 * A practice tile reads as a physical button you can press, not a flat
 * circle with a drop shadow. Four things together make that illusion, and
 * dropping any one of them flattens it:
 *
 *   1. **Proportion.** The face is a wide ellipse (72×56), not a circle —
 *      a disc lying at an angle, seen slightly from above.
 *   2. **A lip.** The same ellipse in a darker tone, offset {@link COIN_EDGE}
 *      down, so the disc has visible thickness. Pressing sinks the face onto
 *      it (`pressed`) — the button physically depresses instead of dimming.
 *   3. **A lit surface.** The face is a vertical gradient of *one* token —
 *      bright at the top where the light lands, the token itself in the
 *      middle, shaded at the bottom (see `shade` in theme/tokens).
 *   4. **A rim + gloss.** A white rim highlight that fades out by the
 *      equator, plus a specular oval near the top. Matte states (locked
 *      tiles) skip the gloss and keep only a whisper of rim.
 *
 * Drawn in SVG rather than with `borderRadius` views on purpose: an ellipse
 * with a gradient fill and a fading stroke has no faithful RN-style
 * equivalent, and SVG rasterises identically on iOS and Android — the old
 * hard-offset shadow did not.
 *
 * The glyph is passed as `children` and rendered *inside* the face group, so
 * it sinks with the face on press and needs no second transform.
 */

import { useId, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Ellipse, G, LinearGradient, Stop } from 'react-native-svg';
import { shade } from '../../theme/tokens';

/** Face width — Duolingo-ish proportions, ~1.29:1. */
export const COIN_W = 72;
/** Face height. */
export const COIN_H = 56;
/** Depth of the extruded lip under the face. */
export const COIN_EDGE = 8;
/** Total painted height of one coin, face + lip. */
export const COIN_BLOCK = COIN_H + COIN_EDGE;
/** Side of the square box a glyph is drawn in, centred on the face. */
export const GLYPH_BOX = 24;

export interface TileCoinProps {
  /** Base colour of the face. The lit/shaded tones are derived from it. */
  face: string;
  /** Base colour of the lip below the face. */
  edge: string;
  /** Matte surface — no specular gloss, minimal rim. Locked tiles. */
  matte?: boolean;
  /** Face pushed down onto its lip while a finger is on it. */
  pressed?: boolean;
  /** SVG glyph, drawn in a {@link GLYPH_BOX}-sided box centred on the face. */
  children?: ReactNode;
}

export function TileCoin({ face, edge, matte = false, pressed = false, children }: TileCoinProps) {
  // Gradient ids are resolved per <Svg> root, but two roots on screen with
  // the same id have collided on Android before — and every tile on the path
  // mounts one of these. useId keeps each instance's defs its own.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const faceGrad = `f${uid}`;
  const rimGrad = `r${uid}`;
  const lipGrad = `l${uid}`;

  const cx = COIN_W / 2;
  const cy = COIN_H / 2;
  const glyphOffset = (COIN_H - GLYPH_BOX) / 2;

  return (
    <View style={styles.body}>
      {/* The lip: same ellipse, lower and darker. Static — only the face
          moves when pressed, which is what makes the press read as depth
          rather than as the whole tile sliding down. */}
      <View style={styles.lip} pointerEvents="none">
        <Svg width={COIN_W} height={COIN_H}>
          <Defs>
            <LinearGradient id={lipGrad} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={shade(edge, 0.06)} />
              <Stop offset="1" stopColor={shade(edge, -0.18)} />
            </LinearGradient>
          </Defs>
          <Ellipse cx={cx} cy={cy} rx={cx} ry={cy} fill={`url(#${lipGrad})`} />
        </Svg>
      </View>

      <View style={[styles.face, pressed && styles.facePressed]}>
        <Svg width={COIN_W} height={COIN_H}>
          <Defs>
            <LinearGradient id={faceGrad} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={shade(face, matte ? 0.16 : 0.3)} />
              <Stop offset="0.42" stopColor={face} />
              <Stop offset="1" stopColor={shade(face, matte ? -0.08 : -0.14)} />
            </LinearGradient>
            <LinearGradient id={rimGrad} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#fff" stopOpacity={matte ? 0.16 : 0.55} />
              <Stop offset="0.5" stopColor="#fff" stopOpacity={0} />
            </LinearGradient>
          </Defs>

          <Ellipse cx={cx} cy={cy} rx={cx} ry={cy} fill={`url(#${faceGrad})`} />
          {/* Rim: inset by half the stroke so it sits on the silhouette
              instead of being clipped by it. */}
          <Ellipse
            cx={cx}
            cy={cy}
            rx={cx - 1}
            ry={cy - 1}
            fill="none"
            stroke={`url(#${rimGrad})`}
            strokeWidth={2}
          />
          {matte ? null : (
            <Ellipse
              cx={cx}
              cy={COIN_H * 0.26}
              rx={COIN_W * 0.27}
              ry={COIN_H * 0.13}
              fill="#fff"
              opacity={0.32}
            />
          )}

          <G transform={[{ translateX: (COIN_W - GLYPH_BOX) / 2 }, { translateY: glyphOffset }]}>
            {children}
          </G>
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    width: COIN_W,
    height: COIN_BLOCK,
  },
  lip: {
    position: 'absolute',
    top: COIN_EDGE,
    start: 0,
  },
  face: {
    position: 'absolute',
    top: 0,
    start: 0,
  },
  facePressed: {
    transform: [{ translateY: COIN_EDGE }],
  },
});
