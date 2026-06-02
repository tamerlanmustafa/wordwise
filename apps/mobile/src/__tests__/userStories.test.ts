/**
 * Cross-store user-story regression tests.
 *
 * These stitch multiple stores + (mocked) services together to assert the
 * end-to-end contract a real screen relies on, without rendering any UI. Each
 * `it` reads as a single user story; the inline orchestrator functions mirror
 * the side-effect sequencing the corresponding screen performs (e.g.
 * ReviewScreen's completion handler, the home → reel add).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

// Partially mock the API: keep the real SrsPaywallError + types, stub the
// network-touching method objects the stores/flows call.
jest.mock('../services/api', () => {
  const actual = jest.requireActual('../services/api');
  return {
    ...actual,
    reelApi: { list: jest.fn(), seed: jest.fn(), add: jest.fn(), remove: jest.fn() },
    srsApi: { startSession: jest.fn(), review: jest.fn(), completeSession: jest.fn() },
  };
});

import { srsApi, reelApi, SrsPaywallError, type SrsReviewCard, type SessionKind } from '../services/api';
import { useDailyGoalStore } from '../stores/dailyGoalStore';
import { usePracticePathStore, kindAtIndex } from '../stores/practicePathStore';
import { useReviewSessionStore } from '../stores/reviewSessionStore';
import { useMilestoneTrackerStore } from '../stores/milestoneTrackerStore';
import { useReelStore } from '../stores/reelStore';
import { useReelBadgeStore } from '../stores/reelBadgeStore';
import { useFlightStore } from '../stores/flightStore';

// Microtask flush — fake timers are active in this file, so setImmediate is
// faked; the AsyncStorage mock resolves on microtasks, which still run.
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const card = (id: number): SrsReviewCard =>
  ({
    user_word_id: id,
    word: `w${id}`,
    movie_id: null,
    movie_title: null,
    srs_box: 1,
    srs_due_at: '2026-06-02T00:00:00Z',
    definition: null,
    example_sentence: null,
    cefr_level: null,
  } as SrsReviewCard);

/** Mirrors ReviewScreen's "last card answered" handler: finalize the session,
 *  detect newly-unlocked cosmetics, advance the daily habit + practice path,
 *  and clear the resumable cache. */
async function completeReviewSession() {
  const cached = useReviewSessionStore.getState().cached!;
  const completion = await srsApi.completeSession(cached.got, cached.totalCards);
  const fresh = useMilestoneTrackerStore.getState().newSince(completion.unlocked_cosmetics);
  const daily = useDailyGoalStore.getState().bump();
  const cursor = usePracticePathStore.getState().advance();
  useReviewSessionStore.getState().clear();
  await useMilestoneTrackerStore.getState().markSeen(fresh);
  return { daily, cursor, newCosmetics: fresh, streak: completion.streak };
}

describe('user stories (cross-store integration)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 5, 2, 12, 0, 0)); // 2026-06-02 noon local

    useDailyGoalStore.setState({ date: '2026-06-02', done: 0, streak: 0, lastHitDate: null, hydrated: true });
    usePracticePathStore.getState()._resetTo(0);
    useReviewSessionStore.setState({ cached: null, hydrated: true });
    useMilestoneTrackerStore.setState({ seen: new Set(), hydrated: true });
    useReelStore.getState().reset();
    useReelBadgeStore.setState({ count: 0 });
    useFlightStore.setState({ pending: null, reelTabRect: null });
  });

  afterEach(() => jest.useRealTimers());

  it('Story: completing my first daily review fires the goal, advances the path, and unlocks a milestone', async () => {
    (srsApi.completeSession as jest.Mock).mockResolvedValue({
      chest: { kind: 'xp_small', label: '+10 XP', payload: { xp: 10 } },
      already_claimed: false,
      correct_count: 1,
      total_count: 2,
      streak: 1,
      unlocked_cosmetics: ['opening_weekend'],
    });

    // Play through a 2-card deck (one right, one wrong).
    useReviewSessionStore.getState().start({
      kind: 'quick_recall',
      movieId: null,
      remaining: [card(1), card(2)],
      got: 0,
      forgot: 0,
      totalCards: 2,
    });
    useReviewSessionStore.getState().consume(true);
    useReviewSessionStore.getState().consume(false);

    const out = await completeReviewSession();

    expect(srsApi.completeSession).toHaveBeenCalledWith(1, 2);
    expect(out.daily).toEqual({ done: 1, streak: 1, justHitGoal: true });
    expect(out.cursor).toBe(1); // path advanced 0 → 1
    expect(out.newCosmetics).toEqual(['opening_weekend']);
    expect(useReviewSessionStore.getState().cached).toBeNull(); // resumable cache cleared
    expect(useMilestoneTrackerStore.getState().seen.has('opening_weekend')).toBe(true);
  });

  it('Story: a milestone already celebrated is NOT re-celebrated on the next session', async () => {
    await useMilestoneTrackerStore.getState().markSeen(['opening_weekend']);
    (srsApi.completeSession as jest.Mock).mockResolvedValue({
      chest: null,
      already_claimed: false,
      correct_count: 2,
      total_count: 2,
      streak: 2,
      unlocked_cosmetics: ['opening_weekend'], // same one, already seen
    });

    useReviewSessionStore.getState().start({
      kind: 'tough_words',
      movieId: null,
      remaining: [card(1)],
      got: 1,
      forgot: 0,
      totalCards: 1,
    });

    const out = await completeReviewSession();
    expect(out.newCosmetics).toEqual([]); // nothing new to celebrate
  });

  it('Story: I background the app mid-session and resume the exact same deck', async () => {
    useReviewSessionStore.getState().start({
      kind: 'movie_deep_dive',
      movieId: 777,
      remaining: [card(1), card(2), card(3)],
      got: 0,
      forgot: 0,
      totalCards: 3,
    });
    useReviewSessionStore.getState().consume(true); // answered card 1
    await flush();

    // Simulate a cold relaunch: in-memory state gone, rehydrate from disk.
    useReviewSessionStore.setState({ cached: null, hydrated: false });
    await useReviewSessionStore.getState().hydrate();

    const resumable = useReviewSessionStore.getState().resumable('movie_deep_dive', 777);
    expect(resumable).not.toBeNull();
    expect(resumable!.remaining.map((c) => c.user_word_id)).toEqual([2, 3]);
    expect(resumable!.got).toBe(1);
    // Opening a *different* tile must not resume this deck.
    expect(useReviewSessionStore.getState().resumable('quick_recall')).toBeNull();
  });

  it('Story: a free user who hit the daily cap is paywalled and the habit state is untouched', async () => {
    (srsApi.startSession as jest.Mock).mockRejectedValue(
      new SrsPaywallError('Come back tomorrow', 1, 1, 'daily_cap_reached'),
    );

    // Mirrors the screen guard: try to start; on paywall, route away WITHOUT
    // mutating streak/cursor.
    let paywall: SrsPaywallError | null = null;
    try {
      await srsApi.startSession({ kind: 'quick_recall' });
    } catch (e) {
      if (e instanceof SrsPaywallError) paywall = e;
    }

    expect(paywall?.kind).toBe('daily_cap_reached');
    expect(useDailyGoalStore.getState().done).toBe(0); // no bump
    expect(usePracticePathStore.getState().cursor).toBe(0); // no advance
  });

  it('Story: adding a movie from the home feed updates reel + badge + flight overlay', async () => {
    (reelApi.add as jest.Mock).mockResolvedValue({
      tmdb_id: 603,
      title: 'The Matrix',
      poster_path: '/matrix.jpg',
      year: 1999,
      source: 'user',
    });
    (reelApi.list as jest.Mock).mockResolvedValue({
      tiles: [{ tmdb_id: 603, title: 'The Matrix', poster_path: '/matrix.jpg', year: 1999, source: 'user' }],
      has_more: false,
    });

    // The chip's tap handler: optimistic add + badge bump + launch the poster flight.
    const addPromise = useReelStore.getState().add({
      tmdb_id: 603,
      title: 'The Matrix',
      poster_path: '/matrix.jpg',
      year: 1999,
    });
    useReelBadgeStore.getState().bump();
    useFlightStore.getState().fly({ posterPath: '/matrix.jpg', from: { x: 10, y: 20, width: 80, height: 120 } });

    expect(useReelStore.getState().has(603)).toBe(true); // optimistic, instant
    expect(useReelBadgeStore.getState().count).toBe(1);
    expect(useFlightStore.getState().pending?.posterPath).toBe('/matrix.jpg');

    await addPromise;
    expect(reelApi.add).toHaveBeenCalledTimes(1);
    expect(useReelStore.getState().tiles.map((t) => t.tmdb_id)).toEqual([603]);

    // The overlay finishes animating and clears the pending flight.
    useFlightStore.getState().consume();
    expect(useFlightStore.getState().pending).toBeNull();
  });

  it('Story: undoing an accidental add rolls the reel + badge back', async () => {
    (reelApi.add as jest.Mock).mockResolvedValue({ tmdb_id: 1, title: 'X', poster_path: null, year: null, source: 'user' });
    (reelApi.list as jest.Mock).mockResolvedValue({
      tiles: [{ tmdb_id: 1, title: 'X', poster_path: null, year: null, source: 'user' }],
      has_more: false,
    });
    (reelApi.remove as jest.Mock).mockResolvedValue(undefined);

    await useReelStore.getState().add({ tmdb_id: 1, title: 'X', poster_path: null, year: null });
    useReelBadgeStore.getState().bump();

    // User taps the chip again to undo.
    (reelApi.list as jest.Mock).mockResolvedValue({ tiles: [], has_more: false });
    await useReelStore.getState().remove(1);
    useReelBadgeStore.getState().unbump();

    expect(useReelStore.getState().has(1)).toBe(false);
    expect(useReelBadgeStore.getState().count).toBe(0);
  });

  it('Story: three perfect days build a streak of 3, then a skipped day resets it to 1', async () => {
    // Day 1
    expect(useDailyGoalStore.getState().bump().streak).toBe(1);
    // Day 2
    jest.setSystemTime(new Date(2026, 5, 3, 12, 0, 0));
    expect(useDailyGoalStore.getState().bump().streak).toBe(2);
    // Day 3
    jest.setSystemTime(new Date(2026, 5, 4, 12, 0, 0));
    expect(useDailyGoalStore.getState().bump().streak).toBe(3);
    // Skip day 5 (the 5th), come back day 6 → streak resets.
    jest.setSystemTime(new Date(2026, 5, 6, 12, 0, 0));
    expect(useDailyGoalStore.getState().bump().streak).toBe(1);
  });

  it('Story: the practice path keeps cycling kinds as the user completes sessions', () => {
    // cursor 0 → quick_recall, 1 → tough_words, 2 → movie_deep_dive, 3 → quick_recall ...
    const kinds: SessionKind[] = [];
    for (let i = 0; i < 4; i += 1) {
      kinds.push(kindAtIndex(usePracticePathStore.getState().cursor));
      jest.advanceTimersByTime(1000); // clear the advance debounce between sessions
      usePracticePathStore.getState().advance();
    }
    expect(kinds).toEqual(['quick_recall', 'tough_words', 'movie_deep_dive', 'quick_recall']);
  });
});
