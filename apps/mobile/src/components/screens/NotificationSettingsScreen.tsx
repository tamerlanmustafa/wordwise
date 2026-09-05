/**
 * NotificationSettingsScreen — what the app is allowed to do to get your
 * attention: the sounds it makes and the buzzes it sends.
 *
 * There was a review-reminder toggle here and it has been removed outright,
 * not hidden. It never worked: `App.tsx` called `scheduleReviewReminder()`
 * unconditionally on every launch without consulting the stored preference, so
 * turning it off lasted until the next cold start. And because a scheduled
 * local notification lives in the OS rather than in the bundle, deleting the
 * scheduler would not have stopped the ones already registered — so launch now
 * cancels the `review-reminder` trigger instead. That cancel has to stay until
 * no installs predate this; removing it early strands the people who had the
 * reminder switched on.
 *
 * That leaves sound and haptics, which is why they moved here from Settings:
 * they are the same question ("interrupt me how?"), and Settings should be the
 * things you set rather than the things that happen to you.
 */

import { useMemo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { useBottomBarInset } from '../../hooks/useBottomBarInset';
import { ScreenHeader } from '../common/ScreenHeader';
import { useFeedbackPrefsStore } from '../../stores/feedbackPrefsStore';
import { Rows, Section, SwitchRow } from './settings/SettingsUI';

export function NotificationSettingsScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const barInset = useBottomBarInset();

  // These live in a store rather than local state: the fire path reads them
  // synchronously from anywhere in the app, and this screen is only one of the
  // places that can change them.
  const soundEnabled = useFeedbackPrefsStore((st) => st.soundEnabled);
  const hapticsEnabled = useFeedbackPrefsStore((st) => st.hapticsEnabled);
  const setSoundEnabled = useFeedbackPrefsStore((st) => st.setSoundEnabled);
  const setHapticsEnabled = useFeedbackPrefsStore((st) => st.setHapticsEnabled);

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <ScreenHeader onBack={onBack} title={t('settings:notifications')} />
      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: barInset + 24 }]}>
        <Section title={t('settings:soundAndHaptics')} footer={t('settings:notificationsFooter')}>
          <Rows>
            <SwitchRow
              label={t('settings:soundEffects')}
              description={t('settings:soundEffectsDesc')}
              value={soundEnabled}
              onValueChange={setSoundEnabled}
            />
            <SwitchRow
              label={t('settings:haptics')}
              description={t('settings:hapticsDesc')}
              value={hapticsEnabled}
              onValueChange={setHapticsEnabled}
            />
          </Rows>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: tc.background },
    scroll: { paddingHorizontal: 16, paddingTop: 20 },
  });
