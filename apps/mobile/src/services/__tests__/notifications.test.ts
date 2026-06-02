// expo-notifications / expo-device aren't installed in this (Expo Go-style)
// environment, so the module's require()-guards fall through to safe no-ops.
// These tests pin that contract: the reminder-mode preference persists via
// AsyncStorage, and the scheduling APIs never throw when the native module is
// absent.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getWordReminderMode,
  setWordReminderMode,
  registerForPushNotifications,
  scheduleWordReminder,
  scheduleReviewReminder,
  cancelAllReminders,
} from '../notifications';

const KEY = 'notif_word_mode';

describe('notifications — reminder-mode preference', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('defaults to daily when nothing is stored', async () => {
    await expect(getWordReminderMode()).resolves.toBe('daily');
  });

  it('persists and reads back an hourly preference', async () => {
    await setWordReminderMode('hourly');
    expect(await AsyncStorage.getItem(KEY)).toBe('hourly');
    await expect(getWordReminderMode()).resolves.toBe('hourly');
  });

  it('treats any non-"hourly" stored value as daily', async () => {
    await AsyncStorage.setItem(KEY, 'weekly');
    await expect(getWordReminderMode()).resolves.toBe('daily');
  });
});

describe('notifications — safe no-ops without the native module', () => {
  it('registerForPushNotifications resolves to null', async () => {
    await expect(registerForPushNotifications()).resolves.toBeNull();
  });

  it('scheduleWordReminder does not throw', async () => {
    await expect(scheduleWordReminder()).resolves.toBeUndefined();
    await expect(scheduleWordReminder('hourly')).resolves.toBeUndefined();
  });

  it('scheduleReviewReminder does not throw', async () => {
    await expect(scheduleReviewReminder()).resolves.toBeUndefined();
  });

  it('cancelAllReminders does not throw', async () => {
    await expect(cancelAllReminders()).resolves.toBeUndefined();
  });
});
