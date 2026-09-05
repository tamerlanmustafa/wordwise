/**
 * SearchFieldGlow — the gold sweep that runs around the search field when you
 * tap it, then settles into the field's ordinary gold border.
 *
 * The field's focus state used to be a border that changed colour on the same
 * frame as the keyboard appearing, which is easy to miss when your eye is on
 * the keyboard rather than the field. This gives the tap something to point at
 * and then gets out of the way.
 *
 * ## How the ring is drawn
 *
 * There is no conic gradient in React Native, so a light does not travel round
 * a border by itself. What travels here is a *rotating linear gradient*
 * (transparent → gold → transparent) on a square large enough to cover the
 * field at any angle — its diagonal. The field's own opaque background is
 * painted on top with a 2pt inset, so all that shows of the square is the rim,
 * and a rotating band read through a rim looks like a light going round it.
 *
 * The square has to be measured rather than guessed: the field is `flex: 1`
 * beside a fixed filter button, so its width is only known at layout. A square
 * sized to the *width* alone would leave the corners uncovered a quarter of
 * the way through every turn.
 *
 * ## Why it is a sibling of the field, not a child
 *
 * A child would have to sit behind the field's background to be clipped into a
 * rim, and the background is what makes the field readable. As a sibling
 * underneath, the field paints over the middle and no z-order inside the input
 * has to be disturbed. `pointerEvents="none"` keeps the whole thing out of the
 * touch path — it is decoration over a text input, and a decoration that eats
 * a tap is worse than no decoration.
 *
 * Rotation and opacity are both native-driver properties, so the sweep runs
 * off the JS thread and does not stutter while the keyboard animates in.
 */

import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors } from '../../theme/tokens';

/** One full turn. Two of them run, so the sweep lasts ~1.4s in total — long
 *  enough to read as deliberate, short enough not to become the thing you are
 *  waiting for before you can type. */
const TURN_MS = 700;
const TURNS = 2;
/** The rim's thickness. Any more and it stops reading as a border. */
export const GLOW_INSET = 2;

export function SearchFieldGlow({
  active,
  radius,
}: {
  /** True while the field has focus. The sweep runs once per focus, on the
   *  leading edge — holding focus does not keep it spinning. */
  active: boolean;
  /** The field's corner radius. The ring is drawn `GLOW_INSET` outside it, so
   *  its own radius is this plus the inset. */
  radius: number;
}) {
  const tc = useThemeColors();
  const spin = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!active) {
      fade.setValue(0);
      return;
    }
    if (reduceMotion) {
      // Still acknowledge the tap — a brief steady rim, no spin. The point of
      // the animation is "you focused this", and that survives without motion.
      Animated.sequence([
        Animated.timing(fade, { toValue: 1, duration: 120, useNativeDriver: true }),
        Animated.delay(240),
        Animated.timing(fade, { toValue: 0, duration: 320, useNativeDriver: true }),
      ]).start();
      return;
    }
    spin.setValue(0);
    Animated.parallel([
      Animated.timing(spin, {
        toValue: TURNS,
        duration: TURN_MS * TURNS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      // Up fast, then a long taper. The taper is the "calms down" half: the
      // sweep does not stop, it dims until the ordinary gold border is all
      // that is left, so there is no frame where the ring visibly switches off.
      Animated.sequence([
        Animated.timing(fade, { toValue: 1, duration: 140, useNativeDriver: true }),
        Animated.timing(fade, {
          toValue: 0,
          duration: TURN_MS * TURNS - 140,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [active, reduceMotion, spin, fade]);

  // The square that covers the field at every angle.
  const side = Math.ceil(Math.hypot(box.width, box.height)) || 0;

  return (
    <View
      pointerEvents="none"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setBox((prev) =>
          Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1
            ? prev
            : { width, height },
        );
      }}
      style={[
        StyleSheet.absoluteFillObject,
        {
          margin: -GLOW_INSET,
          borderRadius: radius + GLOW_INSET,
          overflow: 'hidden',
        },
      ]}
    >
      {side > 0 ? (
        <Animated.View
          style={{
            position: 'absolute',
            width: side,
            height: side,
            start: (box.width - side) / 2,
            top: (box.height - side) / 2,
            opacity: fade,
            transform: [
              {
                rotate: spin.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0deg', '360deg'],
                }),
              },
            ],
          }}
        >
          <LinearGradient
            colors={['transparent', tc.gold, tc.goldOnSurface, 'transparent']}
            locations={[0, 0.42, 0.58, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}
