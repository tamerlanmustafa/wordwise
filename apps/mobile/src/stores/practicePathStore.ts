/**
 * practicePathStore — cursor for the Practice tab's lesson path.
 *
 * The Practice tab is a linear, never-ending chain of lesson tiles.
 * `cursor` is the index of the user's next active tile; it increments
 * by one on each completed SRS session (see ReviewScreen).
 *
 * Every tile is the same kind of lesson. The path used to rotate three
 * kinds — quick_recall, tough_words, movie_deep_dive — so what you were
 * quizzed on depended on where the cursor happened to land, and one tile
 * in three made you pick a film first. A vocabulary quiz should be about
 * vocabulary, so the server composes one deck (`practice`) that mixes due
 * recalls, your saved words and fresh words at your level. The cursor is
 * now purely progress: which lesson number you are on.
 *
 * ## Where the number actually lives (2026-09-04)
 *
 * It used to live *only* in AsyncStorage, which is per install and not per
 * account — so it was never a property of the user at all. The same login
 * showed lesson 34 on iOS and lesson 8 on Android: two counters that had
 * never met. Reinstalling reset it to lesson 1 for the same reason.
 *
 * `users.practice_lessons_completed` is the account's copy now, and this
 * store is a cache in front of it:
 *
 *   • hydrate paints instantly from the cache, then reconciles with
 *     `POST /srs/practice-progress`, which merges with GREATEST — so the
 *     device that is ahead defines the account and the one behind is pulled
 *     forward. Neither ever loses a lesson.
 *   • advance bumps locally for an instant tile animation; the server does
 *     its own increment inside `/srs/session/complete`, and the client
 *     adopts that reply.
 *
 * Every write here goes through {@link raise}: the cursor is monotonic, so
 * nothing — a stale response, an older server that omits the field, a cache
 * from before a sync — can ever move a user backwards down the path.
 *
 * The cache key is scoped by user id, and hydration re-runs when the signed-in
 * account changes. Both were global, which meant a second account signing in
 * on the same phone inherited the first one's lesson number; harmless while
 * the number was local, but it would now be pushed to the server and merged
 * in permanently.
 *
 * Bump is idempotent against double-fire from a single completion: the
 * store guards against advances that happen within ADVANCE_DEBOUNCE_MS
 * of each other, since ReviewScreen's completion handler can re-render
 * before its in-flight `srsApi.completeSession` settles.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from './authStore';
import { srsApi } from '../services/api';

/** The old, un-scoped cache. Read once on first launch after the upgrade so
 *  the user's existing lesson number reaches the server, then deleted — its
 *  value belongs to whoever last used this phone, and leaving it around would
 *  let a second account adopt it. */
const LEGACY_KEY = 'practice.path.cursor.v1';
const CACHE_PREFIX = 'practice.path.cursor.v2:';
const ADVANCE_DEBOUNCE_MS = 800;

const cacheKey = (userId: number) => `${CACHE_PREFIX}${userId}`;

interface PracticePathState {
  cursor: number;
  hydrated: boolean;
  /** Paint from the local cache, then reconcile with the account. Safe to
   *  call when signed out — it just reads the cache and stops. */
  hydrate: () => Promise<void>;
  /** Re-run the merge against the account, without touching the caches.
   *  Called when the Practice tab becomes visible, so the phone that was
   *  behind catches up on a tab switch rather than on an app restart. */
  resync: () => Promise<void>;
  /** Advance the cursor by one. Returns the new cursor value. Repeat
   *  calls within {@link ADVANCE_DEBOUNCE_MS} are coalesced into a
   *  single bump — the second caller gets the same new value back. */
  advance: () => number;
  /** Take the account's number, when it is ahead of ours. Never lowers the
   *  cursor: an older server sends nothing, and a response can arrive after
   *  a session the device has already counted. */
  adopt: (lessonsCompleted: number | undefined | null) => void;
  /** Test-only — reset to a specific cursor. Not exported in product code. */
  _resetTo: (n: number) => void;
}

async function readNumber(key: string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { cursor?: unknown };
    if (typeof parsed.cursor !== 'number' || parsed.cursor < 0) return null;
    return Math.floor(parsed.cursor);
  } catch {
    return null;
  }
}

async function writeCache(userId: number, cursor: number): Promise<void> {
  try {
    await AsyncStorage.setItem(cacheKey(userId), JSON.stringify({ cursor }));
  } catch {
    /* best-effort */
  }
}

function currentUserId(): number | null {
  const id = useAuthStore.getState().user?.id;
  return typeof id === 'number' ? id : null;
}

let lastAdvanceAt = 0;
/** Which account the in-memory cursor belongs to. `undefined` = never
 *  hydrated. Tracked because the store outlives a sign-out: without it, a
 *  second account signing in during the same app session would keep the first
 *  one's cursor on screen and then push it up to their account. */
let hydratedFor: number | null | undefined;

export const usePracticePathStore = create<PracticePathState>((set, get) => {
  /** The only writer. Monotonic by construction. */
  const raise = (next: number) => {
    if (!Number.isFinite(next) || next <= get().cursor) return get().cursor;
    const value = Math.floor(next);
    set({ cursor: value });
    const userId = currentUserId();
    if (userId !== null) void writeCache(userId, value);
    return value;
  };

  /** Push what we have, take back what the account has. Reports whether it
   *  actually reached the server, which is what decides if the legacy cache
   *  is safe to delete. */
  const reconcile = async (): Promise<boolean> => {
    if (currentUserId() === null) return false;
    try {
      raise(await srsApi.syncPracticeProgress(get().cursor));
      return true;
    } catch {
      // Offline, or an older server. The local number stands and the next
      // launch tries again — GREATEST makes the retry free.
      return false;
    }
  };

  return {
    cursor: 0,
    hydrated: false,

    hydrate: async () => {
      const userId = currentUserId();
      if (hydratedFor === userId) return;
      hydratedFor = userId;
      // A different account starts from nothing rather than inheriting the
      // number on screen.
      set({ cursor: 0, hydrated: false });

      const legacy = await readNumber(LEGACY_KEY);
      const cached = userId !== null ? await readNumber(cacheKey(userId)) : null;

      // Paint first. The tile path is the whole screen, and waiting on the
      // network to draw it would give every cold start a visible empty state
      // for a number we already know.
      set({ cursor: Math.max(legacy ?? 0, cached ?? 0), hydrated: true });

      if (userId === null) return;

      // Only once the account has a copy: an offline launch must not throw
      // away the only place the number is written down.
      if (await reconcile()) {
        if (legacy !== null) await AsyncStorage.removeItem(LEGACY_KEY);
      }
    },

    resync: async () => {
      await reconcile();
    },

    advance: () => {
      const now = Date.now();
      if (now - lastAdvanceAt < ADVANCE_DEBOUNCE_MS) {
        return get().cursor;
      }
      lastAdvanceAt = now;
      return raise(get().cursor + 1);
    },

    adopt: (lessonsCompleted) => {
      if (typeof lessonsCompleted !== 'number') return;
      raise(lessonsCompleted);
    },

    _resetTo: (n: number) => {
      lastAdvanceAt = 0;
      hydratedFor = undefined;
      const userId = currentUserId();
      if (userId !== null) void writeCache(userId, n);
      set({ cursor: n });
    },
  };
});
