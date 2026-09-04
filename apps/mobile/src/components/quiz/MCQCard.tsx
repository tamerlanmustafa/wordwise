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
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { useTranslation } from 'react-i18next';
import { useBottomBarInset } from '../../hooks/useBottomBarInset';
import { feedback } from '../../utils/feedback';
import { WordCard } from './WordCard';
import { MCQChoice } from './MCQChoice';
import { QuizBackdrop } from './QuizBackdrop';
import { useEntryAnimation } from './quizMotion';
import { MONO_FAMILY } from '../../theme/fonts';
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
  const ctaPress = useRef(new Animated.Value(0)).current;
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

  // The screen's mood, which the backdrop tints to. Neutral while answering.
  const mood = phase !== 'answered' ? 'neutral' : userWasCorrect ? 'correct' : 'wrong';

  const handleAdvance = useCallback(() => {
    if (phase !== 'answered' || pickedIdx == null) return;
    onAnswer(userWasCorrect);
  }, [phase, pickedIdx, userWasCorrect, onAnswer]);

  const ctaBg = phase === 'idle'
    ? tc.chipBg
    : userWasCorrect
      ? tc.success
      : tc.error;
  // Dark ink on a coloured fill, never white: `success` and `error` are light
  // enough in dark mode that white text on them lands near 2:1.
  const ctaFg = phase === 'idle' ? tc.textFaint : tc.textInverse;
  const ctaEdge = phase === 'idle'
    ? 'transparent'
    : userWasCorrect
      ? tc.quizCorrectEdge
      : tc.quizWrongEdge;
  // One label throughout. The button's *state* (ghost vs filled, disabled vs
  // not) already says whether it is ready; changing its words as well made it
  // read as a different control appearing.
  const ctaLabel = t('quiz:mcq.next');
  const ctaEnabled = phase === 'answered';

  return (
    <View style={s.root}>
      <QuizBackdrop mood={mood} />

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        {/* Index 0 leads; the options follow on a 60ms stagger. `entryKey` is
            the question's identity, so a new card re-runs the arrival rather
            than only the first one animating. */}
        <Arriving index={0} entryKey={word}>
          <WordCard word={word} pos={pos} example={example} level={level} />
        </Arriving>

        <View style={s.choicesList}>
          {choices.map((c, i) => (
            <Arriving key={`${c.word}-${i}`} index={i + 1} entryKey={word}>
              <MCQChoice
                label={c.word}
                position={i + 1}
                state={choiceStateFor(i, answerState)}
                disabled={choiceIsDimmed(i, answerState)}
                // Only the row the reader tapped pops. The revealed answer
                // arrives by its colour change alone, 180ms later, so the eye
                // lands on the miss before the correction.
                popIn={phase === 'answered' && i === pickedIdx}
                onPress={() => handleChoicePress(i)}
              />
            </Arriving>
          ))}
        </View>
      </ScrollView>

      {/* Sticky CTA. `barInset` is the reserved height of the floating glass
          tab bar (see useBottomBarInset) — on iOS 26 the bar is a capsule that
          hovers clear of the screen edge, so a footer padded only by the safe
          area sits underneath it. */}
      <LinearGradient
        colors={['transparent', tc.background]}
        locations={[0, 0.45]}
        style={[s.ctaBar, { paddingBottom: barInset + 10, borderTopColor: tc.divider }]}
      >
        <Animated.View style={{ transform: [{ scale: ctaScale }] }}>
          <Pressable
            onPress={ctaEnabled ? handleAdvance : undefined}
            onPressIn={() => ctaEnabled && ctaPress.setValue(1)}
            onPressOut={() => ctaPress.setValue(0)}
            disabled={!ctaEnabled}
          >
            {/* The CTA carries the same lip as the answer tiles, so the whole
                surface shares one physical language. */}
            <Animated.View
              style={[
                s.ctaEdge,
                { backgroundColor: ctaEdge, transform: [{ scaleY: ctaPress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.4] }) }] },
              ]}
            />
            <Animated.View
              style={[
                s.cta,
                { backgroundColor: ctaBg },
                !ctaEnabled && s.ctaGhost,
                { transform: [{ translateY: ctaPress.interpolate({ inputRange: [0, 1], outputRange: [0, 3] }) }] },
              ]}
            >
              <Text style={[s.ctaText, { color: ctaFg }]}>{ctaLabel} →</Text>
            </Animated.View>
          </Pressable>
        </Animated.View>
      </LinearGradient>
    </View>
  );
}

/**
 * One arriving element.
 *
 * A thin wrapper so the choreography stays in `quizMotion` and the card's JSX
 * reads as layout rather than as animation plumbing. Extracted rather than
 * inlined because a hook cannot be called inside `choices.map`.
 */
function Arriving({
  index,
  entryKey,
  children,
}: {
  index: number;
  entryKey: string | number;
  children: React.ReactNode;
}) {
  const style = useEntryAnimation(index, entryKey);
  return <Animated.View style={style}>{children}</Animated.View>;
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
    // One choice per row. A 2x2 grid packed four tiles into the width and
    // paid for it in height — each tile needed 92pt so a two-word gloss had
    // somewhere to wrap. Four rows read top-to-bottom in one pass, fit a
    // longer translation on a single line, and leave the card shorter.
    choicesList: {
      gap: 11,
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
    // The footer fades the page out behind it rather than sitting on a flat
    // band, so content scrolling under it dissolves instead of colliding.
    ctaBar: {
      paddingHorizontal: 18,
      paddingTop: 18,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    // Reserves the lip's depth so pressing the button doesn't shift the bar.
    ctaEdge: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: -5,
      height: 5,
      borderRadius: 16,
    },
    cta: {
      height: 54,
      paddingHorizontal: 16,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ctaGhost: {
      // The disabled state is a hairline surface, not a dimmed button: a faded
      // filled button still reads as pressable and invites a tap that does
      // nothing.
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tc.divider,
    },
    ctaText: {
      fontFamily: MONO_FAMILY,
      fontSize: 13.5,
      fontWeight: '900',
      letterSpacing: 1.4,
      textTransform: 'uppercase',
    },
  });
