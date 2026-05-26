/**
 * practicePathStore — cursor for the v0.7.3 Duolingo-style Practice path.
 *
 * The Practice tab is now a linear, never-ending chain of lesson tiles.
 * `cursor` is the index of the user's next active tile; it increments
 * by one on each completed SRS session (see ReviewScreen). The kind at
 * any index is derived deterministically from a fixed 3-step cycle:
 *
 *   index % 3 === 0  → quick_recall
 *   index % 3 === 1  → tough_words
 *   index % 3 === 2  → movie_deep_dive
 *
 * Note: there's no separate `synonym_round` tile anymore. Synonym MCQs
 * and translation-typing prompts are intermixed *within every session*
 * — the server picks the card type per-card from each row's `srsBox`
 * (box ≥ 3 → MCQ, otherwise type). So a quick_recall session already
 * delivers both formats; carving them into separate tiles was creating
 * artificial monotony per session.
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
import type { SessionKind } from '../services/api';

const KEY = 'practice.path.cursor.v1';
const ADVANCE_DEBOUNCE_MS = 800;

/** The 3-step cycle. Keep in sync with `kindAtIndex` below.
 *  `synonym_round` is intentionally absent — synonym MCQs are blended
 *  into every session at the card-type layer (see `routes/srs.py`). */
export const PRACTICE_KIND_CYCLE: SessionKind[] = [
  'quick_recall',
  'tough_words',
  'movie_deep_dive',
];

export function kindAtIndex(index: number): SessionKind {
  const n = PRACTICE_KIND_CYCLE.length;
  // JS `%` is sign-preserving on negative numbers; the cursor should
  // never be negative but be defensive.
  const i = ((index % n) + n) % n;
  return PRACTICE_KIND_CYCLE[i];
}

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
