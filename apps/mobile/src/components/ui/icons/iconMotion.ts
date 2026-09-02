/**
 * iconMotion — the animation contract every drawn icon in this folder follows.
 *
 * Lifted out of `StreakFlame`, which established it: layered SVG shapes whose
 * *opacity and transform only* are animated, so every loop runs on the native
 * driver and keeps going while JS is busy composing a practice deck. The
 * tempting way to write a shimmer — a bright band swept across a silhouette
 * with an SVG `clipPath` — means animating an SVG element's own props, which
 * cannot use the native driver and is unreliable under the new architecture.
 * Layered opacity reads the same and costs nothing.
 *
 * Three rules, and they are why this is a module rather than a copied block:
 *
 *   1. **An idle icon holds no timers.** `StreakFlame` with `lit={false}` is a
 *      dead stop — grey, still, no loops. An icon that dances while it has
 *      nothing to say is both a lie and a wakelock on the UI thread. Every
 *      icon here takes `animate` and defaults it to *off* for the decorative
 *      ones; only the reward and active-state icons default to on.
 *   2. **Reduce-motion renders the same picture without the loops** — never a
 *      different, simpler icon. The user asked for less movement, not less
 *      interface.
 *   3. **Loop periods that share a beat read as one pulsing object.** Two
 *      layers on 1500ms and 500ms look mechanical; 1500 and 430 look alive.
 *      Pick periods that drift.
 */

import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';

/** True when the OS asks for reduced motion. Polls once on mount. */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => mounted && setReduceMotion(v));
    return () => {
      mounted = false;
    };
  }, []);
  return reduceMotion;
}

/** A 0→1→0 loop on the native driver. */
export function pingPong(
  value: Animated.Value,
  duration: number,
  delay = 0,
): Animated.CompositeAnimation {
  return Animated.loop(
    Animated.sequence([
      Animated.delay(delay),
      Animated.timing(value, {
        toValue: 1,
        duration,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(value, {
        toValue: 0,
        duration,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    ]),
  );
}

/**
 * A brief 0→1→0 blink on a long cycle — the sparkle/twinkle rhythm.
 * `cycle` is the full period including the dead time between blinks.
 */
export function twinkle(
  value: Animated.Value,
  cycle: number,
  flash: number,
  delay: number,
): Animated.CompositeAnimation {
  return Animated.loop(
    Animated.sequence([
      Animated.delay(delay),
      Animated.timing(value, {
        toValue: 1,
        duration: flash / 2,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(value, {
        toValue: 0,
        duration: flash / 2,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.delay(Math.max(0, cycle - flash - delay)),
    ]),
  );
}

/**
 * Run `build()`'s loops while `animate` is true, and stop + reset them when it
 * goes false or the icon unmounts.
 *
 * Resetting matters: a stopped loop leaves its value wherever it happened to
 * be, so an icon that stops mid-pulse keeps that frame's opacity forever. The
 * reset is what makes "off" mean the icon's resting state rather than a random
 * one.
 */
export function useIconLoops(
  animate: boolean,
  values: Animated.Value[],
  build: () => Animated.CompositeAnimation[],
) {
  // `build` changes identity every render; the values do not, and they are
  // what the loops actually drive.
  const buildRef = useRef(build);
  buildRef.current = build;

  useEffect(() => {
    if (!animate) return;
    const loops = buildRef.current();
    loops.forEach((l) => l.start());
    return () => {
      loops.forEach((l) => l.stop());
      values.forEach((v) => v.setValue(0));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate, ...values]);
}

/** Stable Animated.Values — `n` of them, created once. */
export function useAnimatedValues(n: number): Animated.Value[] {
  const ref = useRef<Animated.Value[] | null>(null);
  if (ref.current === null) {
    ref.current = Array.from({ length: n }, () => new Animated.Value(0));
  }
  return ref.current;
}
