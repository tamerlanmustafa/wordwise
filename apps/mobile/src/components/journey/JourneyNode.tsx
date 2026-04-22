/**
 * JourneyNode — renders a learning node per the locked-down visual contract.
 *
 * Layer stack (required order, back → front):
 *   NodeContainer
 *     ├── Layer 1  Ambient shadow   (outer wrapper, casts via shadow props)
 *     ├── Layer 2  Contact shadow   (inner wrapper, casts via shadow props)
 *     ├── Layer 3  BaseSurface      (135° gradient, 3 stops — NEVER flat)
 *     ├── Layer 4  HighlightOverlay (top-left light)
 *     ├── Layer 5  NoiseTexture     (subtle grain, 4–6% opacity)
 *     ├── Layer 6  ContentLayer     (level code, embedded text shadow)
 *     ├── Layer 7  GlowLayer        (active only, breathes behind tile)
 *     └── Layer 8  InteractionLayer (invisible hit target + press transform)
 *
 * Shadow implementation detail: shadow Views need `backgroundColor` for iOS
 * to render the shadow. If the shadow View is LARGER than the content above
 * it, its backgroundColor leaks as a visible rim. Fix: shadow wrappers are
 * the *same size* as the tile, with the tile (Layer 3+) nested inside so
 * it completely covers the shadow Views.
 *
 *   <AmbientShadowWrapper>   ← casts ambient shadow; same size as tile
 *     <ContactShadowWrapper>  ← casts contact shadow; same size as tile
 *       <TileContents />       ← full gradient, covers the wrappers
 *     </ContactShadowWrapper>
 *   </AmbientShadowWrapper>
 */

import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { cefrColors } from '../../theme/palette';

export type NodeState = 'locked' | 'active' | 'inactive' | 'completed';
export type NodeType = 'lesson' | 'checkpoint' | 'milestone';
export type NodeLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export interface JourneyNodeProps {
  level: NodeLevel;
  state: NodeState;
  type?: NodeType;
  label?: string;
  onPress?: () => void;
  disabled?: boolean;
}

const TILE = 84;
const CONTAINER = 120;
const RADIUS = 20;

const SCALE = { locked: 0.96, inactive: 1.0, active: 1.05, completed: 0.98 } as const;
// Opacity on the outer tile wrapper. We keep locked nodes near-full opacity
// so the gradient stays readable — the "locked" look comes from the padlock
// badge, slight desaturation, and smaller scale, NOT from washing it out.
const OPACITY = { locked: 0.92, inactive: 0.96, active: 1.0, completed: 1.0 } as const;

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;
}
function lighten(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f);
}
function darken(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - f), g * (1 - f), b * (1 - f));
}
// Desaturate only mildly for locked state — we want the gradient to remain
// visible; the "locked" signal is the padlock badge + scale + opacity, not
// a color-stripped tile.
function desaturate(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex);
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  return rgbToHex(r + (gray - r) * f, g + (gray - g) * f, b + (gray - b) * f);
}
function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export function JourneyNode({
  level,
  state,
  label,
  onPress,
  disabled,
}: JourneyNodeProps) {
  // Locked nodes keep ~75% of their chroma — enough to tell A1 from C2 at
  // a glance, but clearly distinct from active/inactive.
  const rawBase = cefrColors[level] || '#7C5CBF';
  const base = state === 'locked' ? desaturate(rawBase, 0.25) : rawBase;
  const stopTop = lighten(base, 0.22);
  const stopMid = base;
  const stopBottom = darken(base, 0.18);

  const scale = SCALE[state];
  const opacity = OPACITY[state];

  const pressScale = useRef(new Animated.Value(1)).current;
  const breathe = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (state !== 'active') return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 1200, useNativeDriver: true, easing: Easing.inOut(Easing.quad) }),
        Animated.timing(breathe, { toValue: 0, duration: 1200, useNativeDriver: true, easing: Easing.inOut(Easing.quad) }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [state, breathe]);

  const breatheScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });
  const glowOpacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });

  const handlePressIn = () => {
    Animated.timing(pressScale, {
      toValue: 0.95,
      duration: 80,
      useNativeDriver: true,
      easing: Easing.out(Easing.quad),
    }).start();
  };
  const handlePressOut = () => {
    Animated.sequence([
      Animated.timing(pressScale, {
        toValue: 1.03,
        duration: 140,
        useNativeDriver: true,
        easing: Easing.out(Easing.back(2)),
      }),
      Animated.timing(pressScale, {
        toValue: 1,
        duration: 80,
        useNativeDriver: true,
        easing: Easing.out(Easing.quad),
      }),
    ]).start();
  };

  // Shadow opacities per state. On iOS these drive the native shadow
  // on each wrapper; on Android we rely on `elevation` which unfortunately
  // only renders a single shadow — the ambient + contact "dual shadow"
  // effect is therefore partially iOS-only until we ship baked sprites.
  const ambientOpacity = state === 'active' ? 0.32 : state === 'completed' ? 0.10 : 0.14;
  const ambientColor = state === 'active' ? base : '#000';
  const contactOpacity = state === 'completed' ? 0.14 : 0.20;

  return (
    <View style={styles.container}>
      {/* Glow layer (active only). Placed BEFORE the shadow wrappers so it
          sits behind them without requiring z-index gymnastics. */}
      {state === 'active' && (
        <Animated.View
          style={[
            styles.glow,
            { opacity: glowOpacity, transform: [{ scale: scale * 1.3 }] },
          ]}
          pointerEvents="none"
        >
          <LinearGradient
            colors={[rgba(base, 0.55), rgba(base, 0.15), rgba(base, 0)]}
            locations={[0, 0.55, 1]}
            start={{ x: 0.5, y: 0.5 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
        </Animated.View>
      )}

      {/* ──────────── Layer 8 — Interaction (outer) ──────────── */}
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled || state === 'locked'}
        hitSlop={8}
        style={styles.interactionLayer}
      >
        <Animated.View
          style={{
            transform: [
              { scale: Animated.multiply(pressScale, state === 'active' ? breatheScale : 1) },
              { scale },
            ],
            opacity,
          }}
        >
          {/* ──────────── Layer 1 — Ambient shadow wrapper ────────────
              Same size as the tile. Inner gradient surface (Layer 3) will
              fully cover this View, so its backgroundColor never leaks. */}
          <View
            style={[
              styles.shadowHost,
              {
                shadowColor: ambientColor,
                shadowOpacity: ambientOpacity,
                shadowRadius: 24,
                shadowOffset: { width: 0, height: 12 },
                elevation: state === 'active' ? 16 : 8,
              },
            ]}
          >
            {/* ──────────── Layer 2 — Contact shadow wrapper ──────────── */}
            <View
              style={[
                styles.shadowHost,
                {
                  shadowColor: '#000',
                  shadowOpacity: contactOpacity,
                  shadowRadius: 5,
                  shadowOffset: { width: 0, height: 3 },
                  elevation: 4,
                },
              ]}
            >
              {/* ──────────── Layer 3 — BaseSurface ──────────── */}
              <LinearGradient
                colors={[stopTop, stopMid, stopBottom]}
                locations={[0, 0.45, 1]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.baseSurface}
              >
                {/* ── Layer 4 — HighlightOverlay ── */}
                <LinearGradient
                  colors={['rgba(255,255,255,0.40)', 'rgba(255,255,255,0)']}
                  locations={[0, 0.55]}
                  start={{ x: 0.1, y: 0.05 }}
                  end={{ x: 0.7, y: 0.7 }}
                  style={styles.highlight}
                  pointerEvents="none"
                />

                {/* ── Layer 5 — NoiseTexture placeholder ──
                    TODO: replace with
                    packages/illustrations/ui/noise-64.png tiled at 4–6%
                    opacity. For now: a very faint inner border keeps the
                    surface from reading as glass. */}
                <View
                  style={[
                    styles.noise,
                    { opacity: state === 'active' ? 0.06 : 0.04 },
                  ]}
                  pointerEvents="none"
                />

                {/* Active-only bright ring hint */}
                {state === 'active' && <View style={styles.activeRing} pointerEvents="none" />}

                {/* ──────────── Layer 6 — ContentLayer ──────────── */}
                <View style={styles.content}>
                  <Text style={styles.levelText}>{label ?? level}</Text>
                </View>

                {/* Locked-state padlock BADGE (corner, not replacement).
                    The level code still shows above so the user can tell
                    levels apart even when locked. */}
                {state === 'locked' && (
                  <View style={styles.lockBadge}>
                    <Text style={styles.lockBadgeText}>🔒</Text>
                  </View>
                )}
              </LinearGradient>

              {/* Completed badge — checkmark in the top-right corner. */}
              {state === 'completed' && (
                <View style={styles.checkBadge}>
                  <Text style={styles.checkBadgeText}>✓</Text>
                </View>
              )}
            </View>
          </View>
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: CONTAINER,
    height: CONTAINER,
    alignItems: 'center',
    justifyContent: 'center',
  },

  interactionLayer: {
    width: CONTAINER,
    height: CONTAINER,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Shadow-casting wrapper. iOS requires an opaque backgroundColor for
  // shadow to render, but since the inner gradient covers this View
  // completely, the bg is never visible.
  shadowHost: {
    width: TILE,
    height: TILE,
    borderRadius: RADIUS,
    backgroundColor: '#FFFFFF',
  },

  glow: {
    position: 'absolute',
    width: TILE,
    height: TILE,
    borderRadius: RADIUS * 1.5,
    overflow: 'hidden',
  },

  baseSurface: {
    width: TILE,
    height: TILE,
    borderRadius: RADIUS,
    overflow: 'hidden',
  },
  highlight: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: RADIUS,
  },
  noise: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: RADIUS,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  activeRing: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: RADIUS,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.5)',
  },

  content: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelText: {
    fontSize: 28,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },

  lockBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockBadgeText: { fontSize: 11 },

  checkBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#4CAF9A',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  checkBadgeText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 14,
  },
});
