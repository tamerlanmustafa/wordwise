/**
 * LanguageStep — onboarding step 2 (prototype §2). Single-select list of the
 * languages WordWise can translate into. Sourced from the shared
 * AVAILABLE_LANGUAGES list (the same list the header picker uses) rather than
 * the prototype's hard-coded LANGUAGES — and the prototype's fabricated
 * "learner count" is dropped (we don't invent data).
 */

import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { MONO_FAMILY } from '../../theme/fonts';
import { AVAILABLE_LANGUAGES, filterLanguages } from '../../types';
import { StepHeader, ONBOARDING_TOTAL_STEPS } from './StepHeader';
import { OnboardingCTA } from './OnboardingCTA';
import { directionalIcon } from '../../i18n/rtl';

export interface LanguageStepProps {
  selected: string | null;
  onSelect: (code: string) => void;
  onBack: () => void;
  onContinue: () => void;
}

export function LanguageStep({ selected, onSelect, onBack, onContinue }: LanguageStepProps) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const [query, setQuery] = useState('');
  const shown = useMemo(() => filterLanguages(AVAILABLE_LANGUAGES, query), [query]);

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      <StepHeader
        step={3}
        total={ONBOARDING_TOTAL_STEPS}
        eyebrow={t('onboarding:languageStep.eyebrow', { step: 2, total: 6 })}
        title={t('onboarding:languageStep.title')}
        onBack={onBack}
      />
      {/* Search/filter (issue #80) — same box style as the film-picker step. */}
      <View style={s.searchBox}>
        <Ionicons name="search" size={16} color={tc.textFaint} />
        <TextInput
          style={s.searchInput}
          placeholder={t('onboarding:languageStep.searchPlaceholder')}
          placeholderTextColor={tc.textFaint}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {query.length > 0 ? (
          <Pressable
            onPress={() => setQuery('')}
            hitSlop={8}
            accessibilityLabel={t('action.clearSearch')}
          >
            <Ionicons name="close-circle" size={16} color={tc.textFaint} />
          </Pressable>
        ) : null}
      </View>
      <ScrollView style={s.list} contentContainerStyle={s.listContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {shown.length === 0 ? (
          <Text style={s.noMatch}>
            {t('onboarding:languageStep.noMatch', { query: query.trim() })}
          </Text>
        ) : null}
        {shown.map((l) => {
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
                <Ionicons name={directionalIcon('chevron-forward')} size={16} color={tc.textFaint} />
              )}
            </Pressable>
          );
        })}
      </ScrollView>
      <OnboardingCTA
        label={t('onboarding:languageStep.continue')}
        onPress={onContinue}
        disabled={!selected}
      />
    </SafeAreaView>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: tc.background },
    // Same search-box recipe as PickFirstFilmStep — keep the two in step.
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 18,
      marginTop: 14,
      paddingHorizontal: 12,
      height: 42,
      borderRadius: 12,
      backgroundColor: tc.paper,
      borderWidth: 1,
      borderColor: tc.border,
    },
    searchInput: { flex: 1, fontSize: 15, color: tc.text, paddingVertical: 0 },
    noMatch: { textAlign: 'center', color: tc.textFaint, fontSize: 14, marginTop: 24 },
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
