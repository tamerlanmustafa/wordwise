/**
 * MCQCard — full-card UI for a tap-to-answer translation MCQ quiz card
 * (choices are translations in the user's native language; replaced
 * the retired typed-translation card).
 *
 * Self-contained: renders the WordCard, a stack of four full-width
 * MCQChoice rows, and a sticky bottom CTA bar. Calls `onAnswer(correct)`
 * exactly once, when the user taps Next.
 *
 * Behaviour:
 *   • Tap on a row in `idle` → the row flips to correct/wrong
 *     immediately. The actual right answer is always highlighted in
 *     green (`reveal-correct` state) even when the user picked wrong.
 *     Other rows fade to opacity 0.4.
 *   • **Nothing advances on its own.** A correct answer used to fire
 *     `onAnswer(true)` 600ms later, which meant the card was taken away
 *     mid-glance: the user had no time to read which answer was right,
 *     and on a fast streak the deck scrolled past faster than they could
 *     follow. The pacing belongs to the reader, so both outcomes now wait
 *     for the same tap.
 *   • One CTA label, "Next", in every phase — disabled until an answer is
 *     picked. Two labels that swap on answer ("Continue" / "Got it ·
 *     Continue") made the button look like two different controls.
 *
 * There is deliberately no written explanation of a wrong answer. The
 * correct row is already highlighted green next to the user's red one,
 * which says the same thing in the place the eye is already looking; the
 * callout under it repeated that in prose and pushed the choices up the
 * screen the moment you got one wrong.
 *
 * The card relies on `card.choices` where each choice has
 * `{ word, is_correct }`. The first `is_correct: true` entry is the
 * canonical answer surfaced in the callout. The choice-state matrix
 * lives in mcqLogic.ts so it stays unit-testable.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { useTranslation } from 'react-i18next';
import { useBottomBarInset } from '../../hooks/useBottomBarInset';
import { feedback } from '../../utils/feedback';
import { WordCard } from './WordCard';
import { MCQChoice } from './MCQChoice';
import {
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
  /** This word's CEFR band, shown as a chip on the word card. */
  level?: string | null;
  /** Called exactly once when the user advances past this card. */
  onAnswer: (correct: boolean) => void;
}

export function MCQCard({
  word,
  pos,
  example,
  choices,
  level,
  onAnswer,
}: MCQCardProps) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  // The global tab bar is an absolute overlay, so the sticky CTA has to
  // reserve its height or the button sits underneath it.
  const barInset = useBottomBarInset();

  const [phase, setPhase] = useState<MCQPhase>('idle');
  const [pickedIdx, setPickedIdx] = useState<number | null>(null);

  const correctIdx = useMemo(
    () => choices.findIndex((c) => c.is_correct),
    [choices],
  );
  const userWasCorrect = pickedIdx != null && choices[pickedIdx]?.is_correct === true;
  const answerState: MCQAnswerState = { phase, pickedIdx, correctIdx, userWasCorrect };

  // A pulse on the CTA once an answer is in — the cue that the card is
  // waiting on you. It used to double as an auto-advance timer for correct
  // answers; now it only draws the eye, and the tap is always the user's.
  const ctaScale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (phase !== 'answered') return;
    const timer = setTimeout(() => {
      Animated.sequence([
        Animated.timing(ctaScale, { toValue: 1.04, duration: 150, useNativeDriver: true }),
        Animated.timing(ctaScale, { toValue: 1.0, duration: 150, useNativeDriver: true }),
      ]).start();
    }, 600);
    return () => clearTimeout(timer);
  }, [phase, ctaScale]);

  const handleChoicePress = useCallback(
    (idx: number) => {
      if (phase !== 'idle') return;
      setPickedIdx(idx);
      setPhase('answered');
      // Fires here, not in `onAnswer`: the row turns green or red on this
      // frame, and feedback that arrives after the colour has already landed
      // (600ms later, at the auto-advance) reads as a glitch rather than a
      // response to the tap.
      if (choices[idx]?.is_correct) feedback.correct();
      else feedback.wrong();
    },
    [phase, choices],
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
  // One label throughout. The button's *state* (ghost vs filled, disabled vs
  // not) already says whether it is ready; changing its words as well made it
  // read as a different control appearing.
  const ctaLabel = t('quiz:mcq.next');
  const ctaEnabled = phase === 'answered';

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <WordCard word={word} pos={pos} example={example} size={36} level={level} />

        {/* Answer list — one full-width row per choice. */}
        <View style={s.choicesList}>
          {choices.map((c, i) => (
            <MCQChoice
              key={`${c.word}-${i}`}
              label={c.word}
              state={choiceStateFor(i, answerState)}
              disabled={choiceIsDimmed(i, answerState)}
              onPress={() => handleChoicePress(i)}
            />
          ))}
        </View>

      </ScrollView>

      {/* Sticky CTA bar */}
      <View style={[s.ctaBar, { paddingBottom: barInset }]}>
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
    // `flexGrow` lets the content container fill the space between the header
    // and the CTA bar, so `justifyContent` can centre the card in it. Without
    // the grow the container is only as tall as its content and the word +
    // answer grid sit hard against the header, leaving the bottom third of a
    // modern phone empty. Still a ScrollView: once the content is taller than
    // the gap — a long example sentence, large text sizes, the NOT QUITE
    // callout — it scrolls from the top as before instead of clipping.
    body: {
      flexGrow: 1,
      justifyContent: 'center',
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
    // One choice per row. A 2x2 grid packed four tiles into the width and
    // paid for it in height — each tile needed 92pt so a two-word gloss had
    // somewhere to wrap. Four rows read top-to-bottom in one pass, fit a
    // longer translation on a single line, and leave the card shorter.
    choicesList: {
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
    // `paddingBottom` is applied inline from `useBottomBarInset` — the bar
    // floats over this surface, so the room it needs is device-dependent.
    ctaBar: {
      paddingHorizontal: 18,
      paddingTop: 12,
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
