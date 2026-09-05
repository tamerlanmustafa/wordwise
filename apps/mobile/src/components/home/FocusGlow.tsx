/**
 * FocusGlow — the gold sweep that runs around a control when you activate it,
 * then settles into that control's ordinary gold border.
 *
 * Worn by the search field and by the filter button beside it. It was
 * SearchFieldGlow until the filter button wanted the same treatment; a
 * component named after one of its two callers is a component the next person
 * copies rather than reuses.
 *
 * The state it announces used to be a border that changed colour on the same
 * frame as the keyboard appearing, which is easy to miss when your eye is on
 * the keyboard rather than the field. This gives the tap something to point at
 * and then gets out of the way.
 *
 * The effect has a name — it is a **conic-gradient border**, also sold as a
 * "border beam" or an "animated gradient border". On the web it is one
 * declaration: a `conic-gradient` whose angle is animated. React Native has no
 * conic gradient, so it is built here out of the one gradient it does have.
 *
 * ## How the ring is drawn
 *
 * A square large enough to cover the field at any angle — its diagonal — spins
 * once behind it. The field's own opaque background is painted on top with a
 * 2pt inset, so all that shows of the square is the rim.
 *
 * The gradient inside that square is bright at ONE CORNER and transparent
 * everywhere else. That asymmetry is the whole trick, and it is what the first
 * version got wrong: a gradient with its bright band through the *middle*
 * crosses the rim in two opposite places, so it reads as two glints chasing
 * each other 180° apart rather than as one light going round. Anchoring the
 * highlight at a corner leaves exactly one.
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

/** One slow orbit. Slow enough that the eye follows the glare the whole way
 *  round rather than seeing a flicker, and it only goes round once — a second
 *  lap turns an acknowledgement into a loading spinner. */
const TURN_MS = 2200;
/** The glare holds at full strength for this much of the orbit, then fades
 *  over the rest. Fading from the start would leave it dim by the time it
 *  reached the far side, so the lap would look lopsided. */
const HOLD_FRACTION = 0.62;
const FADE_IN_MS = 180;
/** The rim's thickness. Any more and it stops reading as a border. */
export const GLOW_INSET = 2;

export function FocusGlow({
  active,
  radius,
}: {
  /** True while the field has focus. The sweep runs once per focus, on the
   *  leading edge — holding it does not keep it spinning. */
  active: boolean;
  /** The control's corner radius. The ring is drawn `GLOW_INSET` outside it,
   *  so its own radius is this plus the inset. */
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
      // Linear, because a glare that eases is a glare that appears to stick at
      // the corners it starts and ends on.
      Animated.timing(spin, {
        toValue: 1,
        duration: TURN_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      // In fast, hold for most of the lap, then out. The tail is the "calms
      // down" half: the glare keeps travelling while it dims, so there is no
      // frame where the ring visibly switches off.
      Animated.sequence([
        Animated.timing(fade, { toValue: 1, duration: FADE_IN_MS, useNativeDriver: true }),
        Animated.delay(TURN_MS * HOLD_FRACTION - FADE_IN_MS),
        Animated.timing(fade, {
          toValue: 0,
          duration: TURN_MS * (1 - HOLD_FRACTION),
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
          {/* Bright at the leading corner, gone by 45% along the diagonal.
              One highlight, not two — see the note at the top of this file. */}
          <LinearGradient
            colors={[tc.gold, tc.goldOnSurface, 'transparent']}
            locations={[0, 0.18, 0.45]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}
