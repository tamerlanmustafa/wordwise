/**
 * The streak snapshot store: loaded at launch, kept per account, never
 * allowed to overwrite a live answer.
 *
 * The teardown half matters as much as the load. The snapshot is the last
 * account's streak; if sign-out left it in memory, the next person to sign in
 * on this phone would open Practice to someone else's 41.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { DailyState } from '../../services/api';
import { resetAccountState } from '../../services/accountState';
import { useStreakSnapshotStore } from '../streakSnapshotStore';

const state = (streak: number): DailyState => ({
  today_done: false,
  streak,
  longest_streak: streak,
  freezes_held: 2,
  last_session_date: null,
  repair_window_active: false,
  auto_granted_weekly: false,
  auto_consumed: 0,
  unlocked_cosmetics: [],
});

const store = () => useStreakSnapshotStore.getState();

beforeEach(async () => {
  await AsyncStorage.clear();
  store().reset();
});

describe('remember', () => {
  it('holds the answer with the local day it described', () => {
    store().remember(state(41), new Date(2026, 8, 14, 9, 0));
    expect(store().snapshot).toEqual({ state: state(41), fetchedOn: '2026-09-14' });
  });

  it('persists it, so the next cold start can open on it', async () => {
    store().remember(state(41), new Date(2026, 8, 14, 9, 0));
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    store().reset();
    await store().hydrate();
    expect(store().snapshot?.state.streak).toBe(41);
  });
});

describe('hydrate', () => {
  it('is a no-op when nothing was ever stored', async () => {
    await store().hydrate();
    expect(store().snapshot).toBeNull();
    expect(store().hydrated).toBe(true);
  });

  it('never replaces a live answer that landed during the disk read', async () => {
    // Disk holds an old 30; a fresh 41 arrives before the read resolves.
    store().remember(state(30), new Date(2026, 8, 13));
    await new Promise((r) => setTimeout(r, 0));
    store().reset();
    const reading = store().hydrate();
    store().remember(state(41), new Date(2026, 8, 14));
    await reading;
    expect(store().snapshot?.state.streak).toBe(41);
  });

  it('ignores a stored value that is not a snapshot', async () => {
    await AsyncStorage.setItem('swr_practice.streakSnapshot.v1', JSON.stringify({ at: Date.now(), data: { nope: 1 } }));
    await store().hydrate();
    expect(store().snapshot).toBeNull();
  });
});

describe('sign-out', () => {
  it('forgets the snapshot in memory AND on disk', async () => {
    store().remember(state(41), new Date(2026, 8, 14));
    await new Promise((r) => setTimeout(r, 0));
    await resetAccountState();
    expect(store().snapshot).toBeNull();

    await store().hydrate();
    // Nothing on disk for the next account to inherit.
    expect(store().snapshot).toBeNull();
  });
});
