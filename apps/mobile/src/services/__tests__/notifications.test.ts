// expo-notifications / expo-device aren't installed in this (Expo Go-style)
// environment, so the module's require()-guards fall through to safe no-ops.
// These tests pin that contract: every scheduling API is safe to call when the
// native module is absent.
import {
  registerForPushNotifications,
  cancelWordReminder,
  cancelReviewReminder,
  cancelAllReminders,
} from '../notifications';

describe('notifications — safe no-ops without the native module', () => {
  it('registerForPushNotifications resolves to null', async () => {
    await expect(registerForPushNotifications()).resolves.toBeNull();
  });

  it('cancelWordReminder does not throw', async () => {
    // Runs on every launch to clear the retired Word of the Hour trigger, so
    // "safe on a device with no native module" is the whole contract.
    await expect(cancelWordReminder()).resolves.toBeUndefined();
  });

  it('cancelReviewReminder does not throw', async () => {
    // Runs on every launch to clear the retired review reminder, so "safe on a
    // device with no native module" is the whole contract.
    await expect(cancelReviewReminder()).resolves.toBeUndefined();
  });

  it('cancelAllReminders does not throw', async () => {
    await expect(cancelAllReminders()).resolves.toBeUndefined();
  });
});
