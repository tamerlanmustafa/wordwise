/**
 * PracticeTile — v0.7.2 Practice-tab tile.
 *
 * A single 60px circle with a kind glyph + a label below. Five visual
 * states, derived by the parent path component:
 *
 *   • available    → gold bg, kind glyph, spinning dashed ring, START
 *                    callout. Tappable. Exactly one of these per render.
 *   • done-today   → gold bg + check glyph, faded. Today's pick.
 *   • locked-other → dim, kind glyph, "tomorrow" badge. Other tiles
 *                    after the user already picked one today.
 *   • locked-streak→ dim, kind glyph, "🔒 N-day streak" badge.
 *   • repair       → red bg, alarm glyph, RESCUE STREAK callout.
 *                    (Reserved — pseudo-tile injected when
 *                    repair_window_active. Not yet implemented as a
 *                    real tappable flow; v1 just renders the visual.)
 *
 * The kind glyphs reuse the v0.7 vocabulary: speech-bubble (recall),
 * 4-grid (mcq), flame (tough), film (deep-dive). All stroked SVGs at
 * 24px inside the 60px body.
 */

import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import type { SessionKind } from '../../services/api';

export type PracticeTileState =
  | 'available'
  | 'done-today'
  | 'locked-other'
  | 'locked-streak'
  | 'repair';

export interface PracticeTileProps {
  kind: SessionKind;
  /** Title shown under the circle (e.g. "Quick Recall"). */
  label: string;
  state: PracticeTileState;
  /** Required when state === 'locked-streak' — the streak target. */
  unlockAt?: number;
  onPress?: () => void;
}

export function PracticeTile({
  kind,
  label,
  state,
  unlockAt,
  onPress,
}: PracticeTileProps) {
  const tc = useThemeColors();
  const s = makeStyles(tc);

  // Active-state spinning dashed ring — same Reanimated-style loop the
  // archived LessonNode used. 18s/360°.
  const rotate = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (state !== 'available') return;
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

  const tappable = state === 'available';

  // Body color + glyph color matrix.
  const bodyBg = state === 'repair'
    ? tc.error
    : state === 'available' || state === 'done-today'
      ? tc.gold
      : tc.nodeLocked;
  const fgColor = state === 'repair'
    ? '#fff'
    : state === 'available' || state === 'done-today'
      ? tc.goldDeep
      : tc.textFaint;
  const bodyBorderColor = state === 'locked-streak' || state === 'locked-other'
    ? tc.nodeLockedBorder
    : 'transparent';
  const bodyBorderWidth = state === 'locked-streak' || state === 'locked-other' ? 2 : 0;

  // Glyph shown in the center of the circle.
  const glyphKind: SessionKind | 'check' | 'lock' | 'alarm' =
    state === 'done-today' ? 'check'
  : state === 'repair'     ? 'alarm'
  : kind;

  return (
    <Pressable
      onPress={tappable ? onPress : undefined}
      style={({ pressed }) => [
        s.hit,
        pressed && tappable && { opacity: 0.9 },
      ]}
      hitSlop={6}
    >
      <View style={s.circleWrap}>
        {state === 'available' ? (
          <Animated.View
            style={[s.ring, { borderColor: tc.lessonRing, transform: [{ rotate: spin }] }]}
            pointerEvents="none"
          />
        ) : null}

        <View
          style={[
            s.body,
            {
              backgroundColor: bodyBg,
              borderColor: bodyBorderColor,
              borderWidth: bodyBorderWidth,
            },
            (state === 'locked-other' || state === 'locked-streak') && { opacity: 0.85 },
          ]}
        >
          <TileGlyph kind={glyphKind} color={fgColor} />
        </View>

        {state === 'available' ? (
          <View style={s.startCallout} pointerEvents="none">
            <View style={[s.startTail, { backgroundColor: tc.text }]} />
            <View style={[s.startBody, { backgroundColor: tc.text }]}>
              <Text style={[s.startText, { color: tc.background }]}>START</Text>
            </View>
          </View>
        ) : null}

        {state === 'locked-streak' && typeof unlockAt === 'number' ? (
          <View style={[s.lockBadge, { backgroundColor: tc.paper, borderColor: tc.border }]}>
            <Text style={[s.lockBadgeText, { color: tc.textFaint }]}>
              🔒 {unlockAt}d
            </Text>
          </View>
        ) : null}

        {state === 'locked-other' ? (
          <View style={[s.lockBadge, { backgroundColor: tc.paper, borderColor: tc.border }]}>
            <Text style={[s.lockBadgeText, { color: tc.textFaint }]}>
              Tomorrow
            </Text>
          </View>
        ) : null}
      </View>

      <Text
        style={[s.label, { color: state === 'available' ? tc.text : tc.textFaint }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function TileGlyph({
  kind,
  color,
}: {
  kind: SessionKind | 'check' | 'lock' | 'alarm';
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
  if (kind === 'quick_recall') {
    // Speech bubble (recall — "say it back to me")
    return (
      <Svg {...p}>
        <Path d="M4 5h12a4 4 0 0 1 0 8H6l-2 3z" />
      </Svg>
    );
  }
  if (kind === 'synonym_round') {
    // 4-grid (multiple choice)
    return (
      <Svg {...p}>
        <Rect x={4} y={4} width={7} height={7} rx={1.5} />
        <Rect x={13} y={4} width={7} height={7} rx={1.5} />
        <Rect x={4} y={13} width={7} height={7} rx={1.5} />
        <Rect x={13} y={13} width={7} height={7} rx={1.5} />
      </Svg>
    );
  }
  if (kind === 'tough_words') {
    // Flame (tough / brought back)
    return (
      <Svg {...p}>
        <Path d="M12 21c-4 0-7-3-7-7 0-2 1-4 3-5 0 2 2 3 3 2-1-3 0-6 2-8 0 4 6 5 6 11 0 4-3 7-7 7z" />
      </Svg>
    );
  }
  if (kind === 'movie_deep_dive') {
    // Film reel (deep dive into one movie)
    return (
      <Svg {...p}>
        <Rect x={3} y={4} width={18} height={16} rx={2} />
        <Path d="M3 8h18M3 16h18M8 4v16M16 4v16" />
      </Svg>
    );
  }
  return null;
}

const RING_INSET = 8;
const CIRCLE = 60;

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
      justifyContent: 'center',
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
    body: {
      width: CIRCLE,
      height: CIRCLE,
      borderRadius: CIRCLE / 2,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.4,
      shadowRadius: 0,
      shadowOffset: { width: 0, height: 5 },
      elevation: 4,
    },
    startCallout: {
      position: 'absolute',
      top: 70,
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
    lockBadge: {
      position: 'absolute',
      top: 64,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      borderWidth: 1,
    },
    lockBadgeText: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.4,
    },
    label: {
      marginTop: 12,
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 0.3,
      textAlign: 'center',
    },
  });
