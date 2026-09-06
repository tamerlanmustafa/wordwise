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

  // The word deck's construction, answered in this screen's colours: a paper
  // face with a 1.5pt rim, a solid edge under it, and the ink matching the
  // rim. Idle wears the app's accent — the same pairing "Knew it" has — so a
  // fresh question reads as a row of buttons rather than a row of panels, and
  // the answered states swap that one accent for the verdict.
  //
  // The two-stop gradient fill went with it. It was a 4pt vertical shift to
  // make a 60pt tile read as a lit surface, which is exactly the work the
  // edge already does — and on the answered states it turned a colour that
  // means something into a wash that only nearly does.
  const edge = isCorrect ? tc.quizCorrectEdge : isWrong ? tc.quizWrongEdge : tc.nodeGoldEdge;
  const border = isCorrect ? tc.success : isWrong ? tc.error : tc.goldOnSurface;
  const ink = isCorrect ? tc.success : isWrong ? tc.error : tc.text;

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
          <View style={[s.tile, { borderColor: border }]}>
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
          </View>
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
    // Paper face, 1.5pt rim, the edge showing beneath — the deck's pills, at
    // a row's proportions. The soft ambient shadow went with the gradient: a
    // solid edge and a blurred drop are two different ways of saying the tile
    // is raised, and together they say it twice.
    tile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: MCQ_CHOICE_MIN_H,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: MCQ_CHOICE_RADIUS,
      borderWidth: 1.5,
      backgroundColor: tc.paper,
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
