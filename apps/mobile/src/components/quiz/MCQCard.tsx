/**
 * MCQCard — full-card UI for a tap-to-answer translation MCQ quiz card
 * (choices are translations in the user's native language; replaced
 * the retired typed-translation card).
 *
 * Self-contained: renders eyebrow, WordCard, a 2x2 grid of MCQChoice
 * tiles (two top, two bottom), post-answer NOT QUITE callout (when
 * wrong), and a sticky bottom CTA bar. Calls `onAnswer(correct)` once
 * when the user finishes a card (either via Continue tap, or via
 * auto-advance on correct after 600ms).
 *
 * Behaviour (cf. CLAUDE_PROMPT §7.1):
 *   • Tap on a tile in `idle` → tile flips to correct/wrong
 *     immediately. The actual right answer is always highlighted in
 *     green (`reveal-correct` state) even when the user picked wrong.
 *     Other tiles fade to opacity 0.4.
 *   • 600ms after a correct tap, `onAnswer(true)` fires automatically
 *     (the CTA also pulses + becomes "Continue →" in case the user
 *     wants to advance manually before then; either path is fine).
 *   • On a wrong tap the CTA flips to "Got it · Continue →" and
 *     stays there until the user taps it — we don't auto-advance on
 *     misses so they can read the NOT QUITE callout.
 *   • Idle CTA is a ghost pill ("Pick the translation") — never
 *     "Check", because the tap on a tile IS the answer (no Check step).
 *
 * The card relies on `card.choices` where each choice has
 * `{ word, is_correct }`. The first `is_correct: true` entry is the
 * canonical answer surfaced in the callout. The choice-state matrix
 * lives in mcqLogic.ts so it stays unit-testable.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { WordCard } from './WordCard';
import { MCQChoice } from './MCQChoice';
import {
  MCQ_COPY,
  choiceIsDimmed,
  choiceStateFor,
  type MCQAnswerState,
  type MCQPhase,
} from './mcqLogic';

interface MCQChoicePayload {
  word: string;
  is_correct: boolean;
}

export interface MCQCardProps {
  word: string;
  pos?: string | null;
  example?: string | null;
  choices: MCQChoicePayload[];
  /** Called exactly once when the user advances past this card. */
  onAnswer: (correct: boolean) => void;
}

export function MCQCard({
  word,
  pos,
  example,
  choices,
  onAnswer,
}: MCQCardProps) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const copy = MCQ_COPY;

  const [phase, setPhase] = useState<MCQPhase>('idle');
  const [pickedIdx, setPickedIdx] = useState<number | null>(null);

  const correctIdx = useMemo(
    () => choices.findIndex((c) => c.is_correct),
    [choices],
  );
  const userWasCorrect = pickedIdx != null && choices[pickedIdx]?.is_correct === true;
  const correctChoice = correctIdx >= 0 ? choices[correctIdx] : null;
  const answerState: MCQAnswerState = { phase, pickedIdx, correctIdx, userWasCorrect };

  // CTA pulse + auto-advance. 600ms after the user picks we either
  // (a) auto-advance if they got it right (no point making them tap
  // twice), or (b) pulse the manual CTA so the eye lands on it.
  const ctaScale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (phase !== 'answered') return;
    const t = setTimeout(() => {
      if (userWasCorrect) {
        onAnswer(true);
        return;
      }
      Animated.sequence([
        Animated.timing(ctaScale, { toValue: 1.04, duration: 150, useNativeDriver: true }),
        Animated.timing(ctaScale, { toValue: 1.0, duration: 150, useNativeDriver: true }),
      ]).start();
    }, 600);
    return () => clearTimeout(t);
  }, [phase, ctaScale, userWasCorrect, onAnswer]);

  const handleChoicePress = useCallback(
    (idx: number) => {
      if (phase !== 'idle') return;
      setPickedIdx(idx);
      setPhase('answered');
    },
    [phase],
  );

  const handleAdvance = useCallback(() => {
    if (phase !== 'answered' || pickedIdx == null) return;
    onAnswer(userWasCorrect);
  }, [phase, pickedIdx, userWasCorrect, onAnswer]);

  const ctaBg = phase === 'idle'
    ? tc.chipBg
    : userWasCorrect
      ? tc.success
      : tc.error;
  const ctaFg = phase === 'idle'
    ? tc.textFaint
    : '#fff';
  const ctaLabel = phase === 'idle'
    ? copy.idleCta
    : userWasCorrect
      ? 'Continue →'
      : 'Got it · Continue →';
  const ctaEnabled = phase === 'answered';

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <Text style={s.eyebrow}>{copy.eyebrow}</Text>
        <WordCard word={word} pos={pos} example={example} size={36} />

        {/* 2x2 answer grid — two tiles top, two bottom. */}
        <View style={s.choicesGrid}>
          {choices.map((c, i) => (
            <View key={`${c.word}-${i}`} style={s.choiceCell}>
              <MCQChoice
                label={c.word}
                state={choiceStateFor(i, answerState)}
                disabled={choiceIsDimmed(i, answerState)}
                onPress={() => handleChoicePress(i)}
              />
            </View>
          ))}
        </View>

        {phase === 'answered' && !userWasCorrect && correctChoice ? (
          <View style={s.notQuiteCard}>
            <Text style={s.notQuiteEyebrow}>NOT QUITE</Text>
            <Text style={s.notQuiteBody}>
              <Text style={s.notQuiteAnswer}>{correctChoice.word}</Text>
              {copy.notQuiteSuffix}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Sticky CTA bar */}
      <View style={s.ctaBar}>
        <Animated.View style={{ transform: [{ scale: ctaScale }] }}>
          <Pressable
            onPress={ctaEnabled ? handleAdvance : undefined}
            style={({ pressed }) => [
              s.cta,
              { backgroundColor: ctaBg },
              !ctaEnabled && s.ctaGhost,
              pressed && ctaEnabled && { opacity: 0.9 },
            ]}
          >
            <Text style={[s.ctaText, { color: ctaFg }]}>{ctaLabel}</Text>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    root: {
      flex: 1,
    },
    body: {
      paddingHorizontal: 18,
      paddingTop: 4,
      paddingBottom: 24,
    },
    eyebrow: {
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 1.8,
      color: tc.goldOnSurface,
      textTransform: 'uppercase',
      textAlign: 'center',
      marginTop: 6,
    },
    choicesGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      marginTop: 6,
    },
    // Two per row; flexGrow soaks up the width the gap doesn't use.
    // Tiles in the same row stretch to equal height.
    choiceCell: {
      flexBasis: '47%',
      flexGrow: 1,
    },
    notQuiteCard: {
      marginTop: 22,
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderRadius: 12,
      backgroundColor: tc.errorTint,
      borderWidth: 1,
      borderColor: tc.errorBorder,
    },
    notQuiteEyebrow: {
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 1.4,
      color: tc.error,
      textTransform: 'uppercase',
    },
    notQuiteBody: {
      fontSize: 13,
      fontWeight: '600',
      color: tc.text,
      marginTop: 4,
    },
    notQuiteAnswer: {
      color: tc.success,
      fontWeight: '800',
    },
    ctaBar: {
      paddingHorizontal: 18,
      paddingTop: 12,
      paddingBottom: 24,
      borderTopWidth: 1,
      borderTopColor: tc.divider,
      backgroundColor: tc.background,
    },
    cta: {
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 14,
      alignItems: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 10 },
      elevation: 6,
    },
    ctaGhost: {
      // No shadow when the button is the idle hint pill — it shouldn't
      // compete with the choice tiles for attention.
      shadowOpacity: 0,
      elevation: 0,
      borderWidth: 1,
      borderColor: tc.border,
    },
    ctaText: {
      fontSize: 14,
      fontWeight: '900',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
  });
