/**
 * JourneyNode — bare 3D tile. Top face rests on a darker skirt.
 *
 * Depth comes from real geometry: the skirt (a same-shape, shifted-down,
 * darker View) reads as the button's base. On press the top face drops
 * onto the skirt — classic Duolingo tactile feedback.
 */

import { Pressable, StyleSheet, View } from 'react-native';
import { cefrColors } from '../../theme/palette';

export type NodeState = 'locked' | 'active' | 'inactive' | 'completed';
export type NodeLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export interface JourneyNodeProps {
  level: NodeLevel;
  state: NodeState;
  onPress?: () => void;
}

const TILE = 84;
const SKIRT_DEPTH = 8;
const RADIUS = 20;

export const JOURNEY_NODE_WIDTH = TILE;
export const JOURNEY_NODE_HEIGHT = TILE + SKIRT_DEPTH;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function clamp(v: number) { return Math.max(0, Math.min(255, Math.round(v))); }
function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;
}
function darken(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - f), g * (1 - f), b * (1 - f));
}
function desaturate(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex);
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  return rgbToHex(r + (gray - r) * f, g + (gray - g) * f, b + (gray - b) * f);
}

export function JourneyNode({ level, state, onPress }: JourneyNodeProps) {
  const raw = cefrColors[level] || '#7C5CBF';
  const baseColor = state === 'locked' ? desaturate(raw, 0.35) : raw;
  const skirtColor = darken(baseColor, 0.22);

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.skirt,
          { backgroundColor: skirtColor },
          state === 'active' && styles.skirtActive,
        ]}
      />
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.topFace,
          { backgroundColor: baseColor },
          // Press-in drops the top face onto the skirt — real geometry
          // change, no animation library needed.
          pressed && styles.topFacePressed,
          state === 'active' && styles.topFaceActive,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: JOURNEY_NODE_WIDTH,
    height: JOURNEY_NODE_HEIGHT,
  },
  skirt: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: SKIRT_DEPTH,
    height: TILE,
    borderRadius: RADIUS,
  },
  skirtActive: {
    top: SKIRT_DEPTH + 2,
  },
  topFace: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: TILE,
    height: TILE,
    borderRadius: RADIUS,
  },
  topFacePressed: {
    top: SKIRT_DEPTH,
  },
  topFaceActive: {
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
});
