import React, { useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { feedback } from '../../utils/feedback';

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
 * The light haptic this file has always wanted now fires here (#179), on
 * `onPressIn` alongside the scale dip so both channels land on the same frame.
 * It is gated by the user's Haptics switch inside `utils/feedback`, so this
 * component never reads a preference itself. Set `haptic={false}` on a button
 * whose own handler already fires a stronger one — a double buzz reads as a
 * bug.
 */
export interface PressableScaleProps extends Omit<PressableProps, 'style' | 'children'> {
  style?: StyleProp<ViewStyle>;
  /** Scale applied while pressed. Default 0.96. */
  activeScale?: number;
  /** Fire the light press haptic. Default true. */
  haptic?: boolean;
  children?: React.ReactNode;
}

export function PressableScale({
  style,
  activeScale = 0.96,
  haptic = true,
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
    if (haptic) feedback.tap();
    onPressIn?.(e);
  };
  const handlePressOut = (e: GestureResponderEvent) => {
    animateTo(1);
    onPressOut?.(e);
  };

  return (
    <Pressable
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={flexItemStyle(style)}
      {...rest}
    >
      <Animated.View style={[{ transform: [{ scale }] }, style]}>{children}</Animated.View>
    </Pressable>
  );
}

/**
 * The properties that describe how an element sits AMONG ITS SIBLINGS.
 *
 * This component is two views: an outer `Pressable` that takes the touch, and
 * an inner `Animated.View` that scales. `style` goes on the inner one, because
 * that is where padding, background and radius have to live for the press dip
 * to scale them. But the element that actually sits in the parent's layout is
 * the OUTER one — so `flex: 1` on `style` stretched the inner view to fill a
 * Pressable that was itself only as wide as its content, and did nothing.
 *
 * That is exactly what broke the paywall's plan cards: two `flex: 1` cards in a
 * row that each sized to their text, leaving a gap on the right, and a
 * "7-DAY TRIAL" badge that wrapped onto two lines because its card was only as
 * wide as "then $4.99/mo".
 *
 * So these are COPIED to the outer view as well, not moved. Kept on the inner
 * view too, because `flex: 1` there is what makes it fill the outer one's
 * height — which is how two cards in a row come out the same height.
 *
 * Margins are deliberately not in the list: a margin places the box identically
 * from either view, and every existing call site uses them inside.
 */
const FLEX_ITEM_KEYS = ['flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf'] as const;

export function flexItemStyle(style: StyleProp<ViewStyle>): ViewStyle | undefined {
  const flat = StyleSheet.flatten(style);
  if (!flat) return undefined;
  let out: ViewStyle | undefined;
  for (const key of FLEX_ITEM_KEYS) {
    if (flat[key] !== undefined) {
      out = out ?? {};
      (out as Record<string, unknown>)[key] = flat[key];
    }
  }
  return out;
}
