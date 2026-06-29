/**
 * CountUp — animates a number from 0 → value with an easeOutCubic ramp
 * (Motion §E4: XP / streak / comprehension count-ups). Renders into a <Text>
 * via an Animated listener. Honors reduce-motion by showing the final value
 * immediately.
 *
 * Not native-driver: the value is read on the JS thread to render text, which
 * is fine for a single counter (no per-frame layout).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Text, type StyleProp, type TextStyle } from 'react-native';

export interface CountUpProps {
  value: number;
  duration?: number;
  delay?: number;
  prefix?: string;
  suffix?: string;
  /** Format the (rounded) running value. Defaults to String. */
  format?: (n: number) => string;
  style?: StyleProp<TextStyle>;
}

export function CountUp({ value, duration = 1100, delay = 0, prefix = '', suffix = '', format, style }: CountUpProps) {
  const anim = useRef(new Animated.Value(0)).current;
  const [display, setDisplay] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const fmt = useMemo(() => format ?? ((n: number) => String(n)), [format]);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => mounted && setReduceMotion(v));
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      setDisplay(value);
      return;
    }
    const id = anim.addListener(({ value: v }) => setDisplay(Math.round(v)));
    anim.setValue(0);
    const run = Animated.timing(anim, {
      toValue: value,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    run.start();
    return () => {
      anim.removeListener(id);
      run.stop();
    };
  }, [value, duration, delay, reduceMotion, anim]);

  return (
    <Text style={style}>
      {prefix}
      {fmt(display)}
      {suffix}
    </Text>
  );
}
