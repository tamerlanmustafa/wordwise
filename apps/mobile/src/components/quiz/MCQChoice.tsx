/**
 * MCQChoice — one answer row.
 *
 * A raised tile with a solid bottom edge rather than a flat bordered box. The
 * edge is the whole idea: it is a lip of darker colour under the tile, and
 * pressing shrinks it from 4pt to 2pt while the tile slides down 2pt, so the
 * row visibly compresses under your thumb. A shadow alone cannot do that —
 * shadows say "this floats", edges say "this is a button you can push".
 *
 * State matrix (see mcqLogic.choiceStateFor):
 *   idle           — raised surface, hairline border, 4pt edge
 *   correct        — correct fill + border + edge, ✓ glyph
 *   wrong          — the same structure in wrong colours, ✕ glyph
 *   reveal-correct — correct styling, **no glyph**: this row is the answer,
 *                    not something the user did. Only the miss is annotated,
 *                    or two rows carry marks that mean different things.
 *   dimmed         — flat, no edge, low opacity. An untouched row after the
 *                    answer is scenery, and a raised lip on scenery competes
 *                    with the two rows that matter.
 *
 * The index badge (1–4) is not decoration: it gives every row a fixed-width
 * leading element, so labels of wildly different lengths still start on the
 * same x and the column reads as a list rather than as ragged prose.
 */

import { useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { useThemeColors, withAlpha, type ThemeColors } from '../../theme/tokens';
import { MONO_FAMILY, SERIF_FAMILY } from '../../theme/fonts';
import { alignStart } from '../../i18n/rtl';
import { QUIZ_POP_EASING } from './quizMotion';
import { MCQ_CHOICE_MIN_H, MCQ_CHOICE_RADIUS, type MCQChoiceState } from './mcqLogic';

export type { MCQChoiceState };

/** Depth of the lip under a resting tile, and under a pressed one. */
const EDGE = 4;
const EDGE_PRESSED = 2;

export interface MCQChoiceProps {
  label: string;
  /** 1-based position, shown in the leading badge. */
  position: number;
  state: MCQChoiceState;
  /** Post-answer, untapped rows: flattened and faded to scenery. */
  disabled?: boolean;
  onPress?: () => void;
  /** True on the row the user actually tapped — it gets the pop. The revealed
   *  answer arrives by fade instead, so the eye lands on the miss first. */
  popIn?: boolean;
}

export function MCQChoice({
  label,
  position,
  state,
  disabled,
  onPress,
  popIn,
}: MCQChoiceProps) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  const isCorrect = state === 'correct' || state === 'reveal-correct';
  const isWrong = state === 'wrong';
  const isIdle = state === 'idle';
  // Only the tapped row is annotated — see the docblock.
  const showGlyph = state === 'correct' || state === 'wrong';

  const pressed = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(popIn ? 0 : 1)).current;

  // The answer pop. Overshoots past 1 and settles, which is what makes a tile
  // feel struck rather than recoloured.
  const popped = useRef(false);
  if (popIn && !popped.current) {
    popped.current = true;
    Animated.timing(pop, {
      toValue: 1,
      duration: 380,
      easing: QUIZ_POP_EASING,
      useNativeDriver: true,
    }).start();
  }

  const setPressed = (down: boolean) =>
    Animated.timing(pressed, {
      toValue: down ? 1 : 0,
      duration: 90,
      useNativeDriver: true,
    }).start();

  const edge = isCorrect ? tc.quizCorrectEdge : isWrong ? tc.quizWrongEdge : tc.quizRaisedEdge;
  const border = isCorrect ? tc.successBorder : isWrong ? tc.errorBorder : tc.divider;
  const ink = isCorrect ? tc.success : isWrong ? tc.error : tc.text;
  const fill: [string, string] = isCorrect
    ? [withAlpha(tc.success, 0.22), withAlpha(tc.success, 0.1)]
    : isWrong
      ? [withAlpha(tc.error, 0.22), withAlpha(tc.error, 0.1)]
      : [tc.quizRaisedTop, tc.quizRaisedBottom];

  // Pressing moves the tile down by the depth the lip loses, so the tile's top
  // edge drops and its bottom stays put — the tile compresses instead of
  // sliding.
  const translateY = pressed.interpolate({
    inputRange: [0, 1],
    outputRange: [0, EDGE - EDGE_PRESSED],
  });
  const edgeHeight = pressed.interpolate({
    inputRange: [0, 1],
    outputRange: [EDGE, EDGE_PRESSED],
  });
  const scale = pop.interpolate({
    inputRange: [0, 0.55, 1],
    outputRange: [0.35, 1.09, 1],
  });

  return (
    <Animated.View
      style={[
        s.slot,
        // A dimmed row loses its lip, so the stack flattens behind the answer.
        disabled ? { opacity: 0.38 } : null,
        { transform: [{ scale }] },
      ]}
    >
      {/* The lip. A sibling behind the tile rather than a border on it, so its
          height can animate without relaying out the tile's contents. */}
      {!disabled ? (
        <Animated.View style={[s.edge, { backgroundColor: edge, height: edgeHeight }]} />
      ) : null}

      <Animated.View style={{ transform: [{ translateY }] }}>
        <Pressable
          onPress={disabled || !isIdle ? undefined : onPress}
          onPressIn={() => (isIdle && !disabled ? setPressed(true) : undefined)}
          onPressOut={() => setPressed(false)}
          accessibilityRole="button"
          accessibilityState={{ disabled: !!disabled || !isIdle }}
        >
          <LinearGradient
            colors={fill}
            style={[
              s.tile,
              { borderColor: border, borderWidth: isIdle ? StyleSheet.hairlineWidth : 1.5 },
              isIdle && !disabled ? s.ambient : null,
            ]}
          >
            <View style={[s.badge, { borderColor: withAlpha(ink, 0.35) }]}>
              <Text style={[s.badgeText, { color: ink }]}>{position}</Text>
            </View>

            <Text style={[s.label, { color: ink }]} numberOfLines={2}>
              {label}
            </Text>

            {showGlyph ? (
              <Svg
                width={18}
                height={18}
                viewBox="0 0 24 24"
                fill="none"
                stroke={ink}
                strokeWidth={2.6}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {isWrong ? <Path d="M6 6l12 12M18 6L6 18" /> : <Path d="M4 12.5l5 5L20 6.5" />}
              </Svg>
            ) : null}
          </LinearGradient>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    // Reserves the lip's height so a pressed tile does not shift the rows
    // beneath it — the stack is laid out once and only the tile moves.
    slot: {
      paddingBottom: EDGE,
    },
    edge: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      borderRadius: MCQ_CHOICE_RADIUS,
    },
    tile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: MCQ_CHOICE_MIN_H,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: MCQ_CHOICE_RADIUS,
    },
    ambient: {
      shadowColor: '#000',
      shadowOpacity: 0.16,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    badge: {
      width: 26,
      height: 26,
      borderRadius: 8,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: {
      fontFamily: MONO_FAMILY,
      fontSize: 11,
      fontWeight: '800',
    },
    label: {
      flex: 1,
      minWidth: 0,
      fontFamily: SERIF_FAMILY,
      fontSize: 18,
      fontWeight: '600',
      letterSpacing: -0.2,
      textAlign: alignStart,
      color: tc.text,
    },
  });
