/**
 * Confetti — a one-shot celebratory burst (Motion §E4). ~28 pieces fall and
 * rotate with staggered starts, then fade. Native-driver (translateY + rotate
 * + opacity only). Renders nothing under reduce-motion. Absolutely positioned
 * and non-interactive — drop it at the top of a screen's tree.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Dimensions, Easing, StyleSheet, View } from 'react-native';
import { useThemeColors } from '../../theme/tokens';

export interface ConfettiProps {
  /** Number of pieces. Default 28. */
  count?: number;
}

export function Confetti({ count = 28 }: ConfettiProps) {
  const tc = useThemeColors();
  const [reduceMotion, setReduceMotion] = useState(false);
  const { width, height } = Dimensions.get('window');

  const palette = useMemo(() => [tc.gold, tc.primary, tc.success, tc.primaryLight], [tc]);

  const pieces = useMemo(
    () =>
      Array.from({ length: count }).map((_, i) => ({
        key: i,
        left: Math.random() * width,
        size: 6 + Math.random() * 6,
        color: palette[i % palette.length],
        delay: Math.random() * 250,
        duration: 1600 + Math.random() * 1400, // 1.6–3.0s
        spin: 360 + Math.random() * 320, // ~680° max
        drift: (Math.random() - 0.5) * 60,
      })),
    [count, width, palette],
  );

  const anims = useRef(pieces.map(() => new Animated.Value(0))).current;
  const [done, setDone] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (!mounted) return;
      setReduceMotion(v);
      if (v) return;
      Animated.stagger(
        16,
        anims.map((a, i) =>
          Animated.timing(a, {
            toValue: 1,
            duration: pieces[i].duration,
            delay: pieces[i].delay,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ),
      ).start(() => mounted && setDone(true));
    });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (reduceMotion || done) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {pieces.map((p, i) => {
        const a = anims[i];
        const translateY = a.interpolate({ inputRange: [0, 1], outputRange: [-20, height + 40] });
        const translateX = a.interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] });
        const rotate = a.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.spin}deg`] });
        const opacity = a.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] });
        return (
          <Animated.View
            key={p.key}
            style={{
              position: 'absolute',
              left: p.left,
              top: 0,
              width: p.size,
              height: p.size * 1.6,
              borderRadius: 2,
              backgroundColor: p.color,
              opacity,
              transform: [{ translateY }, { translateX }, { rotate }],
            }}
          />
        );
      })}
    </View>
  );
}
