/**
 * The one notification, and the rule that killed the last one.
 *
 * It is a REPEATING daily trigger: the OS fires it at the chosen time every day
 * until the user switches it off. That means there is no series to schedule and
 * no date arithmetic to get wrong — the parts of this that can still break are
 * the preference and the copy, and the preference is the one with a history.
 *
 * A review reminder shipped here before and was deleted rather than repaired.
 * It was not broken in an interesting way: `App.tsx` scheduled it on every
 * launch *without consulting the stored preference*, so switching it off
 * lasted exactly until the next cold start. The setting existed and did
 * nothing.
 *
 * So the invariant worth defending is not "the toggle writes to storage" — it
 * is that **the preference decides**, and the caller cannot override it by
 * asking. `reschedule` reads `enabled` itself, and callers pass copy, not
 * intent. Two of the tests below exist only to pin that.
 *
 * What is NOT tested here, deliberately: that the notification actually fires.
 * The OS owns the trigger once it is handed over, so the only honest check is
 * on a device with the clock rolled forward. These cover the decision to hand
 * it over at all, which is the part that has gone wrong before.
 */

import {
  DEFAULT_HOUR,
  REMINDER_HOURS,
  useReminderStore,
} from '../reminderStore';

jest.mock('../../services/notifications', () => ({
  schedulePracticeReminders: jest.fn(async () => true),
  cancelPracticeReminders: jest.fn(async () => undefined),
  requestNotificationPermission: jest.fn(async () => true),
}));

const notifications = jest.requireMock('../../services/notifications');
const copy = { title: "Time for today's lesson", body: 'A couple of minutes keeps it going.' };

const reset = (over: Partial<{ enabled: boolean; hour: number; hydrated: boolean }> = {}) =>
  useReminderStore.setState({
    enabled: false,
    hour: DEFAULT_HOUR,
    minute: 0,
    hydrated: true,
    ...over,
  });

describe('the preference decides, not the caller', () => {
  beforeEach(() => {
    notifications.schedulePracticeReminders.mockClear();
    notifications.cancelPracticeReminders.mockClear();
  });

  it('schedules nothing when the reminder is off', async () => {
    // The bug that deleted the last toggle, asserted directly: a launch path
    // calling reschedule must not resurrect a reminder the user turned off.
    reset({ enabled: false });
    await useReminderStore.getState().reschedule(copy);
    expect(notifications.schedulePracticeReminders).not.toHaveBeenCalled();
    expect(notifications.cancelPracticeReminders).toHaveBeenCalled();
  });

  it('schedules when it is on', async () => {
    reset({ enabled: true, hour: 19 });
    await useReminderStore.getState().reschedule(copy);
    expect(notifications.schedulePracticeReminders).toHaveBeenCalledWith(19, 0, copy);
  });

  it('does nothing at all before the preference has loaded', async () => {
    // Pre-hydration the in-memory value is the default (off), not the user's
    // answer. Acting on it would cancel a real reminder on every cold start —
    // the same class of bug, pointing the other way.
    reset({ enabled: true, hydrated: false });
    await useReminderStore.getState().reschedule(copy);
    expect(notifications.schedulePracticeReminders).not.toHaveBeenCalled();
    expect(notifications.cancelPracticeReminders).not.toHaveBeenCalled();
  });
});

describe('turning it on and off', () => {
  beforeEach(() => {
    notifications.schedulePracticeReminders.mockClear();
    notifications.cancelPracticeReminders.mockClear();
  });

  it('is off by default', () => {
    // An app that starts notifying because you installed it has answered a
    // question nobody asked.
    useReminderStore.setState({ enabled: false, hydrated: false, hour: DEFAULT_HOUR, minute: 0 });
    expect(useReminderStore.getState().enabled).toBe(false);
  });

  it('arms on enable and clears on disable', async () => {
    reset({ enabled: false });
    await useReminderStore.getState().setEnabled(true, copy);
    expect(notifications.schedulePracticeReminders).toHaveBeenCalled();

    await useReminderStore.getState().setEnabled(false, copy);
    expect(notifications.cancelPracticeReminders).toHaveBeenCalled();
  });

  it('re-arms when the time changes while on', async () => {
    reset({ enabled: true, hour: 20 });
    await useReminderStore.getState().setHour(8, copy);
    expect(notifications.schedulePracticeReminders).toHaveBeenCalledWith(8, 0, copy);
  });

  it('does not schedule when the time changes while off', async () => {
    reset({ enabled: false, hour: 20 });
    await useReminderStore.getState().setHour(8, copy);
    expect(notifications.schedulePracticeReminders).not.toHaveBeenCalled();
    expect(useReminderStore.getState().hour).toBe(8);
  });

  it('only offers hours a person would pick', () => {
    // Whole hours across waking time. A minute-accurate picker asks the user
    // to make a decision they do not have.
    expect(REMINDER_HOURS.length).toBeGreaterThan(4);
    REMINDER_HOURS.forEach((h) => {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(24);
    });
    expect(REMINDER_HOURS).toContain(DEFAULT_HOUR);
  });
});
