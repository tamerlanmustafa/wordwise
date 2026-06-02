import { useEffect, useRef } from 'react';
import { Animated, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';

/**
 * Skeleton — animated placeholder block for loading states.
 *
 * Replaces bare `ActivityIndicator` spinners: a skeleton that mirrors the
 * final layout reads as "almost there" instead of "stuck", and is perceived
 * as faster for the same load time (see SMOOTHNESS_AND_DESIGN_PLAYBOOK §2).
 *
 * Animates **opacity only** on the native driver so the pulse runs on the
 * UI/compositor thread and never touches layout/paint — cheap enough to render
 * many at once without dropping frames (playbook §8).
 *
 * Pass a `color` from the surrounding palette (theme token or local constant)
 * so the block sits naturally on its surface.
 */
export interface SkeletonProps {
  width?: DimensionValue;
  height?: DimensionValue;
  /** Corner radius. Defaults to 6. */
  radius?: number;
  /** Base block color — pick something close to the surface it sits on. */
  color?: string;
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({
  width = '100%',
  height = 12,
  radius = 6,
  color = 'rgba(0,0,0,0.08)',
  style,
}: SkeletonProps) {
  const pulse = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: color, opacity: pulse },
        style,
      ]}
    />
  );
}
