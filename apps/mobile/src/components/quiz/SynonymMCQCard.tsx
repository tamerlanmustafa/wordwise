/**
 * SynonymMCQCard — full-card UI for a `synonym_mcq` quiz card.
 *
 * Self-contained: renders eyebrow, WordCard, 4 stacked MCQChoice rows,
 * post-answer NOT QUITE callout (when wrong), and a sticky bottom CTA
 * bar. Calls `onAnswer(correct: boolean)` once when the user finishes
 * a card (either via Check answer / Continue tap, or via auto-advance
 * on correct after 600ms).
 *
 * Behaviour (cf. CLAUDE_PROMPT §7.1):
 *   • Tap on a choice in `idle` → choice flips to correct/wrong
 *     immediately. The actual right answer is always highlighted in
 *     green (`reveal-correct` state) even when the user picked wrong.
 *     Other rows fade to opacity 0.4.
 *   • 600ms after tap, the CTA pulses once and becomes the primary
 *     action ("Continue →" on correct, "Got it · Continue →" on wrong).
 *   • Tap CTA → `onAnswer(correct)` — parent records the outcome.
 *
 * The card relies on `card.choices` (from the v0.6 SRS payload) where
 * each choice has `{ word, is_correct }`. The first `is_correct: true`
 * row is the canonical answer surfaced in the callout.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { WordCard } from './WordCard';
import { MCQChoice, type MCQChoiceState } from './MCQChoice';

export interface SynonymChoicePayload {
  word: string;
  is_correct: boolean;
}

export interface SynonymMCQCardProps {
  word: string;
  pos?: string | null;
  example?: string | null;
  choices: SynonymChoicePayload[];
  /** Called exactly once when the user advances past this card. */
  onAnswer: (correct: boolean) => void;
}

type Phase = 'idle' | 'answered';

export function SynonymMCQCard({
  word,
  pos,
  example,
  choices,
  onAnswer,
}: SynonymMCQCardProps) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  const [phase, setPhase] = useState<Phase>('idle');
  const [pickedIdx, setPickedIdx] = useState<number | null>(null);

  const correctIdx = useMemo(
    () => choices.findIndex((c) => c.is_correct),
    [choices],
  );
  const userWasCorrect = pickedIdx != null && choices[pickedIdx]?.is_correct === true;
  const correctChoice = correctIdx >= 0 ? choices[correctIdx] : null;

  // CTA pulse — runs once 600ms after the user picks. We animate a
  // single scale 1 → 1.04 → 1 spring per the spec.
  const ctaScale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (phase !== 'answered') return;
    const t = setTimeout(() => {
      Animated.sequence([
        Animated.timing(ctaScale, { toValue: 1.04, duration: 150, useNativeDriver: true }),
        Animated.timing(ctaScale, { toValue: 1.0, duration: 150, useNativeDriver: true }),
      ]).start();
    }, 600);
    return () => clearTimeout(t);
  }, [phase, ctaScale]);

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

  // ── Per-choice state matrix ─────────────────────────────────────
  const stateFor = (i: number): MCQChoiceState => {
    if (phase === 'idle') return 'idle';
    if (i === pickedIdx) {
      return userWasCorrect ? 'correct' : 'wrong';
    }
    if (i === correctIdx && !userWasCorrect) {
      // Always reveal the actual correct answer on a wrong pick.
      return 'reveal-correct';
    }
    return 'idle';
  };

  const choiceDisabledFor = (i: number): boolean => {
    if (phase === 'idle') return false;
    // The picked + the revealed-correct rows stay full-opacity; everyone
    // else fades to 0.4 so the eye lands on the two relevant rows.
    if (i === pickedIdx) return false;
    if (i === correctIdx && !userWasCorrect) return false;
    return true;
  };

  const ctaBg = phase === 'idle'
    ? tc.gold
    : userWasCorrect
      ? tc.success
      : tc.error;
  const ctaFg = phase === 'idle'
    ? tc.goldDeep
    : '#fff';
  const ctaLabel = phase === 'idle'
    ? 'Check answer'
    : userWasCorrect
      ? 'Continue →'
      : 'Got it · Continue →';
  const ctaEnabled = phase === 'answered';

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <Text style={s.eyebrow}>PICK THE SYNONYM</Text>
        <WordCard word={word} pos={pos} example={example} size={36} />

        <View style={s.choicesCol}>
          {choices.map((c, i) => (
            <MCQChoice
              key={`${c.word}-${i}`}
              label={c.word}
              state={stateFor(i)}
              disabled={choiceDisabledFor(i)}
              onPress={() => handleChoicePress(i)}
            />
          ))}
        </View>

        {phase === 'answered' && !userWasCorrect && correctChoice ? (
          <View style={s.notQuiteCard}>
            <Text style={s.notQuiteEyebrow}>NOT QUITE</Text>
            <Text style={s.notQuiteBody}>
              <Text style={s.notQuiteAnswer}>{correctChoice.word}</Text>
              {' is the closest synonym.'}
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
              pressed && ctaEnabled && { opacity: 0.9 },
              !ctaEnabled && { opacity: 0.7 },
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
    choicesCol: {
      gap: 10,
      marginTop: 6,
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
    ctaText: {
      fontSize: 14,
      fontWeight: '900',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
  });
