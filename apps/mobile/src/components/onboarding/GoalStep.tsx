/**
 * GoalStep — onboarding step 6 (prototype §6). Four daily-goal options; the
 * chosen minutes are persisted via onboardingStore (Settings + reminders read
 * it). Single-select; the CTA finishes onboarding.
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { DAILY_GOAL_OPTIONS } from './placement';
import { StepHeader } from './StepHeader';
import { OnboardingCTA } from './OnboardingCTA';

export interface GoalStepProps {
  selected: number | null;
  onSelect: (mins: number) => void;
  onBack: () => void;
  onFinish: () => void;
  /** True while the finish handler is adding the film / persisting. */
  finishing?: boolean;
}

export function GoalStep({ selected, onSelect, onBack, onFinish, finishing }: GoalStepProps) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      <StepHeader step={6} total={6} eyebrow="Step 6 of 6" title="Set your daily goal" onBack={onBack} />
      <Text style={s.sub}>You can change this any time. Consistency beats intensity.</Text>
      <View style={s.list}>
        {DAILY_GOAL_OPTIONS.map((g) => {
          const on = g.mins === selected;
          return (
            <Pressable
              key={g.mins}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${g.label}, ${g.sub}`}
              onPress={() => onSelect(g.mins)}
              style={[s.row, { backgroundColor: on ? tc.primaryTint : tc.paper, borderColor: on ? tc.primary : tc.border }]}
            >
              <View style={s.info}>
                <Text style={s.label}>{g.label}</Text>
                <Text style={s.subRow}>{g.sub}</Text>
              </View>
              <View style={[s.radio, { borderColor: on ? tc.primary : tc.border, backgroundColor: on ? tc.primary : 'transparent' }]}>
                {on ? <Ionicons name="checkmark" size={12} color={tc.textInverse} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      <OnboardingCTA
        label={finishing ? 'Setting up…' : 'Enter WordWise →'}
        onPress={onFinish}
        disabled={!selected || finishing}
      />
    </SafeAreaView>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: tc.background },
    sub: { paddingHorizontal: 18, paddingTop: 6, fontSize: 13.5, color: tc.textSecondary },
    list: { flex: 1, paddingHorizontal: 18, paddingTop: 20, gap: 10 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 15,
      paddingHorizontal: 16,
      borderRadius: 14,
      borderWidth: 2,
    },
    info: { flex: 1, minWidth: 0 },
    label: { fontSize: 16, fontWeight: '800', color: tc.text },
    subRow: { fontSize: 12.5, color: tc.textSecondary, marginTop: 2 },
    radio: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
