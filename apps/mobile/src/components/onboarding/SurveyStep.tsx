/**
 * SurveyStep — onboarding step 1 (issue #108). One self-reported question per
 * screen: tapping an option records it and advances, "Skip these questions"
 * bails out of the whole survey.
 *
 * Deliberately the same shape as PlacementStep rather than a single scrolling
 * form: the four questions carry ~19 options between them, which is a long
 * scroll on a small phone and reads as a chore before the user has even told
 * us their name. One question per screen is four taps and no scrolling, and it
 * reuses a layout this flow already proves. Presentational — OnboardingFlow
 * owns the index and the collected answers (see survey.ts).
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { StepHeader, ONBOARDING_TOTAL_STEPS } from './StepHeader';
import type { SurveyQuestion } from './survey';

export interface SurveyStepProps {
  question: SurveyQuestion;
  /** 0-based position of this question within the survey. */
  index: number;
  total: number;
  onAnswer: (answerKey: string) => void;
  onSkip: () => void;
  onBack: () => void;
}

export function SurveyStep({ question, index, total, onAnswer, onSkip, onBack }: SurveyStepProps) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      <StepHeader
        step={1}
        total={ONBOARDING_TOTAL_STEPS}
        eyebrow={t('onboarding:surveyStep.eyebrow', { index: index + 1, total })}
        title={t(`onboarding:surveyStep.question.${question.key}.title`)}
        onBack={onBack}
      />
      <Text style={s.sub}>{t('onboarding:surveyStep.sub')}</Text>
      <View style={s.options}>
        {question.answers.map((answerKey) => {
          const label = t(`onboarding:surveyStep.question.${question.key}.option.${answerKey}`);
          return (
            <Pressable
              key={answerKey}
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={() => onAnswer(answerKey)}
              style={({ pressed }) => [
                s.option,
                pressed && { borderColor: tc.primary, backgroundColor: tc.primaryTint },
              ]}
            >
              <Text style={s.optionLabel}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable accessibilityRole="button" onPress={onSkip} style={s.skip} hitSlop={8}>
        <Text style={s.skipText}>{t('onboarding:surveyStep.skip')}</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: tc.background },
    sub: { paddingHorizontal: 18, paddingTop: 6, fontSize: 13.5, color: tc.textSecondary },
    options: { flex: 1, paddingHorizontal: 18, paddingTop: 20, gap: 10 },
    option: {
      paddingVertical: 15,
      paddingHorizontal: 16,
      borderRadius: 14,
      backgroundColor: tc.paper,
      borderWidth: 2,
      borderColor: tc.border,
    },
    optionLabel: { fontSize: 15.5, fontWeight: '700', color: tc.text },
    skip: { alignItems: 'center', paddingVertical: 10, paddingHorizontal: 18 },
    skipText: { fontSize: 13, fontWeight: '700', color: tc.textFaint },
  });
