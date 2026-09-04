/**
 * The Practice lesson cursor.
 *
 * This store used to be a plain AsyncStorage counter, and that was the bug:
 * AsyncStorage is per *install*, so the same account read lesson 34 on iOS
 * and lesson 8 on Android — two counters that had never met — and a reinstall
 * put anyone back on lesson 1. The number now belongs to the account and this
 * store is a cache in front of it.
 *
 * The property every test here is really defending is **monotonicity**: the
 * cursor must never go down. A user who sees the path slide backwards has
 * lost work as far as they are concerned, and there are several ways to do it
 * by accident — an older server that omits the field, a response that lands
 * after a session the device already counted, a cache written before a sync.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../services/api', () => ({
  srsApi: { syncPracticeProgress: jest.fn() },
}));

import { usePracticePathStore } from '../practicePathStore';
import { useAuthStore } from '../authStore';
import { srsApi } from '../../services/api';

const LEGACY_KEY = 'practice.path.cursor.v1';
const CACHE_KEY = 'practice.path.cursor.v2:7';

const mockSync = srsApi.syncPracticeProgress as jest.Mock;
const flush = () => new Promise<void>((r) => setImmediate(r));

const signIn = (id: number | null) =>
  useAuthStore.setState({
    user: id === null ? null : ({ id, email: 'a@b.c' } as never),
    status: id === null ? 'unauthenticated' : 'authenticated',
  });

describe('practicePathStore', () => {
  let nowSpy: jest.SpyInstance;
  let clock = 1_000_000;

  beforeEach(async () => {
    await AsyncStorage.clear();
    clock = 1_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => clock);
    mockSync.mockReset();
    // Default: the account agrees with whatever the device sends.
    mockSync.mockImplementation(async (n: number) => n);
    signIn(7);
    // _resetTo also clears the module-level debounce timestamp.
    usePracticePathStore.getState()._resetTo(0);
    usePracticePathStore.setState({ hydrated: false });
    await flush();
    await AsyncStorage.clear();
  });

  afterEach(() => {
    nowSpy.mockRestore();
    signIn(null);
  });

  describe('hydrate', () => {
    it('defaults to cursor 0 when nothing is cached', async () => {
      await usePracticePathStore.getState().hydrate();
      expect(usePracticePathStore.getState().cursor).toBe(0);
      expect(usePracticePathStore.getState().hydrated).toBe(true);
    });

    it('restores this account’s cached cursor', async () => {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ cursor: 12 }));
      await usePracticePathStore.getState().hydrate();
      expect(usePracticePathStore.getState().cursor).toBe(12);
    });

    it('floors a fractional cached cursor', async () => {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ cursor: 4.9 }));
      await usePracticePathStore.getState().hydrate();
      expect(usePracticePathStore.getState().cursor).toBe(4);
    });

    it('ignores a corrupt/negative cached cursor and falls back to 0', async () => {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ cursor: -3 }));
      await usePracticePathStore.getState().hydrate();
      expect(usePracticePathStore.getState().cursor).toBe(0);
    });

    it('survives garbage JSON without throwing', async () => {
      await AsyncStorage.setItem(CACHE_KEY, 'not json');
      await usePracticePathStore.getState().hydrate();
      expect(usePracticePathStore.getState().cursor).toBe(0);
      expect(usePracticePathStore.getState().hydrated).toBe(true);
    });

    it('does not use another account’s cache', async () => {
      // Logging out never cleared this key, so a second account on the same
      // phone inherited the first one's lesson number — harmless while the
      // number was local, permanent once it is merged into the account.
      await AsyncStorage.setItem('practice.path.cursor.v2:99', JSON.stringify({ cursor: 40 }));
      await usePracticePathStore.getState().hydrate();
      expect(usePracticePathStore.getState().cursor).toBe(0);
    });
  });

  describe('the account is the source of truth', () => {
    it('sends the local number up and takes the merged one back', async () => {
      // The reported case, from the phone that was behind.
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ cursor: 8 }));
      mockSync.mockResolvedValue(34);

      await usePracticePathStore.getState().hydrate();

      expect(mockSync).toHaveBeenCalledWith(8);
      expect(usePracticePathStore.getState().cursor).toBe(34);
    });

    it('caches the merged number, so the next cold start paints it', async () => {
      mockSync.mockResolvedValue(34);
      await usePracticePathStore.getState().hydrate();
      await flush();
      expect(await AsyncStorage.getItem(CACHE_KEY)).toBe(JSON.stringify({ cursor: 34 }));
    });

    it('never moves the cursor backwards on a lower reply', async () => {
      // Cannot happen with a GREATEST merge, which is exactly why it is worth
      // pinning: the client must not depend on the server being well-behaved
      // to avoid showing a user less progress than they had.
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ cursor: 30 }));
      mockSync.mockResolvedValue(2);

      await usePracticePathStore.getState().hydrate();

      expect(usePracticePathStore.getState().cursor).toBe(30);
    });

    it('keeps the local number when the sync fails', async () => {
      // Offline launch. The path still has to draw the right tile.
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ cursor: 30 }));
      mockSync.mockRejectedValue(new Error('offline'));

      await usePracticePathStore.getState().hydrate();

      expect(usePracticePathStore.getState().cursor).toBe(30);
      expect(usePracticePathStore.getState().hydrated).toBe(true);
    });

    it('does not call the server when signed out', async () => {
      signIn(null);
      await usePracticePathStore.getState().hydrate();
      expect(mockSync).not.toHaveBeenCalled();
    });

    it('does not re-sync for an account it has already hydrated', async () => {
      await usePracticePathStore.getState().hydrate();
      await usePracticePathStore.getState().hydrate();
      expect(mockSync).toHaveBeenCalledTimes(1);
    });

    it('re-reads when a different account signs in', async () => {
      // The store outlives a sign-out, so without this the second account
      // would keep the first one's number on screen — and then push it up to
      // their account on the next sync, where GREATEST would make it stick.
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ cursor: 34 }));
      await usePracticePathStore.getState().hydrate();
      expect(usePracticePathStore.getState().cursor).toBe(34);

      signIn(8);
      await usePracticePathStore.getState().hydrate();

      expect(usePracticePathStore.getState().cursor).toBe(0);
      expect(mockSync).toHaveBeenLastCalledWith(0);
    });
  });

  describe('resync', () => {
    it('pulls the account’s number without re-reading the caches', async () => {
      // The phone that was behind: it opens the Practice tab after the other
      // one has already pushed 34, and should catch up on that tab switch
      // rather than waiting for the next cold start.
      usePracticePathStore.getState()._resetTo(8);
      mockSync.mockResolvedValue(34);

      await usePracticePathStore.getState().resync();

      expect(mockSync).toHaveBeenCalledWith(8);
      expect(usePracticePathStore.getState().cursor).toBe(34);
    });

    it('is silent when it fails', async () => {
      usePracticePathStore.getState()._resetTo(8);
      mockSync.mockRejectedValue(new Error('offline'));

      await expect(usePracticePathStore.getState().resync()).resolves.toBeUndefined();
      expect(usePracticePathStore.getState().cursor).toBe(8);
    });

    it('does nothing when signed out', async () => {
      signIn(null);
      await usePracticePathStore.getState().resync();
      expect(mockSync).not.toHaveBeenCalled();
    });
  });

  describe('the upgrade from the un-scoped key', () => {
    it('carries the old local cursor up to the account', async () => {
      // Without this, the fix would *cause* the data loss it exists to
      // prevent: every existing install would push 0 on first launch.
      await AsyncStorage.setItem(LEGACY_KEY, JSON.stringify({ cursor: 34 }));
      mockSync.mockResolvedValue(34);

      await usePracticePathStore.getState().hydrate();

      expect(mockSync).toHaveBeenCalledWith(34);
      expect(usePracticePathStore.getState().cursor).toBe(34);
    });

    it('drops the old key once the account has the number', async () => {
      await AsyncStorage.setItem(LEGACY_KEY, JSON.stringify({ cursor: 34 }));
      await usePracticePathStore.getState().hydrate();
      expect(await AsyncStorage.getItem(LEGACY_KEY)).toBeNull();
    });

    it('keeps the old key when the sync failed', async () => {
      // Deleting it on an offline launch would throw the only copy of the
      // number away before anything else had it.
      await AsyncStorage.setItem(LEGACY_KEY, JSON.stringify({ cursor: 34 }));
      mockSync.mockRejectedValue(new Error('offline'));

      await usePracticePathStore.getState().hydrate();

      expect(await AsyncStorage.getItem(LEGACY_KEY)).not.toBeNull();
    });
  });

  describe('advance', () => {
    it('increments the cursor by one and returns the new value', () => {
      const next = usePracticePathStore.getState().advance();
      expect(next).toBe(1);
      expect(usePracticePathStore.getState().cursor).toBe(1);
    });

    it('caches the advanced cursor under this account', async () => {
      usePracticePathStore.getState().advance();
      await flush();
      expect(await AsyncStorage.getItem(CACHE_KEY)).toBe(JSON.stringify({ cursor: 1 }));
    });

    it('debounces a double-fire within ADVANCE_DEBOUNCE_MS (coalesced to one bump)', () => {
      const first = usePracticePathStore.getState().advance();
      const second = usePracticePathStore.getState().advance(); // same tick
      expect(first).toBe(1);
      expect(second).toBe(1); // not 2 — second call is swallowed
      expect(usePracticePathStore.getState().cursor).toBe(1);
    });

    it('advances again once the debounce window has elapsed', () => {
      usePracticePathStore.getState().advance(); // → 1
      clock += 900; // > 800ms
      const next = usePracticePathStore.getState().advance(); // → 2
      expect(next).toBe(2);
      expect(usePracticePathStore.getState().cursor).toBe(2);
    });
  });

  describe('adopt', () => {
    it('takes the account’s number when it is ahead', () => {
      usePracticePathStore.getState().adopt(34);
      expect(usePracticePathStore.getState().cursor).toBe(34);
    });

    it('ignores a number behind the local one', () => {
      // `/srs/session/complete` answers a device that has already advanced
      // locally, so its reply is routinely equal — and, if a second session
      // raced it, behind.
      usePracticePathStore.getState()._resetTo(34);
      usePracticePathStore.getState().adopt(30);
      expect(usePracticePathStore.getState().cursor).toBe(34);
    });

    it('ignores a missing field from an older server', () => {
      usePracticePathStore.getState()._resetTo(5);
      usePracticePathStore.getState().adopt(undefined);
      expect(usePracticePathStore.getState().cursor).toBe(5);
    });
  });

  describe('_resetTo', () => {
    it('jumps the cursor to an arbitrary index and clears the debounce', () => {
      usePracticePathStore.getState()._resetTo(9);
      expect(usePracticePathStore.getState().cursor).toBe(9);
      // debounce cleared → an immediate advance still works.
      expect(usePracticePathStore.getState().advance()).toBe(10);
    });
  });
});
