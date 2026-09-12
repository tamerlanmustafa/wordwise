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
 *
 * ## The reminder is back, built the way the old one should have been
 *
 * One notification, off by default, and the preference is the only thing that
 * decides whether it is scheduled — `reminderStore.reschedule` reads it rather
 * than trusting its caller, so no launch path can re-arm something the user
 * switched off. That inversion is the entire fix for the bug that got the last
 * toggle deleted.
 *
 * Permission is requested HERE and nowhere else. A system prompt that appears
 * because you opened an app is a prompt people decline; one that appears
 * because you just asked for reminders is one they grant.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { useBottomBarInset } from '../../hooks/useBottomBarInset';
import { ScreenHeader } from '../common/ScreenHeader';
import { useFeedbackPrefsStore } from '../../stores/feedbackPrefsStore';
import { REMINDER_HOURS, useReminderStore } from '../../stores/reminderStore';
import { requestNotificationPermission } from '../../services/notifications';
import { showToast } from '../../stores/toastStore';
import { withTap } from '../../utils/feedback';
import { makeSettingsStyles } from './settingsStyles';
import { Rows, Section, SelectRow, SwitchRow } from './settings/SettingsUI';

/** "20:00" — a 24-hour clock, because the picker offers whole hours and an
 *  am/pm suffix would be the only thing on the screen that needed translating
 *  into a convention the user may not use. */
function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export function NotificationSettingsScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  // The picker reuses Settings' modal styling, so the two pickers in the
  // account area are the same object rather than two near-identical sheets.
  const settingsStyles = useMemo(() => makeSettingsStyles(tc), [tc]);
  const barInset = useBottomBarInset();

  // These live in a store rather than local state: the fire path reads them
  // synchronously from anywhere in the app, and this screen is only one of the
  // places that can change them.
  const soundEnabled = useFeedbackPrefsStore((st) => st.soundEnabled);
  const hapticsEnabled = useFeedbackPrefsStore((st) => st.hapticsEnabled);
  const setSoundEnabled = useFeedbackPrefsStore((st) => st.setSoundEnabled);
  const setHapticsEnabled = useFeedbackPrefsStore((st) => st.setHapticsEnabled);

  const reminderOn = useReminderStore((st) => st.enabled);
  const reminderHour = useReminderStore((st) => st.hour);
  const reminderHydrated = useReminderStore((st) => st.hydrated);
  const hydrateReminder = useReminderStore((st) => st.hydrate);
  const [showHourPicker, setShowHourPicker] = useState(false);

  useEffect(() => {
    if (!reminderHydrated) void hydrateReminder();
  }, [reminderHydrated, hydrateReminder]);

  // Written here rather than in the store: the notification has to arrive in
  // the language the user reads, and only a component knows what that is.
  const copy = {
    title: t('settings:reminderTitle'),
    body: t('settings:reminderBody'),
  };

  const toggleReminder = async (on: boolean) => {
    if (on) {
      // Asking first, and only on the way ON. If the user has already denied
      // WordWise at the OS level this returns false without a second prompt —
      // the system only ever asks once — so we say so instead of leaving a
      // switch that flips and silently does nothing.
      const granted = await requestNotificationPermission();
      if (!granted) {
        showToast({ message: t('settings:reminderDenied'), tone: 'default' });
        return;
      }
    }
    await useReminderStore.getState().setEnabled(on, copy);
  };

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

        <Section title={t('settings:dailyReminder')}>
          <Rows>
            <SwitchRow
              label={t('settings:dailyReminder')}
              description={t('settings:dailyReminderDesc')}
              value={reminderOn}
              onValueChange={(v) => void toggleReminder(v)}
            />
            {/* Only once it is on. A time picker above a switch that is off is
                a control with nothing to control. */}
            {reminderOn ? (
              <SelectRow
                label={t('settings:reminderTime')}
                value={formatHour(reminderHour)}
                onPress={withTap(() => setShowHourPicker(true))}
              />
            ) : null}
          </Rows>
        </Section>
      </ScrollView>

      {showHourPicker ? (
        <Modal
          transparent
          animationType="slide"
          visible
          onRequestClose={() => setShowHourPicker(false)}
        >
          <View style={settingsStyles.modalOverlay}>
            <View style={settingsStyles.modalContent}>
              <View style={settingsStyles.modalHeader}>
                <Text style={settingsStyles.modalTitle}>{t('settings:reminderTime')}</Text>
                <TouchableOpacity onPress={withTap(() => setShowHourPicker(false))}>
                  <Text style={settingsStyles.modalClose}>{t('action.done')}</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={settingsStyles.modalScroll}>
                {REMINDER_HOURS.map((h) => (
                  <TouchableOpacity
                    key={h}
                    style={[
                      settingsStyles.modalItem,
                      h === reminderHour && settingsStyles.modalItemSelected,
                    ]}
                    onPress={withTap(() => {
                      void useReminderStore.getState().setHour(h, copy);
                      setShowHourPicker(false);
                    })}
                  >
                    <Text
                      style={[
                        settingsStyles.modalItemText,
                        h === reminderHour && settingsStyles.modalItemTextSelected,
                      ]}
                    >
                      {formatHour(h)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: tc.background },
    scroll: { paddingHorizontal: 16, paddingTop: 20 },
  });
