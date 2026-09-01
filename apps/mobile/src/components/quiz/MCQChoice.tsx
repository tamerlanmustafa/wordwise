/**
 * MCQChoice — one full-width row in the MCQ answer list (the parent
 * MCQCard owns the stack).
 *
 * State matrix (see mcqLogic.choiceStateFor):
 *   idle           — default row, full shadow, tappable
 *   correct        — success border + tint + green label (the user
 *                    tapped the right one)
 *   wrong          — error border + tint + red label and × glyph
 *   reveal-correct — same as correct (used to highlight the *actual*
 *                    answer after the user picked wrong)
 *
 * Only the miss carries a glyph. A check on the right answer was saying
 * a second time what the green border, tint and label already say, and it
 * had to say it about two different rows (the tapped one and the revealed
 * one) that mean different things to the reader. The × stays because red
 * alone reads as "wrong answer" rather than "the one you chose".
 *
 * Disabled (post-answer, untapped wrong-eligible rows) get opacity 0.4.
 * The component takes a single `state` plus optional `disabled` flag;
 * the parent MCQCard composes the matrix.
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { alignStart } from '../../i18n/rtl';
import type { MCQChoiceState } from './mcqLogic';

const SERIF_FAMILY = 'Source Serif 4';

export type { MCQChoiceState };

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
      <Text style={[s.label, { color: fg }]} numberOfLines={2}>
        {label}
      </Text>
      {isWrong ? (
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={tc.error} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M6 6l12 12M18 6L6 18" />
        </Svg>
      ) : null}
    </Pressable>
  );
}

const makeStyles = (_tc: ThemeColors) =>
  StyleSheet.create({
    // A row, not a tile: full width, laid out as an inline run so the label
    // and the miss glyph sit on one baseline. `minHeight` is the tap target
    // (44pt is Apple's floor, 56 leaves room either side of a wrapped gloss).
    tile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      minHeight: 56,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 14,
      borderWidth: 2,
    },
    idleShadow: {
      shadowColor: '#000',
      shadowOpacity: 0.1,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 2,
    },
    // `flex: 1` so the label owns the row and the glyph is pushed to the
    // trailing edge — and so the label's own width doesn't change when the
    // glyph appears, which would re-wrap the text mid-answer.
    label: {
      flex: 1,
      fontFamily: SERIF_FAMILY,
      fontSize: 16,
      fontWeight: '600',
      letterSpacing: -0.2,
      textAlign: alignStart,
    },
  });
