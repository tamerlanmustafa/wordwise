/**
 * JourneyNode — flat rhombus tile with 3D skirt.
 */

import React, { useRef } from 'react';
import { Pressable, StyleSheet, View, Animated } from 'react-native';
import { cefrColors } from '../../theme/palette';

export type NodeState = 'locked' | 'active' | 'inactive' | 'completed';
export type NodeLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export interface JourneyNodeProps {
  level: NodeLevel;
  state: NodeState;
  onPress?: () => void;
}

// Geometry
const TILE = 70;
const SCALE_X = 1.5; // 👈 makes left/right corners pointier
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

export function JourneyNode({ level, state, onPress }: JourneyNodeProps) {
  const raw = cefrColors[level] || '#7C5CBF';
  const baseColor = state === 'locked' ? desaturate(raw, 0.55) : raw;
  const skirtColor = darken(baseColor, 0.25);

  const pressAnim = useRef(new Animated.Value(0)).current;

  const pressIn = () => {
    Animated.spring(pressAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 20,
      bounciness: 6,
    }).start();
  };

  const pressOut = () => {
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
    <View style={styles.container}>
      {/* Skirt */}
      <View
        style={[
          styles.diamond,
          styles.skirtPos,
          { backgroundColor: skirtColor },
        ]}
      />

      {/* Top face */}
      <Pressable
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
      >
        <Animated.View
          style={{
            transform: [{ translateY }],
          }}
        >
          <View
            style={[
              styles.diamond,
              styles.topPos,
              { backgroundColor: baseColor },
              state === 'active' && styles.topActive,
            ]}
          />
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
});