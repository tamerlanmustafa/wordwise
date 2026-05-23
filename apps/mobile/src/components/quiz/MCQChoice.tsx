/**
 * MCQChoice — single row in the 4-stacked synonym MCQ.
 *
 * State matrix (cf. tabs2/quiz.jsx §7.1):
 *   idle           — default chip, full shadow, tappable
 *   selected (idle) — same visual; the tap registers as 'correct' or
 *                     'wrong' on the next tick. We don't render a
 *                     "selected but unscored" intermediate.
 *   correct        — success border + tint + green check glyph (the
 *                    user tapped the right one)
 *   wrong          — error border + tint + red × glyph
 *   reveal-correct — same as correct (used to highlight the *actual*
 *                    answer after the user picked wrong)
 *
 * Disabled (post-answer, untapped wrong-eligible choices) get
 * opacity 0.4. The component takes a single `state` plus optional
 * `disabled` flag; the parent SynonymMCQCard composes the matrix.
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';

const SERIF_FAMILY = 'Source Serif 4';

export type MCQChoiceState = 'idle' | 'correct' | 'wrong' | 'reveal-correct';

export interface MCQChoiceProps {
  label: string;
  state: MCQChoiceState;
  /** Visually dimmed (opacity 0.4) — used for the untapped wrong-eligible
   *  rows after the user has answered. Doesn't disable the press
   *  handler at React-Native level; the parent is responsible for
   *  ignoring late taps. */
  disabled?: boolean;
  onPress?: () => void;
}

export function MCQChoice({ label, state, disabled, onPress }: MCQChoiceProps) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  const isCorrect = state === 'correct' || state === 'reveal-correct';
  const isWrong = state === 'wrong';
  const isIdle = state === 'idle';

  const border = isCorrect ? tc.successBorder : isWrong ? tc.errorBorder : tc.border;
  const bg = isCorrect ? tc.successTint : isWrong ? tc.errorTint : tc.paper;
  const fg = isCorrect ? tc.success : isWrong ? tc.error : tc.text;

  return (
    <Pressable
      onPress={disabled || !isIdle ? undefined : onPress}
      style={({ pressed }) => [
        s.row,
        {
          borderColor: border,
          backgroundColor: bg,
          // Drop the shadow once we've answered to avoid layered visual
          // noise behind the colored states.
          ...(isIdle ? s.idleShadow : null),
        },
        disabled && { opacity: 0.4 },
        pressed && isIdle && { opacity: 0.85 },
      ]}
    >
      <Text style={[s.label, { color: fg }]} numberOfLines={2}>
        {label}
      </Text>
      {isCorrect ? (
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={tc.success} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M5 12l4 4 10-10" />
        </Svg>
      ) : isWrong ? (
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={tc.error} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M6 6l12 12M18 6L6 18" />
        </Svg>
      ) : null}
    </Pressable>
  );
}

const makeStyles = (_tc: ThemeColors) =>
  StyleSheet.create({
    row: {
      paddingHorizontal: 14,
      paddingVertical: 18,
      borderRadius: 14,
      borderWidth: 2,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    idleShadow: {
      shadowColor: '#000',
      shadowOpacity: 0.1,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 2,
    },
    label: {
      flex: 1,
      fontFamily: SERIF_FAMILY,
      fontSize: 17,
      fontWeight: '600',
      letterSpacing: -0.2,
    },
  });
