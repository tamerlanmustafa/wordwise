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
 * Persisted to AsyncStorage so a relaunch lands the user on the same
 * active tile. There is no day-rollover here — the path is a counter,
 * not a daily reset. (The separate `dailyGoalStore` continues to handle
 * the per-day habit + streak math.)
 *
 * Bump is idempotent against double-fire from a single completion: the
 * store guards against advances that happen within ADVANCE_DEBOUNCE_MS
 * of each other, since ReviewScreen's completion handler can re-render
 * before its in-flight `srsApi.completeSession` settles.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'practice.path.cursor.v1';
const ADVANCE_DEBOUNCE_MS = 800;

interface PracticePathState {
  cursor: number;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** Advance the cursor by one. Returns the new cursor value. Repeat
   *  calls within {@link ADVANCE_DEBOUNCE_MS} are coalesced into a
   *  single bump — the second caller gets the same new value back. */
  advance: () => number;
  /** Test-only — reset to a specific cursor. Not exported in product code. */
  _resetTo: (n: number) => void;
}

interface PersistShape {
  cursor: number;
}

async function loadPersisted(): Promise<PersistShape | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistShape>;
    if (typeof parsed.cursor !== 'number' || parsed.cursor < 0) return null;
    return { cursor: Math.floor(parsed.cursor) };
  } catch {
    return null;
  }
}

async function save(s: PersistShape): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* best-effort */
  }
}

let lastAdvanceAt = 0;

export const usePracticePathStore = create<PracticePathState>((set, get) => ({
  cursor: 0,
  hydrated: false,

  hydrate: async () => {
    const persisted = await loadPersisted();
    set({
      cursor: persisted?.cursor ?? 0,
      hydrated: true,
    });
  },

  advance: () => {
    const now = Date.now();
    if (now - lastAdvanceAt < ADVANCE_DEBOUNCE_MS) {
      return get().cursor;
    }
    lastAdvanceAt = now;
    const next = get().cursor + 1;
    void save({ cursor: next });
    set({ cursor: next });
    return next;
  },

  _resetTo: (n: number) => {
    lastAdvanceAt = 0;
    void save({ cursor: n });
    set({ cursor: n });
  },
}));
