/**
 * UsernameStep — onboarding step 1: pick your username. Prefilled with the
 * account's current one, so email signups (who typed a username at register)
 * just tap Continue, while OAuth signups get to replace the auto-generated
 * email-prefix name (e.g. `jane_doe42`) with something they actually chose.
 *
 * Saving goes through PATCH /auth/me (authApi.updateProfile); an unchanged
 * name skips the round-trip. On success the authStore user is updated
 * optimistically with the name we sent (the PATCH response is camelCase and
 * partial — see App.tsx handleUserUpdated for the same workaround).
 */

import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { useAuthStore } from '../../stores/authStore';
import { authApi } from '../../services/api';
import { usernameProblem, USERNAME_MAX } from '../../utils/username';
import { StepHeader } from './StepHeader';
import { OnboardingCTA } from './OnboardingCTA';

export interface UsernameStepProps {
  onBack: () => void;
  onContinue: () => void;
}

export function UsernameStep({ onBack, onContinue }: UsernameStepProps) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const currentUsername = useAuthStore((st) => st.user?.username ?? '');
  const [name, setName] = useState(currentUsername);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleContinue = async () => {
    const trimmed = name.trim();
    const problem = usernameProblem(trimmed);
    if (problem) {
      setError(problem);
      return;
    }
    if (trimmed === currentUsername) {
      onContinue();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await authApi.updateProfile({ username: trimmed });
      const current = useAuthStore.getState().user;
      if (current) useAuthStore.getState().setUser({ ...current, username: trimmed });
      onContinue();
    } catch (err: any) {
      // Backend answers 400 "Username already taken" on conflicts.
      setError(err?.message || t('onboarding:usernameStep.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <StepHeader
          step={1}
          total={6}
          eyebrow={t('onboarding:stepOf', { step: 1, total: 6 })}
          title={t('onboarding:usernameStep.title')}
          onBack={onBack}
        />
        <Text style={s.sub}>{t('onboarding:usernameStep.sub')}</Text>
        <View style={s.form}>
          <TextInput
            style={[s.input, error ? { borderColor: tc.error } : null]}
            value={name}
            onChangeText={(t) => {
              setName(t);
              setError(null);
            }}
            placeholder={t('onboarding:usernameStep.placeholder')}
            placeholderTextColor={tc.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={USERNAME_MAX}
            editable={!saving}
            accessibilityLabel={t('onboarding:usernameStep.placeholder')}
          />
          {error ? <Text style={s.error}>{error}</Text> : null}
        </View>
        <OnboardingCTA
          label={saving ? t('onboarding:usernameStep.saving') : t('action.continue')}
          onPress={handleContinue}
          disabled={saving || !name.trim()}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: tc.background },
    flex: { flex: 1 },
    sub: { paddingHorizontal: 18, paddingTop: 6, fontSize: 13.5, color: tc.textSecondary },
    form: { flex: 1, paddingHorizontal: 18, paddingTop: 24 },
    input: {
      backgroundColor: tc.paper,
      borderWidth: 2,
      borderColor: tc.border,
      borderRadius: 14,
      paddingVertical: 14,
      paddingHorizontal: 16,
      fontSize: 17,
      fontWeight: '600',
      color: tc.text,
    },
    error: { marginTop: 10, fontSize: 13.5, color: tc.error },
  });
