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
// timezone, and a sender to maintain. A local notification needs none of that,
// works with no connectivity, and for this particular message is not a
// compromise: "you have not practised today" is a fact the phone already knows.
//
// ## Why several one-off triggers instead of one repeating daily trigger
//
// A `DAILY` trigger fires every day forever, including the days the user already
// practised and the months after they stopped. That is the reminder everyone
// mutes. Instead this schedules the next `REMINDER_DAYS` days as individual
// dated triggers, and every re-arm cancels the old set first — so:
//
//   * someone who practises re-arms on completion and only ever has future
//     days pending; the one for today is gone before it can fire;
//   * someone who stops gets REMINDER_DAYS nudges on consecutive days and then
//     silence, because nothing re-armed the set.
//
// That second property is the point. The app stops asking on its own, without
// needing a server to notice, and without the user having to find a setting to
// make it stop.

/** Identifier prefix, so the set can be cancelled without touching anything
 *  else the OS is holding for this app. */
const REMINDER_ID = 'practice-reminder';

/** How many consecutive days to arm. Three is "we noticed, twice", not a
 *  campaign — a fourth unanswered notification is how an app gets muted. */
export const REMINDER_DAYS = 3;

/** Cancel every pending reminder in the set. Safe when none exist. */
export async function cancelPracticeReminders(): Promise<void> {
  if (!Notifications) return;
  for (let i = 0; i < REMINDER_DAYS; i += 1) {
    try {
      await Notifications.cancelScheduledNotificationAsync(`${REMINDER_ID}-${i}`);
    } catch {}
  }
}

/**
 * The next `REMINDER_DAYS` occurrences of `hour:minute`, starting from the
 * first one still in the future.
 *
 * Exported and pure so the date arithmetic can be tested — the parts that go
 * wrong here (today's slot has already passed; a month or year boundary) are
 * invisible in a UI and obvious in a test.
 */
export function reminderDates(
  hour: number,
  minute: number,
  from: Date = new Date(),
  days: number = REMINDER_DAYS,
): Date[] {
  const out: Date[] = [];
  const first = new Date(from);
  first.setHours(hour, minute, 0, 0);
  // Today's slot has already gone by, so the series starts tomorrow. Scheduling
  // a past date is not an error the OS reports — it simply never fires, which
  // would silently cost the user their first night.
  if (first.getTime() <= from.getTime()) first.setDate(first.getDate() + 1);
  for (let i = 0; i < days; i += 1) {
    const d = new Date(first);
    // `setDate` past the end of the month rolls the month (and the year) for
    // us; building the date from a day-count would not.
    d.setDate(first.getDate() + i);
    out.push(d);
  }
  return out;
}

/**
 * Re-arm the reminder set. Cancels first, so this is the only call a caller
 * ever needs and calling it twice is harmless.
 *
 * Returns how many were scheduled: 0 means the user has not granted
 * permission, or the native module is unavailable (Expo Go, simulator).
 */
export async function schedulePracticeReminders(
  hour: number,
  minute: number,
  body: { title: string; body: string },
): Promise<number> {
  if (!Notifications) return 0;
  await cancelPracticeReminders();

  try {
    const { status } = await Notifications.getPermissionsAsync();
    // Deliberately does NOT request permission here. This runs on launch and
    // after finishing a lesson; a permission sheet at either moment is an
    // interruption the user did not ask for. The toggle asks — see the
    // settings screen.
    if (status !== 'granted') return 0;
  } catch {
    return 0;
  }

  const dates = reminderDates(hour, minute);
  let scheduled = 0;
  for (let i = 0; i < dates.length; i += 1) {
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: `${REMINDER_ID}-${i}`,
        content: { title: body.title, body: body.body },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: dates[i],
        },
      });
      scheduled += 1;
    } catch {
      // One failure should not lose the rest of the series.
    }
  }
  return scheduled;
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
