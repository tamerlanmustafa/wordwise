/**
 * feedbackPrefsStore (#179) — the two switches persist, default on, and
 * survive whatever is actually in storage.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_FEEDBACK_PREFS,
  getFeedbackPrefs,
  parseStoredPrefs,
  useFeedbackPrefsStore,
} from '../feedbackPrefsStore';

const KEY = 'wordwise.feedback.v1';

beforeEach(async () => {
  await AsyncStorage.clear();
  useFeedbackPrefsStore.setState({ ...DEFAULT_FEEDBACK_PREFS, hydrated: false });
});

describe('parseStoredPrefs — a bad read must not cost a launch', () => {
  it('defaults both switches on when nothing is stored', () => {
    expect(parseStoredPrefs(null)).toEqual({ soundEnabled: true, hapticsEnabled: true });
  });

  it('reads a stored pair back', () => {
    expect(parseStoredPrefs('{"soundEnabled":false,"hapticsEnabled":true}')).toEqual({
      soundEnabled: false,
      hapticsEnabled: true,
    });
  });

  it('falls back to the defaults on unparseable JSON', () => {
    expect(parseStoredPrefs('{ not json')).toEqual(DEFAULT_FEEDBACK_PREFS);
  });

  it('fills in a key an older build never wrote, keeping the one it did', () => {
    expect(parseStoredPrefs('{"soundEnabled":false}')).toEqual({
      soundEnabled: false,
      hapticsEnabled: true,
    });
  });

  it('ignores a non-boolean value rather than making it truthy', () => {
    expect(parseStoredPrefs('{"soundEnabled":"no"}').soundEnabled).toBe(true);
  });
});

describe('the switches', () => {
  it('start on, so a fresh install has feedback', () => {
    expect(getFeedbackPrefs()).toEqual({ soundEnabled: true, hapticsEnabled: true });
  });

  it('persists a change and reads it back on the next launch', async () => {
    useFeedbackPrefsStore.getState().setSoundEnabled(false);
    expect(await AsyncStorage.getItem(KEY)).toBe(
      JSON.stringify({ soundEnabled: false, hapticsEnabled: true }),
    );

    // A new launch: reset in-memory state, hydrate from storage.
    useFeedbackPrefsStore.setState({ ...DEFAULT_FEEDBACK_PREFS, hydrated: false });
    await useFeedbackPrefsStore.getState().hydrate();
    expect(getFeedbackPrefs().soundEnabled).toBe(false);
    expect(useFeedbackPrefsStore.getState().hydrated).toBe(true);
  });

  it('are independent — silencing sound leaves haptics alone', () => {
    useFeedbackPrefsStore.getState().setSoundEnabled(false);
    expect(getFeedbackPrefs()).toEqual({ soundEnabled: false, hapticsEnabled: true });

    useFeedbackPrefsStore.getState().setHapticsEnabled(false);
    useFeedbackPrefsStore.getState().setSoundEnabled(true);
    expect(getFeedbackPrefs()).toEqual({ soundEnabled: true, hapticsEnabled: false });
  });

  it('marks itself hydrated even when storage throws, so the app never waits forever', async () => {
    const spy = jest
      .spyOn(AsyncStorage, 'getItem')
      .mockRejectedValueOnce(new Error('storage unavailable'));
    await useFeedbackPrefsStore.getState().hydrate();
    expect(useFeedbackPrefsStore.getState().hydrated).toBe(true);
    expect(getFeedbackPrefs()).toEqual(DEFAULT_FEEDBACK_PREFS);
    spy.mockRestore();
  });
});
