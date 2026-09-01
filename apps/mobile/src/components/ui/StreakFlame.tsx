/**
 * StreakFlame — the streak counter's flame, alive instead of an icon glyph.
 *
 * Four layers, drawn back to front:
 *   1. a soft radial glow that breathes,
 *   2. the flame body, a vertical gradient from a pale tip to a hot base,
 *   3. a bright inner core that flickers on its own, slower rhythm,
 *   4. three sparkles that twinkle at staggered offsets.
 *
 * Every one of those is an opacity or a transform on an `Animated.View`, so
 * all four run on the native driver — the UI thread keeps animating even
 * while JS is busy composing the next practice deck. The obvious way to write
 * a "glisten" is a bright band swept across the silhouette with an SVG
 * `clipPath`, but that means animating an SVG element's own props, which
 * cannot use the native driver and is not reliable under the new
 * architecture; layered opacity gets the same read for free.
 *
 * `lit={false}` (a streak of zero) is a deliberate dead stop: grey gradient,
 * no glow, no sparkles, no timers. A flame that dances while the counter
 * reads 0 tells the user the wrong thing, and an idle tab shouldn't hold
 * three animation loops open to say nothing.
 *
 * Honors reduce-motion by rendering the same picture without the loops.
 */

import { useEffect, useId, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';
import { shade, useThemeColors } from '../../theme/tokens';

/** Flame silhouette, drawn in a 24×24 box: a tapering tip over a round base. */
const FLAME_PATH =
  'M12 1.8C12 1.8 14.6 6.2 16.4 8.6C18.6 11.4 19.8 13.4 19.8 15.6'
  + 'A7.8 7.8 0 0 1 4.2 15.6C4.2 12.6 6.2 10.6 7.6 8.2'
  + 'C8.6 9.6 9.2 10.4 10.2 10.9C10.6 7.4 11.4 4.4 12 1.8Z';

/** The hotter inner flame, same box. */
const CORE_PATH =
  'M12 9.4C13.4 11.4 15.2 12.6 15.2 15.4A3.2 3.2 0 0 1 8.8 15.4C8.8 13.4 10.8 12.4 12 9.4Z';

/** Four-point sparkle in a 12×12 box. */
const SPARKLE_PATH =
  'M6 0C6.6 3.6 8.4 5.4 12 6C8.4 6.6 6.6 8.4 6 12C5.4 8.4 3.6 6.6 0 6C3.6 5.4 5.4 3.6 6 0Z';

/** Where the sparkles sit, as fractions of the icon box, with their size and
 *  the point in the twinkle cycle they start at. Off-silhouette on purpose —
 *  a sparkle reads as light coming off the flame, not as part of it. */
const SPARKLES = [
  { x: -0.16, y: 0.04, size: 0.38, delay: 0 },
  { x: 0.82, y: 0.26, size: 0.3, delay: 900 },
  { x: -0.1, y: 0.62, size: 0.24, delay: 1800 },
];

const TWINKLE_MS = 700;
const TWINKLE_CYCLE = 2700;

export interface StreakFlameProps {
  /** Box side in points. The flame fills it; glow and sparkles overflow. */
  size?: number;
  /** False when the streak is 0 — a cold, still, grey flame. */
  lit?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function StreakFlame({ size = 20, lit = true, style }: StreakFlameProps) {
  const tc = useThemeColors();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [reduceMotion, setReduceMotion] = useState(false);

  const glow = useRef(new Animated.Value(0)).current;
  const flicker = useRef(new Animated.Value(0)).current;
  const twinkle = useRef(SPARKLES.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => mounted && setReduceMotion(v));
    return () => {
      mounted = false;
    };
  }, []);

  const animate = lit && !reduceMotion;
  useEffect(() => {
    if (!animate) return;

    const pingPong = (value: Animated.Value, duration: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(value, {
            toValue: 1,
            duration,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0,
            duration,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      );

    const loops = [
      pingPong(glow, 1500),
      // Deliberately not a multiple of the glow's period: two loops that share
      // a beat read as one pulsing object, while drifting ones read as fire.
      pingPong(flicker, 430),
      ...twinkle.map((value, i) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(SPARKLES[i].delay),
            Animated.timing(value, {
              toValue: 1,
              duration: TWINKLE_MS / 2,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(value, {
              toValue: 0,
              duration: TWINKLE_MS / 2,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.delay(TWINKLE_CYCLE - TWINKLE_MS - SPARKLES[i].delay),
          ]),
        ),
      ),
    ];

    loops.forEach((l) => l.start());
    return () => {
      loops.forEach((l) => l.stop());
      glow.setValue(0);
      flicker.setValue(0);
      twinkle.forEach((v) => v.setValue(0));
    };
  }, [animate, glow, flicker, twinkle]);

  // Cold flame: one grey token at two lightnesses, so it recedes in both
  // themes without a second set of palette entries.
  const stops = lit
    ? ['#FFE07A', '#FF9A1F', '#F4581C']
    : [shade(tc.textFaint, 0.12), shade(tc.textFaint, -0.1), shade(tc.textFaint, -0.28)];

  // The glow overflows the box on every side; kept modest so it washes the
  // chip it sits in rather than the number beside it.
  const glowSize = size * 1.7;
  return (
    <View style={[{ width: size, height: size }, style]}>
      {lit ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.glow,
            {
              width: glowSize,
              height: glowSize,
              top: (size - glowSize) / 2,
              start: (size - glowSize) / 2,
              opacity: reduceMotion
                ? 0.5
                : glow.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.75] }),
              transform: reduceMotion
                ? undefined
                : [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1.06] }) }],
            },
          ]}
        >
          <Svg width={glowSize} height={glowSize} viewBox="0 0 24 24">
            <Defs>
              <RadialGradient id={`g${uid}`} cx="50%" cy="55%" r="50%">
                <Stop offset="0" stopColor="#FF9A1F" stopOpacity={0.55} />
                <Stop offset="0.55" stopColor="#FF7A1F" stopOpacity={0.18} />
                <Stop offset="1" stopColor="#FF7A1F" stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Path d="M0 0h24v24H0z" fill={`url(#g${uid})`} />
          </Svg>
        </Animated.View>
      ) : null}

      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Defs>
          <LinearGradient id={`f${uid}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={stops[0]} />
            <Stop offset="0.5" stopColor={stops[1]} />
            <Stop offset="1" stopColor={stops[2]} />
          </LinearGradient>
        </Defs>
        <Path d={FLAME_PATH} fill={`url(#f${uid})`} />
      </Svg>

      {lit ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.overlay,
            {
              opacity: reduceMotion
                ? 0.85
                : flicker.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
              transform: reduceMotion
                ? undefined
                : [
                    { scaleY: flicker.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.06] }) },
                  ],
            },
          ]}
        >
          <Svg width={size} height={size} viewBox="0 0 24 24">
            <Defs>
              <LinearGradient id={`c${uid}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#FFFBE8" />
                <Stop offset="1" stopColor="#FFD166" />
              </LinearGradient>
            </Defs>
            <Path d={CORE_PATH} fill={`url(#c${uid})`} />
          </Svg>
        </Animated.View>
      ) : null}

      {lit && !reduceMotion
        ? SPARKLES.map((sparkle, i) => {
            const side = size * sparkle.size;
            return (
              <Animated.View
                key={i}
                pointerEvents="none"
                style={[
                  styles.sparkle,
                  {
                    width: side,
                    height: side,
                    top: size * sparkle.y,
                    start: size * sparkle.x,
                    opacity: twinkle[i],
                    transform: [
                      { scale: twinkle[i].interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) },
                    ],
                  },
                ]}
              >
                <Svg width={side} height={side} viewBox="0 0 12 12">
                  <Path d={SPARKLE_PATH} fill="#FFE9A8" />
                </Svg>
              </Animated.View>
            );
          })
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  glow: {
    position: 'absolute',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  sparkle: {
    position: 'absolute',
  },
});
