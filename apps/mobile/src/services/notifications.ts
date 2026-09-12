import { Platform } from 'react-native';

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

/**
 * Cancel the retired review reminder.
 *
 * Same shape as `cancelWordReminder` above, and for the same reason: the
 * toggle never held (App.tsx scheduled it on every launch regardless of the
 * stored preference), and a repeating local notification lives in the OS, not
 * the bundle — so deleting the scheduler does not stop the triggers already
 * out there. Runs at launch; cheap, idempotent, and a no-op once gone. Keep it
 * until no installs predate the removal.
 */
export async function cancelReviewReminder(): Promise<void> {
  if (!Notifications) return;
  try {
    await Notifications.cancelScheduledNotificationAsync('review-reminder');
  } catch {}
}

export async function cancelAllReminders(): Promise<void> {
  if (!Notifications) return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {}
}

// ── The daily practice reminder ─────────────────────────────────────────────
//
// One notification, and only one. The app had none: `registerForPushNotifications`
// asks for a token and then discards it, no server has ever sent a push, and the
// two functions above exist purely to kill reminders from builds that predate
// their own removal. So a user who forgot about WordWise was gone for good, and
// the streak — the entire retention mechanic — had nothing defending it.
//
// ## Why local, and not a server push
//
// A server push needs token storage, a scheduler that respects every user's
// timezone, and a sender to maintain. A local notification needs none of that
// and works with no connectivity. A repeating one also keeps working when the
// app is never opened again, which a server-driven reminder only manages if
// the server is still running and the token is still valid.
//
// ## One repeating trigger, by decision
//
// This first shipped as three dated one-off triggers that ran out on their own,
// so an app nobody opened eventually stopped asking. That was changed to a
// repeating DAILY trigger on request: it fires every day at the chosen time and
// keeps firing until the user switches it off, which is what the setting says
// it does and what a daily-habit app is expected to do.
//
// The consequence, recorded rather than hidden: the OS owns this trigger and
// will deliver it whether or not the user practised that day — a local trigger
// cannot consult app state at fire time. That is why the copy is written to be
// true on any day ("time for today's lesson"), not as an accusation ("you
// haven't practised"). Getting that wrong would mean telling a user who
// finished at breakfast that they have not started.

/** Identifier for the repeating trigger, so it can be replaced rather than
 *  stacked. Scheduling twice under one id updates it; scheduling under two ids
 *  is how an app ends up notifying you twice every evening. */
const REMINDER_ID = 'practice-reminder-daily';

/** Cancel the reminder. Safe when none is scheduled. */
export async function cancelPracticeReminders(): Promise<void> {
  if (!Notifications) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(REMINDER_ID);
  } catch {}
  // The previous implementation left up to three dated triggers in the OS, and
  // those outlive the code that made them — the same trap `cancelWordReminder`
  // above exists for. Clear them too, or an install that had the reminder on
  // before this change gets both the old series and the new repeat. Cheap, and
  // a no-op once no install predates it.
  for (let i = 0; i < 3; i += 1) {
    try {
      await Notifications.cancelScheduledNotificationAsync(`practice-reminder-${i}`);
    } catch {}
  }
}

/**
 * Arm the repeating reminder. Cancels first, so this is the only call a caller
 * needs and calling it twice is harmless.
 *
 * Returns true when it is scheduled; false means permission is not granted, or
 * the native module is unavailable (Expo Go, simulator without a dev client).
 */
export async function schedulePracticeReminders(
  hour: number,
  minute: number,
  body: { title: string; body: string },
): Promise<boolean> {
  if (!Notifications) return false;
  await cancelPracticeReminders();

  try {
    const { status } = await Notifications.getPermissionsAsync();
    // Deliberately does NOT request permission here. This runs on launch and
    // after finishing a lesson; a permission sheet at either moment is an
    // interruption the user did not ask for. The toggle asks — see the
    // settings screen.
    if (status !== 'granted') return false;
  } catch {
    return false;
  }

  try {
    await Notifications.scheduleNotificationAsync({
      identifier: REMINDER_ID,
      content: { title: body.title, body: body.body },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
      },
    });
    return true;
  } catch {
    return false;
  }
}

/** Ask for permission, for the one place that should: the toggle itself. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!Notifications) return false;
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === 'granted') return true;
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}
