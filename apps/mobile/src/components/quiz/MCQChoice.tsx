/**
 * MCQChoice — single rectangular tile in the 2x2 MCQ answer grid
 * (two tiles top, two bottom; the parent MCQCard owns the grid layout).
 *
 * State matrix (see mcqLogic.choiceStateFor):
 *   idle           — default tile, full shadow, tappable
 *   correct        — success border + tint + green check glyph (the
 *                    user tapped the right one)
 *   wrong          — error border + tint + red × glyph
 *   reveal-correct — same as correct (used to highlight the *actual*
 *                    answer after the user picked wrong)
 *
 * Disabled (post-answer, untapped wrong-eligible tiles) get opacity 0.4.
 * The component takes a single `state` plus optional `disabled` flag;
 * the parent MCQCard composes the matrix.
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import type { MCQChoiceState } from './mcqLogic';

const SERIF_FAMILY = 'Source Serif 4';

export type { MCQChoiceState };

export interface MCQChoiceProps {
  label: string;
  state: MCQChoiceState;
  /** Visually dimmed (opacity 0.4) — used for the untapped wrong-eligible
   *  tiles after the user has answered. Doesn't disable the press
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
        s.tile,
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
      <Text style={[s.label, { color: fg }]} numberOfLines={3}>
        {label}
      </Text>
      {isCorrect || isWrong ? (
        <View style={s.glyph}>
          {isCorrect ? (
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={tc.success} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M5 12l4 4 10-10" />
            </Svg>
          ) : (
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={tc.error} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M6 6l12 12M18 6L6 18" />
            </Svg>
          )}
        </View>
      ) : null}
    </Pressable>
  );
}

const makeStyles = (_tc: ThemeColors) =>
  StyleSheet.create({
    tile: {
      flex: 1,
      minHeight: 92,
      paddingHorizontal: 12,
      paddingVertical: 14,
      borderRadius: 14,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    idleShadow: {
      shadowColor: '#000',
      shadowOpacity: 0.1,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 2,
    },
    // Result glyph pinned to the corner so the centered label doesn't
    // shift when it appears.
    glyph: {
      position: 'absolute',
      top: 8,
      end: 8,
    },
    label: {
      fontFamily: SERIF_FAMILY,
      fontSize: 16,
      fontWeight: '600',
      letterSpacing: -0.2,
      textAlign: 'center',
    },
  });
