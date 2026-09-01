/**
 * PracticeTile — v0.7.3 Practice-tab tile (Duolingo-style path).
 *
 * One pressable coin with a glyph. Four visual states, derived by the parent
 * path component from the cursor:
 *
 *   • active    → gold coin, lesson glyph, a slowly turning ring of dots,
 *                 START callout. Tappable. Exactly one per render.
 *                 (= cursor position)
 *   • completed → gold coin + check glyph, slightly receded. Past tiles.
 *   • locked    → matte stone coin, lesson glyph, no badge. Future tiles —
 *                 unlocked by walking the path to them.
 *   • repair    → red coin, alarm glyph, RESCUE STREAK callout.
 *                 (Reserved — pseudo-tile injected when
 *                 repair_window_active. Not yet implemented as a
 *                 real tappable flow; v1 just renders the visual.)
 *
 * Every tile is the same lesson, so they share one glyph — a speech
 * bubble, the v0.7 "say it back to me" mark. The path used to give each
 * of three rotating kinds its own glyph (flame for tough words, a film
 * reel for the movie deep-dive); those kinds are gone.
 *
 * The 3D body itself lives in {@link TileCoin} and the ring in
 * {@link TileRing}; this file owns the state → colour mapping, the two
 * animations, and the callout.
 */

import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Path, Rect } from 'react-native-svg';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { COIN_BLOCK, COIN_H, TileCoin } from './TileCoin';
import { RING_SIZE, TileRing } from './TileRing';

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

  const isGold = state === 'active' || state === 'completed';
  const faceColor = state === 'repair'
    ? tc.error
    : isGold
      ? tc.gold
      : tc.nodeLocked;
  const edgeColor = state === 'repair'
    ? tc.nodeRepairEdge
    : isGold
      ? tc.nodeGoldEdge
      : tc.nodeLockedEdge;
  const fgColor = state === 'repair'
    ? '#fff'
    : isGold
      ? tc.goldDeep
      : tc.textFaint;
  // Locked tiles are matte stone: no gloss, barely a rim. Their colours are
  // already dim, so they keep full opacity — fading them on top of that made
  // the road ahead disappear rather than recede.
  const matte = state === 'locked';

  // Glyph shown in the centre of the coin.
  const glyphKind: TileGlyphKind =
    state === 'completed' ? 'check'
  : state === 'repair'    ? 'alarm'
  : 'lesson';

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
              state === 'completed' && { opacity: 0.9 },
              state === 'active' && { transform: [{ translateY }] },
            ]}
          >
            <TileCoin
              face={faceColor}
              edge={edgeColor}
              matte={matte}
              pressed={pressed && tappable}
            >
              <TileGlyph kind={glyphKind} color={fgColor} />
            </TileCoin>
          </Animated.View>

          {state === 'active' ? (
            <View style={s.startCallout} pointerEvents="none">
              <View style={[s.startTail, { backgroundColor: tc.text }]} />
              <View style={[s.startBody, { backgroundColor: tc.text }]}>
                <Text style={[s.startText, { color: tc.background }]}>START</Text>
              </View>
            </View>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

type TileGlyphKind = 'lesson' | 'check' | 'lock' | 'alarm';

/** SVG children, not a standalone <Svg>: the glyph is drawn inside the
 *  coin's face group so it sinks with the face on press. */
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
  if (kind === 'check') {
    return <Path {...p} d="M5 12l4 4 10-10" />;
  }
  if (kind === 'lock') {
    return (
      <>
        <Rect {...p} x={5} y={11} width={14} height={9} rx={2} />
        <Path {...p} d="M8 11V8a4 4 0 0 1 8 0v3" />
      </>
    );
  }
  if (kind === 'alarm') {
    return (
      <>
        <Path {...p} d="M12 8v4l3 2M4 5l3-2M20 5l-3-2" />
        <Path {...p} d="M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z" />
      </>
    );
  }
  if (kind === 'lesson') {
    // Speech bubble — "say it back to me". Every lesson is the same kind.
    // Redrawn to fill the glyph box: the old one occupied its top-left
    // corner with a square shoulder, which at tile size read as a letter P.
    return <Path {...p} d="M5 4h14a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4h-8l-6 4v-4a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z" />;
  }
  return null;
}

const makeStyles = (_tc: ThemeColors) =>
  StyleSheet.create({
    hit: {
      alignItems: 'center',
    },
    // Exactly the painted height of one coin. The ring and the START callout
    // overflow it deliberately — reserving space for them would make every
    // row as tall as the tallest state and stretch the path to half as many
    // tiles per screen. Both are pointer-transparent, so the overflow costs
    // nothing but pixels.
    stack: {
      width: RING_SIZE,
      height: COIN_BLOCK,
      alignItems: 'center',
    },
    ringLayer: {
      position: 'absolute',
      // Centred on the *face*, not on the coin block: the lip hangs below
      // the face, and a ring centred on the whole block would sit low.
      top: COIN_H / 2 - RING_SIZE / 2,
      start: 0,
    },
    startCallout: {
      position: 'absolute',
      top: COIN_BLOCK + 2,
      start: 0,
      end: 0,
      alignItems: 'center',
    },
    startTail: {
      width: 8,
      height: 8,
      transform: [{ rotate: '45deg' }],
      marginBottom: -4,
    },
    startBody: {
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: 6,
    },
    startText: {
      fontSize: 9,
      fontWeight: '900',
      letterSpacing: 1.1,
    },
  });
