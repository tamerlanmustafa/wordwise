import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTipDismissalsStore } from '../tipDismissalsStore';

const KEY = 'tips.dismissed.v1';
const flush = () => new Promise<void>((r) => setImmediate(r));

describe('tipDismissalsStore', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useTipDismissalsStore.setState({
      dismissed: new Set(),
      shownThisSession: new Set(),
      hydrated: false,
    });
  });

  describe('hydrate', () => {
    it('loads persisted "don\'t show again" keys', async () => {
      await AsyncStorage.setItem(KEY, JSON.stringify(['spacing_first_repeat']));
      await useTipDismissalsStore.getState().hydrate();
      expect(useTipDismissalsStore.getState().dismissed.has('spacing_first_repeat')).toBe(true);
      expect(useTipDismissalsStore.getState().hydrated).toBe(true);
    });

    it('starts clean when storage is empty', async () => {
      await useTipDismissalsStore.getState().hydrate();
      expect(useTipDismissalsStore.getState().dismissed.size).toBe(0);
    });
  });

  describe('shouldShow', () => {
    it('is true for a fresh, never-shown, never-dismissed tip', () => {
      expect(useTipDismissalsStore.getState().shouldShow('new_tip')).toBe(true);
    });

    it('is false once the tip was shown this session', () => {
      useTipDismissalsStore.getState().markShown('new_tip');
      expect(useTipDismissalsStore.getState().shouldShow('new_tip')).toBe(false);
    });

    it('is false once the tip was permanently dismissed', async () => {
      await useTipDismissalsStore.getState().dismiss('new_tip');
      expect(useTipDismissalsStore.getState().shouldShow('new_tip')).toBe(false);
    });

    it('treats each key independently', () => {
      useTipDismissalsStore.getState().markShown('tip_a');
      expect(useTipDismissalsStore.getState().shouldShow('tip_a')).toBe(false);
      expect(useTipDismissalsStore.getState().shouldShow('tip_b')).toBe(true);
    });
  });

  describe('dismiss', () => {
    it('persists the dismissal so it survives a relaunch', async () => {
      await useTipDismissalsStore.getState().dismiss('spacing_first_repeat');
      await flush();
      const raw = await AsyncStorage.getItem(KEY);
      expect(JSON.parse(raw!)).toContain('spacing_first_repeat');
    });
  });

  describe('markShown', () => {
    it('is session-only and does NOT persist', async () => {
      useTipDismissalsStore.getState().markShown('ephemeral_tip');
      await flush();
      expect(await AsyncStorage.getItem(KEY)).toBeNull();
    });
  });
});
