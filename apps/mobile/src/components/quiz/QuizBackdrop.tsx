/**
 * QuizBackdrop — the two layers that sit under every quiz screen.
 *
 * 1. A vignette bleeding down from the top edge, tinted by how the question is
 *    going: accent while you are answering, correct green once you are right,
 *    wrong red once you are not. The whole screen answers, not just the row
 *    you tapped — which is the difference between a quiz that reacts and a
 *    quiz that merely records.
 * 2. A scanline texture at ~2% so the flat fills have some grain.
 *
 * ## Why three stacked gradients rather than one
 *
 * The design asks for a radial gradient. React Native has no radial gradient
 * and `expo-linear-gradient` is exactly what its name says, so the vignette is
 * three superimposed linear passes — a vertical falloff plus two horizontal
 * ones easing off each side. At these alphas (0.18 down to 0) the difference
 * from a true radial is not perceptible, and it costs no new native
 * dependency, which keeps the whole redesign shippable as an OTA.
 *
 * The tint cross-fades over 240ms instead of switching, because the answer
 * states arrive on the same frame the tile colours change; a hard cut reads as
 * a flash behind the card.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors, withAlpha, type ThemeColors } from '../../theme/tokens';

export type QuizMood = 'neutral' | 'correct' | 'wrong';

/** How tall the vignette reaches, as a share of the screen. */
const VIGNETTE_H = '52%';
const FADE_MS = 240;

function useMoodTint(mood: QuizMood, tc: ThemeColors): string {
  return useMemo(() => {
    if (mood === 'correct') return tc.success;
    if (mood === 'wrong') return tc.error;
    return tc.gold;
  }, [mood, tc]);
}

/**
 * One tinted vignette. Rendered once per mood and cross-faded, rather than
 * animating the gradient's own colours — `expo-linear-gradient` takes colours
 * as props, so animating them would re-render the native view every frame
 * instead of compositing an opacity on the GPU.
 */
function Vignette({ tint, opacity }: { tint: string; opacity: Animated.Value }) {
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity }]} pointerEvents="none">
      <LinearGradient
        colors={[withAlpha(tint, 0.18), withAlpha(tint, 0.045), 'transparent']}
        locations={[0, 0.44, 1]}
        style={[styles.layer, { height: VIGNETTE_H }]}
      />
      {/* The two horizontal passes are what round the vertical falloff into
          something that reads as centred rather than as a band. */}
      <LinearGradient
        colors={[withAlpha(tint, 0.05), 'transparent']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 0.55, y: 0.5 }}
        style={[styles.layer, { height: VIGNETTE_H }]}
      />
      <LinearGradient
        colors={['transparent', withAlpha(tint, 0.05)]}
        start={{ x: 0.45, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={[styles.layer, { height: VIGNETTE_H }]}
      />
    </Animated.View>
  );
}

export function QuizBackdrop({ mood }: { mood: QuizMood }) {
  const tc = useThemeColors();
  const tint = useMoodTint(mood, tc);

  // Two layers leapfrogging: the incoming tint fades up over the outgoing one,
  // so there is never a frame with no vignette at all.
  const front = useRef(new Animated.Value(1)).current;
  const shown = useRef(tint);
  const previous = useRef(tint);

  if (shown.current !== tint) {
    previous.current = shown.current;
    shown.current = tint;
    front.setValue(0);
  }

  useEffect(() => {
    const anim = Animated.timing(front, {
      toValue: 1,
      duration: FADE_MS,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [tint, front]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Vignette tint={previous.current} opacity={OPAQUE} />
      <Vignette tint={shown.current} opacity={front} />
      <Scanlines color={tc.text} />
    </View>
  );
}

/** The outgoing vignette is always fully painted; the incoming one fades over it. */
const OPAQUE = new Animated.Value(1);

/**
 * Grain. Repeated 1px lines on a 4px pitch at 2% — a real texture image would
 * be an asset to ship and a decode per screen, and at this opacity a stack of
 * hairlines is indistinguishable.
 */
function Scanlines({ color }: { color: string }) {
  const rows = useMemo(() => Array.from({ length: 90 }), []);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {rows.map((_, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            top: i * 4,
            left: 0,
            right: 0,
            height: StyleSheet.hairlineWidth,
            backgroundColor: withAlpha(color, 0.02),
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
});
