/**
 * LessonNode — v0.7 Practice tab lesson node (68px circle in 76px hit area).
 *
 * Three states (cf. `tabs/practice.jsx → LessonNode`):
 *   • done    → bg `tc.gold`, check glyph
 *   • active  → bg `tc.gold`, kind-glyph, plus a spinning dashed gold
 *               ring at inset -10 (Reanimated rotation loop). A "START"
 *               callout sits 78px below pointing up.
 *   • locked  → bg `tc.nodeLocked`, 2px border `tc.nodeLockedBorder`,
 *               lock glyph, color `tc.textFaint`.
 *
 * Kind glyphs (SVG paths copied 1:1 from `tabs/practice.jsx → NodeIcon`):
 *   recall (chat bubble) · mcq (4-grid) · listen (headphones) ·
 *   chest · star.
 *
 * Drop-shadow translation: the JSX uses a "stacked" shadow (hard offset
 * + blur). RN doesn't compose two shadows on a single node, so we do
 * one shadow per platform: iOS prefers the blur, Android prefers
 * elevation. Visually close enough for v0.7.
 */

import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import type { PracticeLessonKind, PracticeLessonState } from '../../services/api';

export interface LessonNodeProps {
  kind: PracticeLessonKind;
  state: PracticeLessonState;
  onPress?: () => void;
}

export function LessonNode({ kind, state, onPress }: LessonNodeProps) {
  const tc = useThemeColors();
  const s = makeStyles(tc);

  const isDone = state === 'done';
  const isActive = state === 'active';
  const isLocked = state === 'locked';

  const bg = isLocked ? tc.nodeLocked : tc.gold;
  const fg = isLocked ? tc.textFaint : tc.goldDeep;

  // The active dashed ring rotates 360° every 18s. Looped Reanimated
  // would be marginally smoother but Animated is built-in and the loop
  // is slow enough that JS-driven rotation is fine.
  const rotate = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!isActive) return;
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
  }, [isActive, rotate]);

  const spin = rotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const glyphKind: PracticeLessonKind | 'check' | 'lock' = isDone
    ? 'check'
    : isLocked
      ? 'lock'
      : kind;

  return (
    <Pressable
      onPress={isLocked ? undefined : onPress}
      style={({ pressed }) => [
        s.hit,
        pressed && !isLocked && { opacity: 0.9 },
      ]}
      hitSlop={6}
    >
      {/* Active spinning ring */}
      {isActive ? (
        <Animated.View
          style={[
            s.ring,
            { borderColor: tc.lessonRing, transform: [{ rotate: spin }] },
          ]}
          pointerEvents="none"
        />
      ) : null}

      {/* Node body */}
      <View
        style={[
          s.body,
          {
            backgroundColor: bg,
            borderColor: isLocked ? tc.nodeLockedBorder : 'transparent',
            borderWidth: isLocked ? 2 : 0,
          },
        ]}
      >
        <NodeIcon kind={glyphKind} color={fg} />
      </View>

      {/* "START" callout for active */}
      {isActive ? (
        <View style={s.callout} pointerEvents="none">
          <View style={[s.calloutTail, { backgroundColor: tc.text }]} />
          <View style={[s.calloutBody, { backgroundColor: tc.text }]}>
            <Text style={[s.calloutText, { color: tc.background }]}>START</Text>
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

function NodeIcon({
  kind,
  color,
}: {
  kind: PracticeLessonKind | 'check' | 'lock';
  color: string;
}) {
  const p = {
    width: 28,
    height: 28,
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
  if (kind === 'recall') {
    return (
      <Svg {...p}>
        <Path d="M4 5h12a4 4 0 0 1 0 8H6l-2 3z" />
      </Svg>
    );
  }
  if (kind === 'mcq') {
    return (
      <Svg {...p}>
        <Rect x={4} y={4} width={7} height={7} rx={1.5} />
        <Rect x={13} y={4} width={7} height={7} rx={1.5} />
        <Rect x={4} y={13} width={7} height={7} rx={1.5} />
        <Rect x={13} y={13} width={7} height={7} rx={1.5} />
      </Svg>
    );
  }
  if (kind === 'listen') {
    return (
      <Svg {...p}>
        <Path d="M4 14V10a8 8 0 0 1 16 0v4M4 14a2 2 0 0 0 2 2h1v-6H6a2 2 0 0 0-2 2zM20 14a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2z" />
      </Svg>
    );
  }
  if (kind === 'chest') {
    return (
      <Svg {...p}>
        <Path d="M4 11V8a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v3M3 11h18v8H3z" />
        <Path d="M12 11v3M9.5 14h5" />
      </Svg>
    );
  }
  if (kind === 'star') {
    return (
      <Svg {...p}>
        <Path
          d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.3L12 17.3 6.4 20.3l1.1-6.3L3 9.6l6.2-.9z"
          fill={color}
          stroke="none"
        />
      </Svg>
    );
  }
  return (
    <Svg {...p}>
      <Circle cx={12} cy={12} r={6} />
    </Svg>
  );
}

const RING_INSET = 10;

const makeStyles = (_tc: ThemeColors) =>
  StyleSheet.create({
    hit: {
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
      borderRadius: (76 + RING_INSET * 2) / 2,
      borderWidth: 2.5,
      borderStyle: 'dashed',
    },
    body: {
      width: 68,
      height: 68,
      borderRadius: 34,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.45,
      shadowRadius: 0,
      shadowOffset: { width: 0, height: 6 },
      elevation: 4,
    },
    callout: {
      position: 'absolute',
      top: 78,
      alignItems: 'center',
    },
    calloutTail: {
      width: 8,
      height: 8,
      transform: [{ rotate: '45deg' }],
      marginBottom: -4,
      shadowColor: '#000',
      shadowOpacity: 0.35,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 2 },
    },
    calloutBody: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 6,
      shadowColor: '#000',
      shadowOpacity: 0.35,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
    calloutText: {
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 1.2,
    },
  });
