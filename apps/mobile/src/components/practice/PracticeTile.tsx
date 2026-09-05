/**
 * PracticeTile — v0.7.3 Practice-tab tile (Duolingo-style path).
 *
 * One pressable coin. Four visual states, derived by the parent path
 * component from the cursor:
 *
 *   • active    → gold coin, bare face, a slowly turning ring of dots and a
 *                 gentle bounce. Tappable. Exactly one per render.
 *                 (= cursor position)
 *   • completed → green coin, slightly receded. Past tiles.
 *   • locked    → matte stone coin. Future tiles — unlocked by walking the
 *                 path to them.
 *   • repair    → red coin, alarm glyph.
 *                 (Reserved — pseudo-tile injected when
 *                 repair_window_active. Not yet implemented as a
 *                 real tappable flow; v1 just renders the visual.)
 *
 * **Colour is the state.** The path used to say everything twice: a check
 * glyph on completed tiles and a START callout on the active one, on top of
 * colours that already made both obvious. Every tile carried the same speech
 * bubble, which meant the glyph distinguished nothing at all — it was
 * furniture on 3D coins whose whole appeal is the surface. So a done tile is
 * green, the next one is gold and moving, and the rest are stone; nothing is
 * labelled. The only glyph left is the alarm on `repair`, which is a genuine
 * interruption rather than a position on the path.
 *
 * The green is not a flat swap. `TileCoin` lights the top of the face and
 * shades the bottom from the one token it is given, so the completed tile
 * gets its own three-tone ramp — lit crown, body, shaded base — over a
 * deeper green lip, and stays the same object the gold one is.
 *
 * The 3D body itself lives in {@link TileCoin} and the ring in
 * {@link TileRing}; this file owns the state → colour mapping and the two
 * animations.
 */

import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { Path } from 'react-native-svg';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { COIN_BLOCK, COIN_H, TileCoin } from './TileCoin';
import { RING_SIZE, TileRing } from './TileRing';
import { tileVisual } from './tileVisuals';

export type PracticeTileState =
  | 'active'
  | 'completed'
  | 'locked'
  | 'repair';

export interface PracticeTileProps {
  state: PracticeTileState;
  onPress?: () => void;
}

export function PracticeTile({
  state,
  onPress,
}: PracticeTileProps) {
  const tc = useThemeColors();
  const s = makeStyles(tc);

  // Active-state turning ring — same Reanimated-style loop the archived
  // LessonNode used. 18s/360°.
  const rotate = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (state !== 'active') return;
    const anim = Animated.loop(
      Animated.timing(rotate, {
        toValue: 1,
        duration: 18000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    anim.start();
    return () => {
      anim.stop();
      rotate.setValue(0);
    };
  }, [state, rotate]);
  const spin = rotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // Active-state gentle bounce — draws the eye to the one tappable tile
  // and reads as "this is your next step forward". Pauses for every
  // other state so the rest of the path stays calm.
  const bounce = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (state !== 'active') return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(bounce, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(bounce, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => {
      anim.stop();
      bounce.setValue(0);
    };
  }, [state, bounce]);
  const translateY = bounce.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -6],
  });

  const tappable = state === 'active';

  // The tile's entire vocabulary, now that nothing is written on it — kept
  // pure and tested in `tileVisuals`, because colour is the only thing left
  // telling the user where on the path they are.
  const visual = tileVisual(state, tc);

  return (
    <Pressable
      onPress={tappable ? onPress : undefined}
      style={s.hit}
      hitSlop={8}
    >
      {({ pressed }) => (
        <View style={s.stack}>
          {state === 'active' ? (
            <Animated.View
              style={[s.ringLayer, { transform: [{ rotate: spin }] }]}
              pointerEvents="none"
            >
              <TileRing color={tc.lessonRing} />
            </Animated.View>
          ) : null}

          {/* Face and lip move as one unit so the bounce never splits the
              coin apart; pressing sinks only the face onto its lip. */}
          <Animated.View
            style={[
              visual.faded && s.receded,
              state === 'active' && { transform: [{ translateY }] },
            ]}
          >
            <TileCoin
              face={visual.face}
              edge={visual.edge}
              matte={visual.matte}
              pressed={pressed && tappable}
            >
              {visual.glyph ? <TileGlyph kind={visual.glyph} color="#fff" /> : null}
            </TileCoin>
          </Animated.View>
        </View>
      )}
    </Pressable>
  );
}

type TileGlyphKind = 'alarm';

/** SVG children, not a standalone <Svg>: the glyph is drawn inside the
 *  coin's face group so it sinks with the face on press.
 *
 *  One kind left. The check, the lock and the speech bubble all went when
 *  colour became the state — a glyph every tile shares distinguishes nothing,
 *  and one that repeats what the colour already says is noise on a surface
 *  the whole design is about. */
function TileGlyph({
  kind,
  color,
}: {
  kind: TileGlyphKind;
  color: string;
}) {
  // Heavier than the 2.4 it was drawn at: on a lit, gradient-filled face a
  // hairline glyph reads as a smudge rather than as a mark.
  const p = {
    fill: 'none',
    stroke: color,
    strokeWidth: 3,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (kind === 'alarm') {
    return (
      <>
        <Path {...p} d="M12 8v4l3 2M4 5l3-2M20 5l-3-2" />
        <Path {...p} d="M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z" />
      </>
    );
  }
  return null;
}

const makeStyles = (_tc: ThemeColors) =>
  StyleSheet.create({
    hit: {
      alignItems: 'center',
    },
    // Exactly the painted height of one coin. The ring overflows it
    // deliberately — reserving space for it would make every row as tall as
    // the tallest state and stretch the path to half as many tiles per
    // screen. It is pointer-transparent, so the overflow costs nothing but
    // pixels.
    stack: {
      width: RING_SIZE,
      height: COIN_BLOCK,
      alignItems: 'center',
    },
    receded: {
      opacity: 0.9,
    },
    ringLayer: {
      position: 'absolute',
      // Centred on the *face*, not on the coin block: the lip hangs below
      // the face, and a ring centred on the whole block would sit low.
      top: COIN_H / 2 - RING_SIZE / 2,
      start: 0,
    },
  });
