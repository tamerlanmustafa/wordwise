/**
 * The interface icons — everything that used to be an emoji sitting in a row,
 * a chip or a button.
 *
 * Replaces 🎬 🎥 🔊 ♥ ♡ ⚐ ⚑ ✦ ✨ ⚡ 🚫 🧠 📊 👨‍👩‍👧‍👦 🟢🟡🟠🔴.
 *
 * These follow `StreakFlame`'s rules (see `iconMotion`) but invert its
 * default: **they do not animate unless something is happening.** Twelve film
 * glyphs in a filter sheet, each holding an animation loop, would be a
 * wakelock on the UI thread to say nothing at all — the same reasoning that
 * makes `StreakFlame` a dead stop at a streak of zero. So `animate` defaults
 * to off here, and the two icons that report a live state (the speaker while
 * a word is playing, the heart as it is filled) take it as a prop.
 *
 * Every one is drawn from theme tokens or its own fixed palette, so it holds
 * its shape and colour across iOS, Android, OS versions and both themes —
 * none of which is true of a glyph the system font draws for you.
 */

import { useEffect, useId, useRef } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useThemeColors } from '../../../theme/tokens';
import { pingPong, useAnimatedValues, useIconLoops, useReduceMotion } from './iconMotion';

export interface AppIconProps {
  size?: number;
  /** Ink for the monochrome icons. Defaults to the secondary text token. */
  color?: string;
  style?: StyleProp<ViewStyle>;
}

// ---------------------------------------------------------------------------
// FilmIcon — 🎬 (clapperboard) and 🎥 (camera)
// ---------------------------------------------------------------------------

export interface FilmIconProps extends AppIconProps {
  /** `camera` is the 🎥 live-action variant. */
  variant?: 'clapper' | 'camera';
  /** Fill the body with the gold gradient instead of drawing an outline. */
  solid?: boolean;
}

export function FilmIcon({
  size = 20,
  color,
  variant = 'clapper',
  solid = false,
  style,
}: FilmIconProps) {
  const tc = useThemeColors();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const ink = color ?? tc.textSecondary;
  const body = solid ? `url(#fi${uid})` : 'none';
  const stroke = solid ? 'none' : ink;

  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Defs>
          <LinearGradient id={`fi${uid}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#F7C544" />
            <Stop offset="1" stopColor="#C98A12" />
          </LinearGradient>
        </Defs>
        {variant === 'clapper' ? (
          <>
            {/* The hinged slate over the body — what makes it read as film
                rather than as a generic rectangle at 16pt. */}
            <Path
              d="M3 8.4 20.4 5.6l.6 3.6L3.6 12z"
              fill={body}
              stroke={stroke}
              strokeWidth={1.7}
              strokeLinejoin="round"
            />
            <Path d="M7.4 7.7 9 10.9M12 7 13.6 10.2M16.6 6.3 18.2 9.5" stroke={solid ? '#2B2620' : ink} strokeWidth={1.3} strokeOpacity={0.85} />
            <Rect
              x={3.6}
              y={11.4}
              width={17}
              height={8.4}
              rx={1.8}
              fill={body}
              stroke={stroke}
              strokeWidth={1.7}
            />
          </>
        ) : (
          <>
            <Rect x={2.4} y={7.4} width={13.2} height={9.6} rx={2.2} fill={body} stroke={stroke} strokeWidth={1.7} />
            <Path d="M15.6 11.4 21.6 8.2v7.8l-6-3.2z" fill={body} stroke={stroke} strokeWidth={1.7} strokeLinejoin="round" />
            <Circle cx={6.4} cy={5.6} r={2.2} fill={body} stroke={stroke} strokeWidth={1.5} />
            <Circle cx={11.6} cy={5.6} r={2.2} fill={body} stroke={stroke} strokeWidth={1.5} />
          </>
        )}
      </Svg>
    </View>
  );
}

// ---------------------------------------------------------------------------
// SpeakerIcon — 🔊 (pronunciation)
// ---------------------------------------------------------------------------

export interface SpeakerIconProps extends AppIconProps {
  /** True while audio is playing — the two waves pulse outward in turn. */
  playing?: boolean;
}

export function SpeakerIcon({ size = 20, color, playing = false, style }: SpeakerIconProps) {
  const tc = useThemeColors();
  const ink = color ?? tc.textSecondary;
  const reduceMotion = useReduceMotion();
  const running = playing && !reduceMotion;
  const [near, far] = useAnimatedValues(2);

  // The waves travel outward, so the far one lags the near one rather than
  // sharing its beat — two arcs pulsing together read as one blinking shape.
  useIconLoops(running, [near, far], () => [pingPong(near, 520), pingPong(far, 520, 260)]);

  const wave = (v: Animated.Value, rest: number) =>
    reduceMotion ? rest : v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });

  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d="M4 9.4h3.4L12 5.4v13.2l-4.6-4H4z" fill={ink} />
      </Svg>
      <Animated.View style={[styles.fill, { opacity: playing ? wave(near, 0.9) : 0.9 }]} pointerEvents="none">
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M15 9.4a4 4 0 0 1 0 5.2" fill="none" stroke={ink} strokeWidth={1.9} strokeLinecap="round" />
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.fill, { opacity: playing ? wave(far, 0.55) : 0.55 }]} pointerEvents="none">
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M17.8 7a7.4 7.4 0 0 1 0 10" fill="none" stroke={ink} strokeWidth={1.9} strokeLinecap="round" />
        </Svg>
      </Animated.View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// HeartIcon — ♥ / ♡ (favourite)
// ---------------------------------------------------------------------------

const HEART_PATH =
  'M12 20.6 4.4 13.3a4.7 4.7 0 0 1 6.6-6.7l1 1 1-1a4.7 4.7 0 0 1 6.6 6.7z';

export interface HeartIconProps extends AppIconProps {
  filled?: boolean;
}

export function HeartIcon({ size = 20, color, filled = false, style }: HeartIconProps) {
  const tc = useThemeColors();
  const reduceMotion = useReduceMotion();
  const ink = color ?? tc.gold;
  // A one-shot pop on the frame it becomes filled — the tap's own feedback,
  // not a loop. Nothing runs when it is resting in either state.
  const pop = useRef(new Animated.Value(1)).current;
  const wasFilled = useRef(filled);
  useEffect(() => {
    if (filled === wasFilled.current) return;
    wasFilled.current = filled;
    if (!filled || reduceMotion) return;
    pop.setValue(0.6);
    Animated.spring(pop, {
      toValue: 1,
      useNativeDriver: true,
      friction: 4,
      tension: 180,
    }).start();
  }, [filled, pop, reduceMotion]);

  return (
    <Animated.View style={[{ width: size, height: size }, { transform: [{ scale: pop }] }, style]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path
          d={HEART_PATH}
          fill={filled ? ink : 'none'}
          stroke={ink}
          strokeWidth={filled ? 0 : 1.8}
          strokeLinejoin="round"
        />
      </Svg>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// FlagIcon — ⚐ / ⚑ (report an issue)
// ---------------------------------------------------------------------------

export function FlagIcon({ size = 18, color, solid = false, style }: AppIconProps & { solid?: boolean }) {
  const tc = useThemeColors();
  const ink = color ?? tc.textSecondary;
  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d="M6 21V3.6" stroke={ink} strokeWidth={1.9} strokeLinecap="round" />
        <Path
          d="M6 4.2h11.4l-2.6 4 2.6 4H6z"
          fill={solid ? ink : 'none'}
          stroke={ink}
          strokeWidth={1.7}
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

// ---------------------------------------------------------------------------
// SparkleIcon — ✦ ✨ (the For You tab, the animation filter)
// ---------------------------------------------------------------------------

export function SparkleIcon({ size = 16, color, style }: AppIconProps) {
  const tc = useThemeColors();
  const ink = color ?? tc.gold;
  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d="M12 1.8c1.2 6.6 2.4 8.4 8.4 10.2-6 1.8-7.2 3.6-8.4 10.2-1.2-6.6-2.4-8.4-8.4-10.2 6-1.8 7.2-3.6 8.4-10.2z" fill={ink} />
        <Path d="M19.4 2.4c.4 2.2.8 2.8 2.8 3.4-2 .6-2.4 1.2-2.8 3.4-.4-2.2-.8-2.8-2.8-3.4 2-.6 2.4-1.2 2.8-3.4z" fill={ink} fillOpacity={0.6} />
      </Svg>
    </View>
  );
}

// ---------------------------------------------------------------------------
// BoltIcon — ⚡ (the quiz-me pill)
// ---------------------------------------------------------------------------

export function BoltIcon({ size = 16, color, style }: AppIconProps) {
  const tc = useThemeColors();
  const ink = color ?? tc.gold;
  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d="M13.4 1.6 4.6 13.4h5.6L9.8 22.4l9-12.2h-5.8z" fill={ink} />
      </Svg>
    </View>
  );
}

// ---------------------------------------------------------------------------
// BlockIcon — 🚫 (hide this word / no ads)
// ---------------------------------------------------------------------------

export function BlockIcon({ size = 18, color, style }: AppIconProps) {
  const tc = useThemeColors();
  const ink = color ?? tc.error;
  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Circle cx={12} cy={12} r={9} fill="none" stroke={ink} strokeWidth={2} />
        <Path d="M5.9 5.9 18.1 18.1" stroke={ink} strokeWidth={2} strokeLinecap="round" />
      </Svg>
    </View>
  );
}

// ---------------------------------------------------------------------------
// BrainIcon — 🧠 (spaced repetition)
// ---------------------------------------------------------------------------

export function BrainIcon({ size = 20, color, style }: AppIconProps) {
  const tc = useThemeColors();
  const ink = color ?? tc.primaryOnSurface;
  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path
          d="M12 4.2v15.4M12 6a3 3 0 0 0-5.6-1.2A2.8 2.8 0 0 0 4 9.4a3 3 0 0 0 .6 4.4A3 3 0 0 0 7.4 19a3 3 0 0 0 4.6-1M12 6a3 3 0 0 1 5.6-1.2A2.8 2.8 0 0 1 20 9.4a3 3 0 0 1-.6 4.4A3 3 0 0 1 16.6 19a3 3 0 0 1-4.6-1"
          fill="none"
          stroke={ink}
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ChartIcon — 📊 (detailed stats)
// ---------------------------------------------------------------------------

export function ChartIcon({ size = 20, color, style }: AppIconProps) {
  const tc = useThemeColors();
  const ink = color ?? tc.primaryOnSurface;
  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d="M4 20.4h16" stroke={ink} strokeWidth={1.9} strokeLinecap="round" />
        <Rect x={5.2} y={12} width={3.6} height={6.4} rx={1} fill={ink} />
        <Rect x={10.2} y={7.2} width={3.6} height={11.2} rx={1} fill={ink} />
        <Rect x={15.2} y={9.8} width={3.6} height={8.6} rx={1} fill={ink} />
      </Svg>
    </View>
  );
}

// ---------------------------------------------------------------------------
// FamilyIcon — 👨‍👩‍👧‍👦 (the family plan)
// ---------------------------------------------------------------------------

export function FamilyIcon({ size = 44, color, style }: AppIconProps) {
  const tc = useThemeColors();
  const ink = color ?? tc.primaryOnSurface;
  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        {/* two adults behind, two children in front */}
        <Circle cx={7.4} cy={6.4} r={2.9} fill={ink} fillOpacity={0.9} />
        <Path d="M2.2 17.4a5.2 5.2 0 0 1 10.4 0z" fill={ink} fillOpacity={0.9} />
        <Circle cx={16.6} cy={6.4} r={2.9} fill={ink} fillOpacity={0.65} />
        <Path d="M11.4 17.4a5.2 5.2 0 0 1 10.4 0z" fill={ink} fillOpacity={0.65} />
        <Circle cx={9.2} cy={15.2} r={2} fill={ink} />
        <Path d="M5.6 22.2a3.6 3.6 0 0 1 7.2 0z" fill={ink} />
        <Circle cx={15.2} cy={15.8} r={1.7} fill={ink} fillOpacity={0.8} />
        <Path d="M12.2 22.2a3.1 3.1 0 0 1 6.2 0z" fill={ink} fillOpacity={0.8} />
      </Svg>
    </View>
  );
}

// ---------------------------------------------------------------------------
// LevelDot — 🟢 🟡 🟠 🔴 (the CEFR filter chips)
// ---------------------------------------------------------------------------

/** The four bands the coloured-circle emoji encoded, as real colours. */
export const LEVEL_DOT_COLORS: Record<string, string> = {
  A1: '#4CAF9A',
  A2: '#4CAF9A',
  B1: '#E8B93B',
  B2: '#E08A3C',
  C1: '#D75A4A',
  C2: '#D75A4A',
};

export function LevelDot({ level, size = 10, style }: { level: string; size?: number; style?: StyleProp<ViewStyle> }) {
  const tc = useThemeColors();
  const fill = LEVEL_DOT_COLORS[level] ?? tc.textFaint;
  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 12 12">
        <Circle cx={6} cy={6} r={5.4} fill={fill} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject },
});
