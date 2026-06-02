import React, { useEffect, useRef } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';

/**
 * FadeInUp — entrance animation that fades content in while it rises into place.
 *
 * Animates only `opacity` + `translateY` on the native driver, so it stays on
 * the compositor thread and never triggers layout/paint
 * (SMOOTHNESS_AND_DESIGN_PLAYBOOK §8). Stagger siblings with increasing `delay`
 * for a polished, sequenced reveal (ease-out for a natural settle, §8).
 */
export interface FadeInUpProps {
  children: React.ReactNode;
  /** Delay before the entrance starts (ms). Stagger siblings with bigger delays. */
  delay?: number;
  /** Distance in px the content travels up into place. Default 12. */
  distance?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}

export function FadeInUp({
  children,
  delay = 0,
  distance = 12,
  duration = 320,
  style,
}: FadeInUpProps) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(t, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [t, delay, duration]);

  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] });

  return (
    <Animated.View style={[{ opacity: t, transform: [{ translateY }] }, style]}>
      {children}
    </Animated.View>
  );
}
