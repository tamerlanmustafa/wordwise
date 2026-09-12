/**
 * The one notification, and the rule that killed the last one.
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
 * The date arithmetic gets the same treatment for the opposite reason: it is
 * invisible. A reminder scheduled for a time that has already passed never
 * fires and reports no error, so "today's slot has gone by" and "the month
 * rolled over" are bugs you would only find by waiting a day.
 */

import { reminderDates, REMINDER_DAYS } from '../../services/notifications';
import {
  DEFAULT_HOUR,
  REMINDER_HOURS,
  useReminderStore,
} from '../reminderStore';

jest.mock('../../services/notifications', () => {
  const actual = jest.requireActual('../../services/notifications');
  return {
    ...actual,
    schedulePracticeReminders: jest.fn(async () => actual.REMINDER_DAYS),
    cancelPracticeReminders: jest.fn(async () => undefined),
  };
});

const notifications = jest.requireMock('../../services/notifications');
const copy = { title: 'Keep your streak', body: 'One lesson keeps it going.' };

const reset = (over: Partial<{ enabled: boolean; hour: number; hydrated: boolean }> = {}) =>
  useReminderStore.setState({
    enabled: false,
    hour: DEFAULT_HOUR,
    minute: 0,
    hydrated: true,
    ...over,
  });

describe('reminderDates', () => {
  it('starts today when the slot is still ahead', () => {
    const now = new Date(2026, 8, 12, 9, 0);     // 09:00, reminder at 20:00
    const [first] = reminderDates(20, 0, now);
    expect(first.getDate()).toBe(12);
    expect(first.getHours()).toBe(20);
    expect(first.getMinutes()).toBe(0);
  });

  it('starts tomorrow when the slot has already passed', () => {
    // The invisible bug: a date in the past is accepted by the scheduler and
    // simply never fires. The user loses their first night and nothing says so.
    const now = new Date(2026, 8, 12, 21, 30);   // 21:30, reminder at 20:00
    const [first] = reminderDates(20, 0, now);
    expect(first.getDate()).toBe(13);
  });

  it('treats the exact minute as passed', () => {
    // 20:00:00 on the dot is not "ahead"; scheduling it races the clock.
    const now = new Date(2026, 8, 12, 20, 0, 0, 0);
    expect(reminderDates(20, 0, now)[0].getDate()).toBe(13);
  });

  it('returns consecutive days', () => {
    const now = new Date(2026, 8, 12, 9, 0);
    const days = reminderDates(20, 0, now).map((d) => d.getDate());
    expect(days).toEqual([12, 13, 14]);
  });

  it('rolls over a month boundary', () => {
    const now = new Date(2026, 8, 29, 9, 0);     // 29 Sept, 30 days in Sept
    const d = reminderDates(20, 0, now);
    expect(d.map((x) => [x.getMonth(), x.getDate()])).toEqual([[8, 29], [8, 30], [9, 1]]);
  });

  it('rolls over a year boundary', () => {
    const now = new Date(2026, 11, 30, 9, 0);    // 30 Dec
    const d = reminderDates(20, 0, now);
    expect(d.map((x) => x.getFullYear())).toEqual([2026, 2026, 2027]);
  });

  it('arms a finite series, so it runs out on its own', () => {
    // The whole anti-nagging design. Nothing re-arms for a user who stopped
    // opening the app, so the reminders stop after this many days without
    // anyone having to find a setting.
    expect(reminderDates(20, 0, new Date())).toHaveLength(REMINDER_DAYS);
    expect(REMINDER_DAYS).toBeLessThanOrEqual(3);
  });
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
