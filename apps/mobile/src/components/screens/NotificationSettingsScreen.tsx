/**
 * NotificationSettingsScreen — what the app is allowed to interrupt you for.
 *
 * One toggle today. It has its own screen anyway because notifications are a
 * category people go looking for by name, and because this is where the next
 * ones land — a category with one item reads as complete, whereas the same
 * item buried mid-scroll in Settings reads as everything we forgot to offer.
 *
 * The OS-level switch always wins; this only decides whether we schedule.
 */

import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { useBottomBarInset } from '../../hooks/useBottomBarInset';
import { ScreenHeader } from '../common/ScreenHeader';
import { scheduleReviewReminder } from '../../services/notifications';
import { Section, SwitchRow } from './settings/SettingsUI';

export function NotificationSettingsScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const barInset = useBottomBarInset();
  const [reviewNotif, setReviewNotif] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem('notif_review').then((v) => {
      if (v === 'off') setReviewNotif(false);
    });
  }, []);

  const toggleReview = async () => {
    const next = !reviewNotif;
    setReviewNotif(next);
    await AsyncStorage.setItem('notif_review', next ? 'on' : 'off');
    if (next) {
      scheduleReviewReminder();
    } else {
      try {
        const Notif = require('expo-notifications');
        await Notif.cancelScheduledNotificationAsync('review-reminder');
      } catch {}
    }
  };

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <ScreenHeader onBack={onBack} title={t('settings:notifications')} />
      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: barInset + 24 }]}>
        <Section footer={t('settings:notificationsFooter')}>
          <SwitchRow
            label={t('settings:reviewReminder')}
            description={t('settings:reviewReminderDesc')}
            value={reviewNotif}
            onValueChange={toggleReview}
          />
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
