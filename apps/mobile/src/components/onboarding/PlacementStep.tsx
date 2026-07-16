/**
 * PlacementStep — onboarding step 3 (prototype §3). One placement word per
 * screen with a 3-way self-rating. Tapping an option records the rating and
 * advances; "Skip — I'm a beginner" bails to an A1 result. Presentational —
 * OnboardingFlow owns the word index + collected answers.
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { SERIF_FAMILY } from '../../theme/fonts';
import { StepHeader } from './StepHeader';
import type { PlacementWord, PlacementRating } from './placement';

export interface PlacementStepProps {
  word: PlacementWord;
  index: number;
  total: number;
  onRate: (rating: PlacementRating) => void;
  onSkip: () => void;
  onBack: () => void;
}

export function PlacementStep({ word, index, total, onRate, onSkip, onBack }: PlacementStepProps) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  const options: Array<{ label: string; sub: string; dot: string; rating: PlacementRating }> = [
    { label: "I've never seen it", sub: 'New to me', dot: tc.textFaint, rating: 'unknown' },
    { label: 'Looks familiar', sub: "Can't define it", dot: tc.gold, rating: 'familiar' },
    { label: 'I know it well', sub: 'Could use it in a sentence', dot: tc.success, rating: 'know' },
  ];

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      <StepHeader
        step={3}
        total={6}
        eyebrow={`Quick placement · word ${index + 1} of up to ${total}`}
        title="How well do you know…"
        onBack={onBack}
      />
      <View style={s.body}>
        <View style={s.wordCard}>
          <Text style={s.word}>{word.word}</Text>
          <Text style={s.pos}>{word.pos}</Text>
        </View>
        <View style={s.options}>
          {options.map((o) => (
            <Pressable
              key={o.rating}
              accessibilityRole="button"
              accessibilityLabel={o.label}
              onPress={() => onRate(o.rating)}
              style={({ pressed }) => [s.option, pressed && { borderColor: tc.primary, backgroundColor: tc.primaryTint }]}
            >
              <View style={[s.dot, { backgroundColor: o.dot }]} />
              <View style={s.optionText}>
                <Text style={s.optionLabel}>{o.label}</Text>
                <Text style={s.optionSub}>{o.sub}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </View>
      <Pressable accessibilityRole="button" onPress={onSkip} style={s.skip} hitSlop={8}>
        <Text style={s.skipText}>Skip — I'm a beginner</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: tc.background },
    body: { flex: 1, paddingHorizontal: 18, paddingTop: 24 },
    wordCard: {
      paddingVertical: 36,
      paddingHorizontal: 20,
      borderRadius: 18,
      backgroundColor: tc.wordBoxBg,
      borderWidth: 1,
      borderColor: tc.border,
      alignItems: 'center',
    },
    word: { fontFamily: SERIF_FAMILY, fontSize: 38, fontWeight: '600', letterSpacing: -0.6, color: tc.text },
    pos: { fontSize: 12, color: tc.textFaint, fontStyle: 'italic', marginTop: 8, fontWeight: '600' },
    options: { marginTop: 22, gap: 10 },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 13,
      paddingVertical: 15,
      paddingHorizontal: 16,
      borderRadius: 14,
      backgroundColor: tc.paper,
      borderWidth: 2,
      borderColor: tc.border,
    },
    dot: { width: 11, height: 11, borderRadius: 6 },
    optionText: { flex: 1, minWidth: 0 },
    optionLabel: { fontSize: 15.5, fontWeight: '700', color: tc.text },
    optionSub: { fontSize: 12, color: tc.textSecondary, marginTop: 1 },
    skip: { alignItems: 'center', paddingVertical: 10, paddingHorizontal: 18 },
    skipText: { fontSize: 13, fontWeight: '700', color: tc.textFaint },
  });
