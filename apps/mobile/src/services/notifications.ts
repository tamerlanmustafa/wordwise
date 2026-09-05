import { Platform } from 'react-native';
import { t } from '../i18n';

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
 * Cancel the retired "Word of the Hour" reminder.
 *
 * The feature is gone — its Settings toggle was removed on 2026-09-05 — but a
 * repeating local notification lives in the OS, not in the bundle, so deleting
 * the code that scheduled it does NOT stop it. Every install that ever ran the
 * old build has a `daily-word` trigger sitting in the notification centre, and
 * on `hourly` it fires every hour, for ever, with nothing left in the app to
 * turn it off.
 *
 * So this runs at launch instead: cheap, idempotent, and a no-op once the
 * trigger is gone. It stays until we are confident no installs predate the
 * removal — deleting it early is what would strand those users.
 */
export async function cancelWordReminder(): Promise<void> {
  if (!Notifications) return;
  try {
    await Notifications.cancelScheduledNotificationAsync('daily-word');
  } catch {}
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
