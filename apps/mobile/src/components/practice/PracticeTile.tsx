/**
 * PracticeTile — v0.7.3 Practice-tab tile (Duolingo-style path).
 *
 * A single 60px circle with a kind glyph + a label below. Four visual
 * states, derived by the parent path component from the cursor:
 *
 *   • active    → gold bg, lesson glyph, spinning dashed ring, START
 *                 callout. Tappable. Exactly one of these per render.
 *                 (= cursor position)
 *   • completed → gold bg + check glyph, faded. Past tiles already done.
 *   • locked    → dim, lesson glyph, no badge. Future tiles — unlocks
 *                 when the user reaches them by walking the path.
 *   • repair    → red bg, alarm glyph, RESCUE STREAK callout.
 *                 (Reserved — pseudo-tile injected when
 *                 repair_window_active. Not yet implemented as a
 *                 real tappable flow; v1 just renders the visual.)
 *
 * Every tile is the same lesson, so they share one glyph — a speech
 * bubble, the v0.7 "say it back to me" mark. The path used to give each
 * of three rotating kinds its own glyph (flame for tough words, a film
 * reel for the movie deep-dive); those kinds are gone. All stroked SVGs
 * at 24px inside the 60px body.
 *
 * Depth: each circle is a two-layer "button" — a face over a darker
 * bottom edge (Duolingo-style 3D lip). Pressing the active tile pushes
 * the face down onto its edge, so the tap physically depresses the
 * button instead of just dimming it. The edge replaces the old
 * hard-offset shadow, which rendered differently on iOS vs Android.
 */

import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';

export type PracticeTileState =
  | 'active'
  | 'completed'
  | 'locked'
  | 'repair';

export interface PracticeTileProps {
  /** Title shown under the circle (e.g. "Practice"). */
  label: string;
  state: PracticeTileState;
  onPress?: () => void;
}

export function PracticeTile({
  label,
  state,
  onPress,
}: PracticeTileProps) {
  const tc = useThemeColors();
  const s = makeStyles(tc);

  // Active-state spinning dashed ring — same Reanimated-style loop the
  // archived LessonNode used. 18s/360°.
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
  const bodyBg = state === 'repair'
    ? tc.error
    : isGold
      ? tc.gold
      : tc.nodeLocked;
  const edgeBg = state === 'repair'
    ? tc.nodeRepairEdge
    : isGold
      ? tc.nodeGoldEdge
      : tc.nodeLockedEdge;
  const fgColor = state === 'repair'
    ? '#fff'
    : isGold
      ? tc.goldDeep
      : tc.textFaint;
  const bodyBorderColor = state === 'locked' ? tc.nodeLockedBorder : 'transparent';
  const bodyBorderWidth = state === 'locked' ? 2 : 0;
  // Matte states (locked) skip the glossy top sheen.
  const hasSheen = isGold || state === 'repair';

  // Glyph shown in the center of the circle.
  const glyphKind: TileGlyphKind =
    state === 'completed' ? 'check'
  : state === 'repair'    ? 'alarm'
  : 'lesson';

  return (
    <Pressable
      onPress={tappable ? onPress : undefined}
      style={s.hit}
      hitSlop={6}
    >
      {({ pressed }) => (
        <>
          <View style={s.circleWrap}>
            {state === 'active' ? (
              <Animated.View
                style={[s.ring, { borderColor: tc.lessonRing, transform: [{ rotate: spin }] }]}
                pointerEvents="none"
              />
            ) : null}

            {/* Face + edge move as one unit so the bounce never splits
                the button apart; pressing sinks only the face. */}
            <Animated.View
              style={[
                s.button,
                state === 'locked' && { opacity: 0.6 },
                state === 'completed' && { opacity: 0.75 },
                state === 'active' && { transform: [{ translateY }] },
              ]}
            >
              <View style={[s.edge, { backgroundColor: edgeBg }]} />
              <View
                style={[
                  s.face,
                  {
                    backgroundColor: bodyBg,
                    borderColor: bodyBorderColor,
                    borderWidth: bodyBorderWidth,
                  },
                  pressed && tappable && s.facePressed,
                ]}
              >
                {hasSheen ? <View style={s.sheen} /> : null}
                <TileGlyph kind={glyphKind} color={fgColor} />
              </View>
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

          <Text
            style={[s.label, { color: state === 'active' ? tc.text : tc.textFaint }]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

type TileGlyphKind = 'lesson' | 'check' | 'lock' | 'alarm';

function TileGlyph({
  kind,
  color,
}: {
  kind: TileGlyphKind;
  color: string;
}) {
  const p = {
    width: 24,
    height: 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: 2.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (kind === 'check') {
    return (
      <Svg {...p}>
        <Path d="M5 12l4 4 10-10" />
      </Svg>
    );
  }
  if (kind === 'lock') {
    return (
      <Svg {...p}>
        <Rect x={5} y={11} width={14} height={9} rx={2} />
        <Path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </Svg>
    );
  }
  if (kind === 'alarm') {
    return (
      <Svg {...p}>
        <Path d="M12 8v4l3 2M4 5l3-2M20 5l-3-2" />
        <Path d="M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z" />
      </Svg>
    );
  }
  if (kind === 'lesson') {
    // Speech bubble — "say it back to me". Every lesson is the same kind.
    return (
      <Svg {...p}>
        <Path d="M4 5h12a4 4 0 0 1 0 8H6l-2 3z" />
      </Svg>
    );
  }
  return null;
}

const RING_INSET = 8;
const CIRCLE = 60;
/** Height of the 3D bottom lip under the face. */
const EDGE = 5;

const makeStyles = (_tc: ThemeColors) =>
  StyleSheet.create({
    hit: {
      alignItems: 'center',
      paddingHorizontal: 4,
    },
    circleWrap: {
      width: 76,
      height: 76,
      alignItems: 'center',
      // Top-aligned with padding (not centered) so the face's centre
      // stays at the wrap's centre despite the extra EDGE below it —
      // keeps the spinning ring concentric with the face.
      paddingTop: (76 - CIRCLE) / 2,
      position: 'relative',
    },
    ring: {
      position: 'absolute',
      top: -RING_INSET,
      left: -RING_INSET,
      right: -RING_INSET,
      bottom: -RING_INSET,
      borderRadius: (CIRCLE + RING_INSET * 2) / 2,
      borderWidth: 2.5,
      borderStyle: 'dashed',
    },
    button: {
      width: CIRCLE,
      height: CIRCLE + EDGE,
    },
    edge: {
      position: 'absolute',
      top: EDGE,
      left: 0,
      width: CIRCLE,
      height: CIRCLE,
      borderRadius: CIRCLE / 2,
    },
    face: {
      width: CIRCLE,
      height: CIRCLE,
      borderRadius: CIRCLE / 2,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    facePressed: {
      transform: [{ translateY: EDGE }],
    },
    sheen: {
      position: 'absolute',
      top: 6,
      left: (CIRCLE - 32) / 2,
      width: 32,
      height: 12,
      borderRadius: 999,
      backgroundColor: 'rgba(255,255,255,0.26)',
    },
    startCallout: {
      position: 'absolute',
      top: 74,
      alignItems: 'center',
    },
    startTail: {
      width: 8,
      height: 8,
      transform: [{ rotate: '45deg' }],
      marginBottom: -4,
    },
    startBody: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 6,
    },
    startText: {
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 1.2,
    },
    label: {
      // 28px clears the absolute-positioned START callout on the
      // active tile (callout extends ~24px below the circle); all
      // other states have a benign empty space below the circle, so
      // the uniform margin keeps the path visually evenly spaced.
      marginTop: 28,
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 0.3,
      textAlign: 'center',
    },
  });
