import React, { useRef } from 'react';
import {
  Animated,
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

/**
 * PressableScale — a button that gives instant tactile feedback.
 *
 * The press dips the content with a native-driver scale spring, so the user
 * sees a response within a frame regardless of what the `onPress` handler does
 * (network call, navigation, …). That keeps every tap under the Doherty
 * threshold's "feels instant" band (SMOOTHNESS_AND_DESIGN_PLAYBOOK §6), and
 * because only `transform` animates it runs on the UI thread (§8).
 *
 * Drop-in for the common `<TouchableOpacity style={...} onPress={...}>` button:
 * the visual style (padding / background / radius) goes on `style`.
 *
 * Haptics hook: a light haptic on press would complete the effect, but that
 * needs `expo-haptics` (not yet a dependency) — wire it into `onPressIn` once
 * the module is added.
 */
export interface PressableScaleProps extends Omit<PressableProps, 'style' | 'children'> {
  style?: StyleProp<ViewStyle>;
  /** Scale applied while pressed. Default 0.96. */
  activeScale?: number;
  children?: React.ReactNode;
}

export function PressableScale({
  style,
  activeScale = 0.96,
  children,
  onPressIn,
  onPressOut,
  ...rest
}: PressableScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (toValue: number) =>
    Animated.spring(scale, {
      toValue,
      useNativeDriver: true,
      speed: 40,
      bounciness: 0,
    }).start();

  const handlePressIn = (e: GestureResponderEvent) => {
    animateTo(activeScale);
    onPressIn?.(e);
  };
  const handlePressOut = (e: GestureResponderEvent) => {
    animateTo(1);
    onPressOut?.(e);
  };

  return (
    <Pressable onPressIn={handlePressIn} onPressOut={handlePressOut} {...rest}>
      <Animated.View style={[{ transform: [{ scale }] }, style]}>{children}</Animated.View>
    </Pressable>
  );
}
