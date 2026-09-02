/**
 * The reward icons — what a chest, a milestone or a podium place looks like
 * now that it is drawn rather than typed.
 *
 * These replace ⭐ 🌟 🛡️ 🎉 🏅 🥇🥈🥉 🔒. They are the ones that appear at a
 * moment of arrival, so unlike the decorative icons they animate by default,
 * following `StreakFlame`'s rules (see `iconMotion`): opacity and transform
 * only, native driver, reduce-motion renders the same picture standing still.
 *
 * Why an emoji was the wrong thing here specifically: the reward overlay is
 * the app's biggest celebratory beat, and a system emoji is drawn by the OS
 * in a font we do not control. It ignores our palette, changes shape between
 * iOS and Android and between OS versions, cannot be lit or dimmed to match
 * the state it is reporting, and sits on the text baseline rather than in the
 * layout box — which is why the shield needed a variation selector to stop
 * rendering as a monochrome outline in the first place.
 */

import { useId } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useThemeColors } from '../../../theme/tokens';
import { pingPong, twinkle, useAnimatedValues, useIconLoops, useReduceMotion } from './iconMotion';

export interface IconProps {
  /** Box side in points. */
  size?: number;
  /** Run the loops. Reward icons default to on — they appear on arrival. */
  animate?: boolean;
  style?: StyleProp<ViewStyle>;
}

const STAR_PATH =
  'M12 1.6l3.1 6.9 7.5.8-5.6 5 1.6 7.4L12 17.9 5.4 21.7 7 14.3 1.4 9.3l7.5-.8z';
const SPARKLE_PATH =
  'M6 0C6.6 3.6 8.4 5.4 12 6C8.4 6.6 6.6 8.4 6 12C5.4 8.4 3.6 6.6 0 6C3.6 5.4 5.4 3.6 6 0Z';

// ---------------------------------------------------------------------------
// StarIcon — ⭐ 🌟 ★ ☆
// ---------------------------------------------------------------------------

export interface StarIconProps extends IconProps {
  /** Solid gold vs a hollow outline. The ☆/★ pair, as one component. */
  filled?: boolean;
  /** The 🌟 variant: adds the breathing glow and three drifting sparkles. */
  glow?: boolean;
  /** Overrides the outline colour when not filled. */
  color?: string;
}

export function StarIcon({
  size = 20,
  filled = true,
  glow = false,
  color,
  animate = true,
  style,
}: StarIconProps) {
  const tc = useThemeColors();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const reduceMotion = useReduceMotion();
  const running = animate && glow && !reduceMotion;
  const [pulse, s0, s1, s2] = useAnimatedValues(4);

  useIconLoops(running, [pulse, s0, s1, s2], () => [
    pingPong(pulse, 1400),
    twinkle(s0, 2600, 640, 0),
    twinkle(s1, 2600, 640, 850),
    twinkle(s2, 2600, 640, 1700),
  ]);

  const outline = color ?? tc.textFaint;
  const glowSize = size * 1.75;
  const sparkles = [
    { x: -0.14, y: 0.02, k: 0.34, v: s0 },
    { x: 0.84, y: 0.2, k: 0.28, v: s1 },
    { x: -0.06, y: 0.66, k: 0.22, v: s2 },
  ];

  return (
    <View style={[{ width: size, height: size }, style]}>
      {glow ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.absolute,
            {
              width: glowSize,
              height: glowSize,
              top: (size - glowSize) / 2,
              start: (size - glowSize) / 2,
              opacity: reduceMotion
                ? 0.5
                : pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] }),
              transform: reduceMotion
                ? undefined
                : [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1.06] }) }],
            },
          ]}
        >
          <Svg width={glowSize} height={glowSize} viewBox="0 0 24 24">
            <Defs>
              <RadialGradient id={`sg${uid}`} cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor="#FFD166" stopOpacity={0.55} />
                <Stop offset="0.6" stopColor="#FFB020" stopOpacity={0.16} />
                <Stop offset="1" stopColor="#FFB020" stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Path d="M0 0h24v24H0z" fill={`url(#sg${uid})`} />
          </Svg>
        </Animated.View>
      ) : null}

      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Defs>
          <LinearGradient id={`sf${uid}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFE9A8" />
            <Stop offset="0.55" stopColor="#F7C544" />
            <Stop offset="1" stopColor="#E09A1B" />
          </LinearGradient>
        </Defs>
        <Path
          d={STAR_PATH}
          fill={filled ? `url(#sf${uid})` : 'none'}
          stroke={filled ? 'none' : outline}
          strokeWidth={filled ? 0 : 1.8}
          strokeLinejoin="round"
        />
      </Svg>

      {glow && running
        ? sparkles.map((sp, i) => {
            const side = size * sp.k;
            return (
              <Animated.View
                key={i}
                pointerEvents="none"
                style={[
                  styles.absolute,
                  {
                    width: side,
                    height: side,
                    top: size * sp.y,
                    start: size * sp.x,
                    opacity: sp.v,
                    transform: [
                      { scale: sp.v.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) },
                    ],
                  },
                ]}
              >
                <Svg width={side} height={side} viewBox="0 0 12 12">
                  <Path d={SPARKLE_PATH} fill="#FFF0BE" />
                </Svg>
              </Animated.View>
            );
          })
        : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// ShieldIcon — 🛡️ (the streak freeze)
// ---------------------------------------------------------------------------

export function ShieldIcon({ size = 20, animate = true, style }: IconProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const reduceMotion = useReduceMotion();
  const running = animate && !reduceMotion;
  const [frost] = useAnimatedValues(1);

  useIconLoops(running, [frost], () => [pingPong(frost, 1650)]);

  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Defs>
          <LinearGradient id={`sh${uid}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#BFE3FF" />
            <Stop offset="0.55" stopColor="#6FA8E8" />
            <Stop offset="1" stopColor="#3D6FBF" />
          </LinearGradient>
        </Defs>
        <Path d="M12 2.2 20 5v6.4c0 5.2-3.4 8.8-8 10.4-4.6-1.6-8-5.2-8-10.4V5z" fill={`url(#sh${uid})`} />
      </Svg>
      {/* A frost gleam breathing across the face, as opacity — not a swept
          clipPath, which would take the animation off the native driver. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.fill,
          {
            opacity: reduceMotion
              ? 0.55
              : frost.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.8] }),
          },
        ]}
      >
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M12 4.2 18 6.3v5.1c0 3.6-2.2 6.2-6 7.6z" fill="#FFFFFF" fillOpacity={0.42} />
          <Path d="M12 7.4v8.4M8.6 10.2l6.8 3.2M15.4 10.2l-6.8 3.2" stroke="#FFFFFF" strokeWidth={1.1} strokeLinecap="round" />
        </Svg>
      </Animated.View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ConfettiIcon — 🎉 (a milestone unlock)
// ---------------------------------------------------------------------------

const CONFETTI = [
  { x: 0.06, y: 0.1, w: 0.2, h: 0.11, c: '#F7C544', r: -18 },
  { x: 0.62, y: 0.04, w: 0.16, h: 0.1, c: '#7C5CBF', r: 24 },
  { x: 0.78, y: 0.42, w: 0.18, h: 0.1, c: '#4CAF9A', r: -12 },
  { x: 0.0, y: 0.52, w: 0.15, h: 0.1, c: '#E8705A', r: 30 },
  { x: 0.34, y: 0.72, w: 0.19, h: 0.11, c: '#5B9BD5', r: -26 },
];

export function ConfettiIcon({ size = 28, animate = true, style }: IconProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const reduceMotion = useReduceMotion();
  const running = animate && !reduceMotion;
  const values = useAnimatedValues(CONFETTI.length);

  useIconLoops(running, values, () =>
    values.map((v, i) => twinkle(v, 2200, 900, i * 260)),
  );

  return (
    <View style={[{ width: size, height: size }, style]}>
      {/* The popper cone stays put; the paper is what moves. */}
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Defs>
          <LinearGradient id={`cf${uid}`} x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor="#E09A1B" />
            <Stop offset="1" stopColor="#F7C544" />
          </LinearGradient>
        </Defs>
        <Path d="M3.4 20.6 9.2 9.4l5.4 5.4z" fill={`url(#cf${uid})`} />
        <Path d="M9.2 9.4 14.6 14.8" stroke="#FFF0BE" strokeWidth={0.9} strokeOpacity={0.5} />
      </Svg>
      {CONFETTI.map((c, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={[
            styles.absolute,
            {
              width: size * c.w,
              height: size * c.h,
              top: size * c.y,
              start: size * c.x,
              borderRadius: 1.5,
              backgroundColor: c.c,
              opacity: reduceMotion ? 0.9 : values[i],
              transform: [
                { rotate: `${c.r}deg` },
                ...(reduceMotion
                  ? []
                  : [
                      {
                        scale: values[i].interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.4, 1],
                        }),
                      },
                    ]),
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// MedalIcon — 🏅 🥇 🥈 🥉
// ---------------------------------------------------------------------------

const MEDAL_METAL: Record<number, [string, string, string]> = {
  1: ['#FFE9A8', '#F7C544', '#C98A12'],
  2: ['#F2F4F7', '#C8CDD6', '#8E96A3'],
  3: ['#F0C9A8', '#CE8E56', '#96613A'],
};

export interface MedalIconProps extends IconProps {
  /** 1/2/3 pick gold, silver, bronze. Anything else is the generic 🏅. */
  rank?: number;
}

export function MedalIcon({ size = 22, rank = 1, animate = false, style }: MedalIconProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const reduceMotion = useReduceMotion();
  const running = animate && !reduceMotion;
  const [shine] = useAnimatedValues(1);
  useIconLoops(running, [shine], () => [pingPong(shine, 1300)]);

  const metal = MEDAL_METAL[rank] ?? MEDAL_METAL[1];

  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Defs>
          <LinearGradient id={`md${uid}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={metal[0]} />
            <Stop offset="0.5" stopColor={metal[1]} />
            <Stop offset="1" stopColor={metal[2]} />
          </LinearGradient>
        </Defs>
        {/* ribbon */}
        <Path d="M7.6 1.6h3.1l2.6 6.2H9.9z" fill="#C0453C" />
        <Path d="M13.3 1.6h3.1l-2.6 6.2h-3.1z" fill="#9E322B" />
        <Circle cx={12} cy={15.4} r={6.4} fill={`url(#md${uid})`} />
        <Circle cx={12} cy={15.4} r={4.3} fill="none" stroke={metal[2]} strokeWidth={0.9} strokeOpacity={0.55} />
      </Svg>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.fill,
          { opacity: reduceMotion ? 0.5 : shine.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.7] }) },
        ]}
      >
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M9.2 12.4a4.3 4.3 0 0 1 4.6-1.5 4.3 4.3 0 0 0-5.1 5.1 4.3 4.3 0 0 1 .5-3.6z" fill="#FFFFFF" fillOpacity={0.75} />
        </Svg>
      </Animated.View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// LockIcon — 🔒 (a badge not yet earned)
// ---------------------------------------------------------------------------

export function LockIcon({ size = 20, style, color }: IconProps & { color?: string }) {
  const tc = useThemeColors();
  const ink = color ?? tc.textFaint;
  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path
          d="M7.6 10.4V7.8a4.4 4.4 0 0 1 8.8 0v2.6"
          fill="none"
          stroke={ink}
          strokeWidth={1.9}
          strokeLinecap="round"
        />
        <Rect x={5} y={10.2} width={14} height={10.4} rx={2.6} fill={ink} />
        <Circle cx={12} cy={15.4} r={1.5} fill="#FFFFFF" fillOpacity={0.75} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  absolute: { position: 'absolute' },
  fill: { ...StyleSheet.absoluteFillObject },
});
