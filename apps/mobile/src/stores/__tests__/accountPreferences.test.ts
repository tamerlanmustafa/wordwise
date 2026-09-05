/**
 * Three preferences that used to be properties of the phone.
 *
 * From the 2026-09-04 storage audit. Each of these was written to
 * AsyncStorage and nowhere else, so it diverged per install:
 *
 *   • onboarding completion — a reinstall, or a second device, replayed the
 *     entire first-run flow including the placement quiz;
 *   • the Explore CEFR mix — a setting the user deliberately dialled in, held
 *     separately on each phone;
 *   • the translation language — `users.learning_language` already existed,
 *     the picker simply never wrote to it.
 *
 * What is worth pinning is not "it calls the API" but the *direction* of the
 * merge. Every one of these has a state where the local copy and the account
 * copy disagree, and in every case the answer has to be the one that cannot
 * lose the user's progress or setting — never simply "whatever arrived last".
 */

jest.mock('../../services/api', () => ({
  srsApi: { feed: jest.fn().mockResolvedValue({ items: [], has_more: false }) },
  wordwiseApi: { saveWord: jest.fn(), logInteraction: jest.fn() },
  authApi: { updateProfile: jest.fn() },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

import { authApi } from '../../services/api';
import { useAuthStore } from '../authStore';
import { useOnboardingStore } from '../onboardingStore';
import { useWordFeedStore } from '../wordFeedStore';

const mockPatch = authApi.updateProfile as jest.Mock;
const flush = () => new Promise<void>((r) => setImmediate(r));

const BALANCED = { A1: 10, A2: 10, B1: 30, B2: 30, C1: 10, C2: 10 };

beforeEach(async () => {
  await AsyncStorage.clear();
  mockPatch.mockReset();
  mockPatch.mockResolvedValue({ id: 1, email: 'a@b.c' });
  useAuthStore.setState({ user: { id: 1 } as never, status: 'authenticated' });
  useWordFeedStore.getState().reset();
});

// ---------------------------------------------------------------------------
// 1. Onboarding
// ---------------------------------------------------------------------------

describe('onboarding completion', () => {
  it('is written to the account when the flow finishes', async () => {
    await useOnboardingStore
      .getState()
      .complete({ targetLanguage: 'ES', startingLevel: 'B1', dailyGoalMinutes: 10 });

    expect(mockPatch).toHaveBeenCalledWith({ onboarding_completed: true });
  });

  it('still completes locally when the account write fails', async () => {
    // Onboarding ends on the last tap, not on a round trip. A user who
    // finished the flow offline must not be dropped back into it.
    mockPatch.mockRejectedValue(new Error('offline'));

    await useOnboardingStore
      .getState()
      .complete({ targetLanguage: 'ES', startingLevel: 'B1', dailyGoalMinutes: 10 });

    expect(useOnboardingStore.getState().completed).toBe(true);
  });

  it('keeps the local flag out of the account’s way', async () => {
    // The merge in App.tsx is `local || account`, so this store never needs to
    // read the server — but it must also never write `false`, which is what a
    // fresh install would otherwise report.
    mockPatch.mockResolvedValue({ id: 1 });

    await useOnboardingStore
      .getState()
      .complete({ targetLanguage: 'ES', startingLevel: 'B1', dailyGoalMinutes: 10 });

    for (const [payload] of mockPatch.mock.calls) {
      expect(payload.onboarding_completed).not.toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The Explore level mix
// ---------------------------------------------------------------------------

describe('the Explore level mix', () => {
  it('prefers the account’s mix over this device’s cache', async () => {
    // The point of the change. A phone that has never opened the panel holds
    // the default; the account holds what the user actually chose.
    await AsyncStorage.setItem(
      'feedLevelMix',
      JSON.stringify({ A1: 100, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 }),
    );

    await useWordFeedStore.getState().hydrate('B1', 'ES', BALANCED);

    expect(useWordFeedStore.getState().mix).toEqual(BALANCED);
  });

  it('falls back to the device cache when the account has none', async () => {
    const local = { A1: 0, A2: 0, B1: 100, B2: 0, C1: 0, C2: 0 };
    await AsyncStorage.setItem('feedLevelMix', JSON.stringify(local));

    await useWordFeedStore.getState().hydrate('B1', 'ES', null);

    expect(useWordFeedStore.getState().mix).toEqual(local);
  });

  it('ignores an account mix that does not total 100', async () => {
    // The server validates on write, but an older row could hold anything and
    // the feed refuses an unbalanced mix — which would show as an Explore tab
    // that is simply empty, with nothing to explain it.
    await useWordFeedStore.getState().hydrate('B1', 'ES', { A1: 10, A2: 10 } as never);

    const mix = useWordFeedStore.getState().mix;
    expect(Object.values(mix).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('pushes a changed mix up to the account', async () => {
    await useWordFeedStore.getState().setMix(BALANCED);
    await flush();

    expect(mockPatch).toHaveBeenCalledWith({ feed_level_mix: BALANCED });
  });

  it('still applies the mix locally when the account write fails', async () => {
    mockPatch.mockRejectedValue(new Error('offline'));

    await useWordFeedStore.getState().setMix(BALANCED);
    await flush();

    expect(useWordFeedStore.getState().mix).toEqual(BALANCED);
    expect(await AsyncStorage.getItem('feedLevelMix')).toBe(JSON.stringify(BALANCED));
  });

  it('does not push a mix the panel never legally produced', async () => {
    // setMix rejects an unbalanced mix before it touches storage or the
    // network — the panel's half-assigned states are legal on screen and
    // illegal as a feed request.
    await useWordFeedStore.getState().setMix({ A1: 50, A2: 10 } as never);
    await flush();

    expect(mockPatch).not.toHaveBeenCalled();
  });
});
