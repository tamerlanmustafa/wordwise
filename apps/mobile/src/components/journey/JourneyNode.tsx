/**
 * JourneyNode — flat rhombus tile with 3D skirt.
 */

import React, { useRef } from 'react';
import { Image, Pressable, StyleSheet, Text, View, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { cefrColors } from '../../theme/palette';

export type NodeState = 'locked' | 'active' | 'inactive' | 'completed';
export type NodeLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export interface JourneyNodeProps {
  level: NodeLevel;
  state: NodeState;
  /** Number or text shown centered on the top face. Ignored when locked
      or when `posterUri` is provided. */
  label?: string | number;
  /** Optional movie poster URL. When set, the diamond face becomes the
      poster (clipped to the rotated square, counter-rotated so the
      poster reads upright) and the number label is hidden. */
  posterUri?: string | null;
  onPress?: () => void;
}

// Geometry
const TILE = 70;
const SCALE_X = 1.5; // makes left/right corners pointier
const SCALE_Y = 1;   // keep vertical natural
const SKIRT_DEPTH = 8;
const RADIUS = 8;

// Base rectangle BEFORE rotation
const BASE_W = TILE * SCALE_X;
const BASE_H = TILE * SCALE_Y;

// Rotated bounding box (45deg)
const VISIBLE_W = Math.round(
  Math.abs(BASE_W * Math.cos(Math.PI / 4)) +
  Math.abs(BASE_H * Math.sin(Math.PI / 4))
);

const VISIBLE_H = Math.round(
  Math.abs(BASE_W * Math.sin(Math.PI / 4)) +
  Math.abs(BASE_H * Math.cos(Math.PI / 4))
);

export const JOURNEY_NODE_WIDTH = VISIBLE_W;
export const JOURNEY_NODE_HEIGHT = VISIBLE_H + SKIRT_DEPTH;

// ✅ Correct transform order
const DIAMOND_TRANSFORM = [
  { scaleX: SCALE_X },
  { scaleY: SCALE_Y },
  { rotate: '45deg' },
] as const;

// utils
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function clamp(v: number) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b]
    .map((v) => clamp(v).toString(16).padStart(2, '0'))
    .join('')}`;
}

function darken(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - f), g * (1 - f), b * (1 - f));
}

function desaturate(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex);
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  return rgbToHex(
    r + (gray - r) * f,
    g + (gray - g) * f,
    b + (gray - b) * f
  );
}

export function JourneyNode({ level, state, label, posterUri, onPress }: JourneyNodeProps) {
  const raw = cefrColors[level] || '#7C5CBF';
  const baseColor = state === 'locked' ? desaturate(raw, 0.7) : raw;
  const skirtColor = darken(baseColor, 0.25);
  const isLocked = state === 'locked';

  const pressAnim = useRef(new Animated.Value(0)).current;

  const pressIn = () => {
    if (isLocked) return;
    Animated.spring(pressAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 20,
      bounciness: 6,
    }).start();
  };

  const pressOut = () => {
    if (isLocked) return;
    Animated.spring(pressAnim, {
      toValue: 0,
      useNativeDriver: true,
      speed: 20,
      bounciness: 6,
    }).start();
  };

  const translateY = pressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, SKIRT_DEPTH],
  });

  return (
    <View style={[styles.container, isLocked && styles.containerLocked]}>
      {/* Skirt */}
      <View
        style={[
          styles.diamond,
          styles.skirtPos,
          { backgroundColor: skirtColor },
        ]}
      />

      {/* Top face + label — both translate together on press */}
      <Pressable
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        disabled={isLocked}
      >
        <Animated.View style={{ transform: [{ translateY }] }}>
          <View
            style={[
              styles.diamond,
              styles.topPos,
              { backgroundColor: baseColor, overflow: 'hidden' },
              state === 'active' && styles.topActive,
            ]}
          >
            {posterUri ? (
              // Counter-rotate the poster so it reads upright while the
              // parent rhombus stays rotated 45deg + scaled. Reversing
              // scaleX/scaleY first then rotating -45deg cancels the
              // diamond's transform stack exactly.
              <Image
                source={{ uri: posterUri }}
                style={styles.posterImg}
                resizeMode="cover"
              />
            ) : null}
          </View>

          {/* Locked tiles get a fake-blur dim overlay so they visibly
              "recede." Real BlurView would need expo-blur (native
              module + rebuild) — we can upgrade later. */}
          {isLocked && (
            <View style={[styles.diamond, styles.topPos, styles.lockedOverlay]} />
          )}

          {/* Content overlay — NOT rotated (sits above the diamond's
              transform tree), so numbers/icons read upright. */}
          <View style={styles.contentOverlay} pointerEvents="none">
            {isLocked ? (
              <Ionicons name="lock-closed" size={20} color="rgba(255,255,255,0.8)" />
            ) : posterUri ? null : label != null ? (
              <Text style={styles.labelText}>{String(label)}</Text>
            ) : null}
          </View>
        </Animated.View>
      </Pressable>
    </View>
  );
}

// Centering math
const SQUARE_LEFT = (VISIBLE_W - TILE) / 2;
const SQUARE_TOP = (VISIBLE_H - TILE) / 2;

const styles = StyleSheet.create({
  container: {
    width: JOURNEY_NODE_WIDTH,
    height: JOURNEY_NODE_HEIGHT,
    marginVertical: 10,
    marginHorizontal: 10,
  },

  diamond: {
    position: 'absolute',
    width: TILE,
    height: TILE,
    borderRadius: RADIUS,
    transform: DIAMOND_TRANSFORM,
  },

  topPos: {
    top: SQUARE_TOP,
    left: SQUARE_LEFT,
  },

  skirtPos: {
    top: SQUARE_TOP + SKIRT_DEPTH,
    left: SQUARE_LEFT,
  },

  topActive: {
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },

  // Locked state — tile opacity drops so it visibly "recedes" into the
  // distance. Fake blur via dim overlay until we wire expo-blur.
  containerLocked: {
    opacity: 0.4,
  },
  lockedOverlay: {
    backgroundColor: 'rgba(0,0,0,0.35)',
  },

  // Non-transformed overlay centered on the diamond's visible bounds —
  // hosts the number label or lock icon upright regardless of the
  // diamond's rotation/scale.
  contentOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: VISIBLE_W,
    height: VISIBLE_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterImg: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: TILE,
    height: TILE,
    // Cancel the parent diamond transform: undo the 45deg rotation
    // first, then undo the non-uniform scale. With the diamond
    // transformed via [scaleX, scaleY, rotate], the inverse is the
    // reverse list with negated rotation and reciprocal scales.
    transform: [
      { rotate: '-45deg' },
      { scaleX: 1 / SCALE_X },
      { scaleY: 1 / SCALE_Y },
    ],
  },
  labelText: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});