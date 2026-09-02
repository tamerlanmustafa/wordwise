import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  type DimensionValue,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useThemeColors } from '../../theme/tokens';

/**
 * Skeleton — animated placeholder block for loading states (Motion §E3).
 *
 * Replaces bare `ActivityIndicator` spinners: a skeleton that mirrors the
 * final layout reads as "almost there" instead of "stuck", and is perceived
 * as faster for the same load time (SMOOTHNESS_AND_DESIGN_PLAYBOOK §2).
 *
 * Two looks, both native-driver (UI/compositor thread, never layout/paint —
 * playbook §8):
 *   • default — an opacity pulse.
 *   • `sheen`  — a brighter band (tc.skeletonSheen) sweeps across the block.
 *
 * Colours default to the theme `skeleton`/`skeletonSheen` tokens; pass `color`
 * to override for a surface that isn't the app background. Honors reduce-motion
 * by falling back to a static block.
 *
 * Invisible to screen readers, on both platforms. A placeholder has nothing to
 * say — it is a drawing of content that has not arrived — and a feed skeleton
 * is a dozen of them, so without this VoiceOver and TalkBack walk the user
 * through a stack of unlabelled empty boxes before the real content lands and
 * replaces them. Marking the primitive is what makes that true everywhere;
 * doing it per call site is how half of them end up announced.
 */
export interface SkeletonProps {
  width?: DimensionValue;
  height?: DimensionValue;
  /** Corner radius. Defaults to 6. */
  radius?: number;
  /** Base block color. Defaults to the theme `skeleton` token. */
  color?: string;
  /** Use the sweeping-sheen look instead of the opacity pulse. */
  sheen?: boolean;
  /** Stagger the animation start (ms) — e.g. successive rows in a list. */
  delay?: number;
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({
  width = '100%',
  height = 12,
  radius = 6,
  color,
  sheen = false,
  delay = 0,
  style,
}: SkeletonProps) {
  const tc = useThemeColors();
  const base = color ?? tc.skeleton;
  const [reduceMotion, setReduceMotion] = useState(false);
  const [blockW, setBlockW] = useState(0);
  const pulse = useRef(new Animated.Value(0.5)).current;
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => mounted && setReduceMotion(v));
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion || sheen) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, delay, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion, sheen, delay]);

  useEffect(() => {
    if (reduceMotion || !sheen || blockW === 0) return;
    const loop = Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration: 1200, delay, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [sweep, reduceMotion, sheen, blockW, delay]);

  const onLayout = sheen
    ? (e: LayoutChangeEvent) => setBlockW(e.nativeEvent.layout.width)
    : undefined;

  if (sheen) {
    const translateX = sweep.interpolate({
      inputRange: [0, 1],
      outputRange: [-blockW, blockW],
    });
    return (
      <Animated.View
        onLayout={onLayout}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[{ width, height, borderRadius: radius, backgroundColor: base, overflow: 'hidden' }, style]}
      >
        {!reduceMotion && blockW > 0 ? (
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { width: blockW * 0.6, backgroundColor: tc.skeletonSheen, transform: [{ translateX }] },
            ]}
          />
        ) : null}
      </Animated.View>
    );
  }

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { width, height, borderRadius: radius, backgroundColor: base, opacity: reduceMotion ? 0.7 : pulse },
        style,
      ]}
    />
  );
}
