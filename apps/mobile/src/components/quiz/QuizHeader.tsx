/**
 * QuizHeader — shared top chrome for both quiz card types.
 *
 * Spec: `tabs2/quiz.jsx → QuizHeader`.
 *
 * Layout (top → bottom):
 *   Total 62px from device top to first row (clears dynamic island).
 *   Parents wrap in `SafeAreaView edges={['top']}` so `insets.top` is
 *   already applied above us; we add `max(12, 62 - insets.top)` to
 *   reach the canvas value on every device.
 *   ─ Row: 36×36 round back · centered movie chip (CEFR badge +
 *      title in serif) · 36×36 round N/total counter (monospace).
 *   ─ 4px gold progress bar at `index/total` fill.
 *
 * Also the header for the *end* of a session, where there is no position
 * in a deck to report: omit `index`/`total` and the counter and progress
 * bar drop out (see `quizHeaderLayout`), leaving the same back button and
 * chip. The counter's slot is held by a spacer so the chip stays centered
 * either way.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useThemeColors, withAlpha, type ThemeColors } from '../../theme/tokens';
import { MONO_FAMILY } from '../../theme/fonts';
import { quizHeaderProgress, quizSegments } from './quizHeaderLayout';

// Spec §7: 62px total clearance from the device top to the first row.
// Parents wrap in `SafeAreaView edges={['top']}`, which already pushes
// content down by `insets.top`. We add whatever's needed to reach 62.
const HEADER_TOP_TARGET = 62;

export interface QuizHeaderProps {
  /** 1-indexed position in the card stack. Omit on a surface with no deck
   *  behind it (the done screen) to drop the counter and the segments. */
  index?: number;
  /** Total card count. Omit alongside `index`. */
  total?: number;
  /** What has been answered so far, in order. Drives the segment colours —
   *  the bar is the round's scorecard, not just a position indicator. */
  outcomes?: readonly boolean[];
  onBack: () => void;
}

export function QuizHeader({ index, total, outcomes, onBack }: QuizHeaderProps) {
  const tc = useThemeColors();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const { showProgress } = quizHeaderProgress(index, total);
  const segments = useMemo(
    () => quizSegments(outcomes ?? [], index ?? 0, total ?? 0),
    [outcomes, index, total],
  );

  // The sweep across the live segment. A loop rather than a one-shot, so the
  // bar keeps a pulse while you think about the answer.
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!showProgress) return;
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 2600,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [sweep, showProgress]);
  // Clears the dynamic island on every device. Floor at 12 so non-notch
  // devices (where insets.top can be 20) still get breathing room.
  const extraTop = Math.max(12, HEADER_TOP_TARGET - insets.top);

  return (
    <View style={showProgress ? null : s.bareBottom}>
      {/* Top row: back · exercise type · counter */}
      <View style={[s.row, { paddingTop: extraTop }]}>
        <Pressable
          onPress={onBack}
          style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.85 }]}
          hitSlop={6}
        >
          <Svg
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke={tc.textSecondary}
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <Path d="M15 6l-6 6 6 6" />
          </Svg>
        </Pressable>

        {/* Nothing in the middle. The pill named the exercise type, which is
            the one thing the four translations under it already make obvious
            — the same reason the "PICK THE TRANSLATION" prompt went. The slot
            stays so the back button and counter keep their corners. */}
        <View style={s.centreSpacer} />

        {showProgress ? (
          <View style={s.counter}>
            <Text style={s.counterText}>
              {index}/{total}
            </Text>
          </View>
        ) : (
          // Holds the counter's slot so the chip stays optically centered
          // between the two ends of the row rather than drifting right.
          <View style={s.counterSpacer} />
        )}
      </View>

      {/* One segment per question. Answered segments carry their outcome, so
          the bar reports the round as well as your place in it — the same
          scorecard the end screen repeats. */}
      {showProgress ? (
        <View style={s.progressWrap}>
          {segments.map((seg, i) => (
            <View
              key={i}
              style={[
                s.segment,
                {
                  backgroundColor:
                    seg === 'correct'
                      ? tc.success
                      : seg === 'wrong'
                        ? tc.error
                        : seg === 'current'
                          ? withAlpha(tc.gold, 0.3)
                          : tc.divider,
                },
              ]}
            >
              {seg === 'current' ? (
                <Animated.View
                  style={[
                    s.sweep,
                    {
                      backgroundColor: tc.gold,
                      opacity: sweep.interpolate({
                        inputRange: [0, 0.5, 1],
                        outputRange: [0.15, 0.9, 0.15],
                      }),
                    },
                  ]}
                />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    // Without the progress bar the row's own 12pt is the only breathing room
    // under the chip; this restores roughly the bar's share of it.
    bareBottom: {
      paddingBottom: 14,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 18,
      paddingBottom: 12,
      gap: 10,
    },
    iconBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: tc.chipBg,
      borderWidth: 1,
      borderColor: tc.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    centreSpacer: {
      flex: 1,
    },
    counter: {
      minWidth: 36,
      height: 36,
      paddingHorizontal: 8,
      borderRadius: 18,
      backgroundColor: tc.chipBg,
      borderWidth: 1,
      borderColor: tc.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    counterSpacer: {
      width: 36,
      height: 36,
    },
    counterText: {
      fontFamily: MONO_FAMILY,
      fontSize: 11,
      fontWeight: '900',
      color: tc.textSecondary,
    },
    progressWrap: {
      flexDirection: 'row',
      gap: 4,
      paddingHorizontal: 18,
      paddingBottom: 14,
    },
    // `flex: 1` per segment, so a five-card deck and a ten-card deck both fill
    // the width — the bar reports proportion, not absolute length.
    segment: {
      flex: 1,
      height: 5,
      borderRadius: 999,
      overflow: 'hidden',
    },
    sweep: {
      ...StyleSheet.absoluteFillObject,
    },
  });
