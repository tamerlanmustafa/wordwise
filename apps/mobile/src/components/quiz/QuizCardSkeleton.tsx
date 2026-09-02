/**
 * QuizCardSkeleton — the placeholder shown while a review deck loads.
 *
 * Mirrors `MCQCard`: the eyebrow, the word card, four choice rows and the
 * sticky CTA bar, at the real components' own measurements — which it reads
 * from `mcqLogic` rather than restating, so the two cannot drift.
 *
 * What it replaced was a stack of loose bars declared inline in ReviewScreen,
 * and it was wrong in four separate ways at once: **three** rows where every
 * deck has four, 52pt rows against a 56pt tap target, radius 12 against 14,
 * and a 6pt progress bar against the header's 4pt one. None of that could
 * fail a test or throw an error. The only symptom was the screen shifting
 * under the user at the exact moment the first card appeared, which reads as
 * jank rather than as a placeholder that was never the right size.
 */

import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { useBottomBarInset } from '../../hooks/useBottomBarInset';
import { Skeleton } from '../ui/Skeleton';
import {
  MCQ_CHOICE_COUNT,
  MCQ_CHOICE_GAP,
  MCQ_CHOICE_MIN_H,
  MCQ_CHOICE_RADIUS,
  WORD_CARD_H,
  WORD_CARD_MARGIN_Y,
  WORD_CARD_RADIUS,
} from './mcqLogic';

export function QuizCardSkeleton() {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  // The real card reserves the floating tab bar's height under its CTA, so
  // the placeholder has to as well or the button jumps on load.
  const barInset = useBottomBarInset();

  return (
    <View style={s.root}>
      <View style={s.body}>
        {/* eyebrow — 11pt uppercase, centred */}
        <Skeleton width={148} height={11} radius={4} sheen style={s.eyebrow} />

        {/* word card */}
        <Skeleton
          height={WORD_CARD_H}
          radius={WORD_CARD_RADIUS}
          sheen
          delay={60}
          style={s.wordCard}
        />

        {/* four answer rows — the deck has no other shape */}
        <View style={s.choices}>
          {Array.from({ length: MCQ_CHOICE_COUNT }).map((_, i) => (
            <Skeleton
              key={i}
              height={MCQ_CHOICE_MIN_H}
              radius={MCQ_CHOICE_RADIUS}
              sheen
              delay={120 + i * 60}
            />
          ))}
        </View>
      </View>

      {/* Sticky CTA bar, at the real one's height and with its divider, so the
          bottom of the screen doesn't move when the card lands. */}
      <View style={[s.ctaBar, { paddingBottom: barInset }]}>
        <Skeleton height={46} radius={14} sheen delay={360} />
      </View>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1 },
    // Matches MCQCard's ScrollView content container: grows to fill the gap
    // between header and CTA, and centres its contents in it.
    body: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: 18,
      paddingTop: 4,
      paddingBottom: 24,
    },
    eyebrow: { alignSelf: 'center', marginTop: 6 },
    wordCard: { marginVertical: WORD_CARD_MARGIN_Y },
    choices: { gap: MCQ_CHOICE_GAP, marginTop: 6 },
    ctaBar: {
      paddingHorizontal: 18,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: tc.divider,
      backgroundColor: tc.background,
    },
  });
