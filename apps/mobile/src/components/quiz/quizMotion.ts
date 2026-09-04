/**
 * quizMotion — the arrival choreography every quiz element shares.
 *
 * The complaint this exists to answer: cards *appeared*. A new question
 * replaced the old one at full opacity in a single frame, so the deck read as
 * a slideshow rather than as something advancing. Nothing was wrong with any
 * individual screen; what was missing was the half-second that tells you a new
 * thing has arrived.
 *
 * The timings live here rather than in each component because the effect is
 * the *relationship* between them — a word card that leads its options by 70ms
 * is a stagger, and a word card that leads by 300ms is a delay. Four
 * components each holding their own numbers is four places for that
 * relationship to drift.
 *
 * ## Rules that are not negotiable
 *
 * - **Transform and opacity only**, so `useNativeDriver: true` holds. Animating
 *   width/height/margin here would drop the whole run onto the JS thread,
 *   which on a mid-range Android is exactly where a stagger turns into a stutter.
 * - **Reduced motion collapses to a fade.** A slide is decoration; the fade
 *   still says "this is new" without moving anything across the screen for
 *   someone who asked the OS not to.
 */

import { useEffect, useMemo, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';

/** The design's entry curve — a fast start easing into a long settle. */
export const QUIZ_ENTRY_EASING = Easing.bezier(0.22, 0.9, 0.24, 1);
/** The spring-ish pop used when a tapped tile answers back. */
export const QUIZ_POP_EASING = Easing.bezier(0.34, 1.56, 0.64, 1);

export const QUIZ_ENTRY_MS = 560;
export const QUIZ_REDUCED_MS = 160;
export const QUIZ_STAGGER_MS = 60;

/** How far an arriving element travels, in points. */
export const QUIZ_ENTRY_X = 38;
export const QUIZ_ENTRY_Y = 8;
export const QUIZ_ENTRY_SCALE = 0.982;

/**
 * Delay for the nth element in a question: the word card leads, then each
 * option follows. Not simply `i * stagger` — the word card gets a slightly
 * wider gap before the first option (70 rather than 60) so the eye reads
 * "word, *then* the answers" rather than one continuous ripple.
 */
export function entryDelay(index: number): number {
  if (index <= 0) return 0;
  return 10 + index * QUIZ_STAGGER_MS;
}

/**
 * Whether the OS has asked us to stop moving things. Read once per mount and
 * kept in a ref: this drives an animation config, not a render, so a state
 * update would restart the very animation it is describing.
 */
export function useReducedMotion(): React.MutableRefObject<boolean> {
  const reduced = useRef(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (alive) reduced.current = on;
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => {
      reduced.current = on;
    });
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);
  return reduced;
}

export interface EntryStyle {
  opacity: Animated.Value;
  transform: [
    { translateX: Animated.AnimatedInterpolation<number> },
    { translateY: Animated.AnimatedInterpolation<number> },
    { scale: Animated.AnimatedInterpolation<number> },
  ];
}

/**
 * One element's arrival.
 *
 * `resetKey` is the question identity: changing it re-runs the entry, which is
 * what makes every question arrive rather than only the first. The animation
 * is driven from a single 0→1 value so the four interpolations cannot fall out
 * of step with each other.
 */
export function useEntryAnimation(index: number, resetKey: string | number) {
  const progress = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();

  useEffect(() => {
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: reduced.current ? QUIZ_REDUCED_MS : QUIZ_ENTRY_MS,
      delay: reduced.current ? 0 : entryDelay(index),
      easing: reduced.current ? Easing.out(Easing.quad) : QUIZ_ENTRY_EASING,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
    // `reduced` is a ref — reading it here is deliberate, and it must not be a
    // dependency or a mid-session accessibility change would restart the
    // current question's entry animation under the user.
  }, [progress, index, resetKey, reduced]);

  return useMemo<EntryStyle>(
    () => ({
      opacity: progress,
      transform: [
        {
          translateX: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [QUIZ_ENTRY_X, 0],
          }),
        },
        {
          translateY: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [QUIZ_ENTRY_Y, 0],
          }),
        },
        {
          scale: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [QUIZ_ENTRY_SCALE, 1],
          }),
        },
      ],
    }),
    [progress],
  );
}
