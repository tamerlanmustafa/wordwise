/**
 * LanguageStep — onboarding step 2 (prototype §2). Single-select list of the
 * languages WordWise can translate into. Sourced from the shared
 * AVAILABLE_LANGUAGES list (the same list the header picker uses) rather than
 * the prototype's hard-coded LANGUAGES — and the prototype's fabricated
 * "learner count" is dropped (we don't invent data).
 */

import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { MONO_FAMILY } from '../../theme/fonts';
import { AVAILABLE_LANGUAGES } from '../../types';
import { StepHeader } from './StepHeader';
import { OnboardingCTA } from './OnboardingCTA';

export interface LanguageStepProps {
  selected: string | null;
  onSelect: (code: string) => void;
  onBack: () => void;
  onContinue: () => void;
}

export function LanguageStep({ selected, onSelect, onBack, onContinue }: LanguageStepProps) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      <StepHeader step={1} total={5} eyebrow="Step 1 of 5" title="What are you learning?" onBack={onBack} />
      <ScrollView style={s.list} contentContainerStyle={s.listContent} showsVerticalScrollIndicator={false}>
        {AVAILABLE_LANGUAGES.map((l) => {
          const on = l.code === selected;
          return (
            <Pressable
              key={l.code}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={l.name}
              onPress={() => onSelect(l.code)}
              style={[s.row, { backgroundColor: on ? tc.primaryTint : tc.paper, borderColor: on ? tc.primary : tc.border }]}
            >
              <View style={s.code}>
                <Text style={s.codeText}>{l.code}</Text>
              </View>
              <View style={s.info}>
                <Text style={s.name}>{l.name}</Text>
                {l.nativeName ? <Text style={s.native}>{l.nativeName}</Text> : null}
              </View>
              {on ? (
                <View style={s.check}>
                  <Ionicons name="checkmark" size={14} color={tc.textInverse} />
                </View>
              ) : (
                <Ionicons name="chevron-forward" size={16} color={tc.textFaint} />
              )}
            </Pressable>
          );
        })}
      </ScrollView>
      <OnboardingCTA label="Continue →" onPress={onContinue} disabled={!selected} />
    </SafeAreaView>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: tc.background },
    list: { flex: 1 },
    listContent: { padding: 18, paddingTop: 20, gap: 10 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      padding: 13,
      borderRadius: 14,
      borderWidth: 2,
    },
    code: {
      width: 42,
      height: 42,
      borderRadius: 10,
      backgroundColor: tc.reelStockDeep,
      borderWidth: 1,
      borderColor: tc.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    codeText: { fontFamily: MONO_FAMILY, fontSize: 15, fontWeight: '800', color: tc.gold },
    info: { flex: 1, minWidth: 0 },
    name: { fontSize: 16, fontWeight: '700', color: tc.text },
    native: { fontSize: 12.5, color: tc.textSecondary, marginTop: 1 },
    check: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: tc.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
