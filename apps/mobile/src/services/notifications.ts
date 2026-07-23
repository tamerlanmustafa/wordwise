import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { t } from '../i18n';

/** How often the "Word of the Hour" reminder fires. Defaults to once a day. */
export type WordReminderMode = 'daily' | 'hourly';
const WORD_REMINDER_MODE_KEY = 'notif_word_mode';

export async function getWordReminderMode(): Promise<WordReminderMode> {
  try {
    return (await AsyncStorage.getItem(WORD_REMINDER_MODE_KEY)) === 'hourly'
      ? 'hourly'
      : 'daily';
  } catch {
    return 'daily';
  }
}

export async function setWordReminderMode(mode: WordReminderMode): Promise<void> {
  try {
    await AsyncStorage.setItem(WORD_REMINDER_MODE_KEY, mode);
  } catch {}
}

let Notifications: typeof import('expo-notifications') | null = null;
let Device: typeof import('expo-device') | null = null;

try {
  Notifications = require('expo-notifications');
  Device = require('expo-device');

  Notifications!.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
} catch {
  console.warn('[notifications] expo-notifications not available (needs dev client)');
}

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Notifications || !Device) return null;
  if (!Device.isDevice) return null;

  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;

    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') return null;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const token = await Notifications.getExpoPushTokenAsync();
    return token.data;
  } catch (e) {
    console.warn('[notifications] registration failed:', e);
    return null;
  }
}

/**
 * Schedule the "Word of the Hour" reminder. The word itself rotates hourly, but
 * the reminder defaults to once a day at 9 AM so we don't spam the user; pass
 * (or persist via setWordReminderMode) 'hourly' to nudge them every hour.
 * When `mode` is omitted the persisted preference is used.
 */
export async function scheduleWordReminder(mode?: WordReminderMode): Promise<void> {
  if (!Notifications) return;
  const resolved = mode ?? (await getWordReminderMode());
  try {
    await Notifications.cancelScheduledNotificationAsync('daily-word');
    await Notifications.scheduleNotificationAsync({
      identifier: 'daily-word',
      content: {
        title: t('notifications:reminder.wordTitle'),
        body: t('notifications:reminder.wordBody'),
      },
      trigger:
        resolved === 'hourly'
          ? {
              type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
              seconds: 3600,
              repeats: true,
            }
          : {
              type: Notifications.SchedulableTriggerInputTypes.DAILY,
              hour: 9,
              minute: 0,
            },
    });
  } catch (e) {
    console.warn('[notifications] schedule word reminder failed:', e);
  }
}

export async function scheduleReviewReminder(): Promise<void> {
  if (!Notifications) return;
  try {
    await Notifications.cancelScheduledNotificationAsync('review-reminder');
    await Notifications.scheduleNotificationAsync({
      identifier: 'review-reminder',
      content: {
        title: t('notifications:reminder.reviewTitle'),
        body: t('notifications:reminder.reviewBody'),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: 18,
        minute: 0,
      },
    });
  } catch (e) {
    console.warn('[notifications] schedule review reminder failed:', e);
  }
}

export async function cancelAllReminders(): Promise<void> {
  if (!Notifications) return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {}
}
