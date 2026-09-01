/**
 * screeningStore — a film's Screening Mode progress, persisted to
 * AsyncStorage so a quit, a backgrounded app or an empty energy meter (#168)
 * mid-scene resumes where it stopped. The scene logic itself is pure and
 * lives in components/vocabulary/screeningLogic.ts; this store holds the
 * state that logic runs over and keeps it on disk.
 *
 * Mirrors reviewSessionStore — hydrate / resumable / start / update / clear,
 * best-effort writes, malformed data reads as nothing — including its 24h
 * staleness rule, applied to the SCENE IN FLIGHT rather than to the film.
 * Film-level state never expires: which scene is next, the Missed set, what
 * has been tested, what was swiped "I know this". "A scene must never be
 * lost" (the plan) means a paused scene resumes at its beat within a day;
 * after a day it restarts from its first card — the cards are out of working
 * memory by then, so re-reading them before the test is the right thing, and
 * nothing the reader earned is gone.
 *
 * Keyed by movie_id with one storage key per film, so a reader mid-scene in
 * two films resumes each on its own, and opening a film loads only its own
 * record.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requeue, type TestQuestion } from '../components/vocabulary/screeningLogic';

// Bump the version suffix whenever ScreeningProgress gains a required field —
// old records are then read as nothing and the film starts over.
const KEY_PREFIX = 'screening.progress.v1.';
// A scene in flight older than this restarts from its first card (see above).
const STALE_MS = 24 * 60 * 60 * 1000;

export interface ScreeningProgress {
  movieId: number;
  /**
   * The deck the scenes were cut from when the lesson began — the keys of
   * MovieDetailScreen's sentence-filtered `deckItems`, in reading order.
   * Scene boundaries come from `partitionScenes(keys.length)`, so they stay
   * put for the life of the lesson even as `known` thins a scene out.
   */
  keys: string[];
  /** Index of the scene in progress, over `partitionScenes(keys.length)`. */
  scene: number;
  /** Cursor within the scene: an index into `beatsForScene(...)`. */
  beat: number;
  /**
   * The test queue while the test beat is up — questions still to be
   * answered right, head first. Null outside a test; empty once every
   * question has been answered right and the runner can advance the beat.
   */
  queue: TestQuestion[] | null;
  /** Keys answered wrong in any test in this film, oldest miss first. */
  missed: string[];
  /** Keys answered right at least once in a test. */
  tested: string[];
  /** Keys swiped "I know this" — out of every remaining scene and test. */
  known: string[];
  savedAt: number;
}

export type ScreeningPatch = Partial<Omit<ScreeningProgress, 'movieId' | 'savedAt'>>;

interface ScreeningState {
  /**
   * Per film: its progress, or null once hydrated with nothing stored. A film
   * absent from the map has not been hydrated yet.
   */
  byMovie: Record<number, ScreeningProgress | null>;
  hydrate: (movieId: number) => Promise<void>;
  isHydrated: (movieId: number) => boolean;
  /**
   * The film's progress to resume from, with the 24h rule applied on the
   * side: a stale in-flight scene is restarted (and written back) before it
   * is returned. Null when nothing is stored.
   */
  resumable: (movieId: number) => ScreeningProgress | null;
  /** Replace the film's progress (a lesson just began). */
  start: (p: Omit<ScreeningProgress, 'savedAt'>) => void;
  /** Merge a patch into the film's progress and re-stamp it. */
  update: (movieId: number, patch: ScreeningPatch) => void;
  /**
   * Answer the head of the test queue. Right drops it and records it as
   * tested; wrong sends it to the back (`requeue`) and records the miss, so
   * the test is not over until every question has been answered right once.
   */
  answer: (movieId: number, correct: boolean) => void;
  /** "I know this": the word leaves the scene and any pending test. */
  markKnown: (movieId: number, key: string) => void;
  /** Wipe the film's progress in memory and on disk. */
  clear: (movieId: number) => void;
}

const storageKey = (movieId: number) => `${KEY_PREFIX}${movieId}`;

/** A scene is in flight once the reader has moved off its first card or is mid-test. */
export function isSceneInFlight(p: ScreeningProgress): boolean {
  return p.beat > 0 || p.queue != null;
}

function isStale(p: ScreeningProgress, now: number): boolean {
  return now - p.savedAt > STALE_MS;
}

/** The stale rule: the in-flight scene restarts at its first card; the film keeps its progress. */
function restartScene(p: ScreeningProgress, now: number): ScreeningProgress {
  return { ...p, beat: 0, queue: null, savedAt: now };
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(x => typeof x === 'string');

async function readPersisted(movieId: number): Promise<ScreeningProgress | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(movieId));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<ScreeningProgress>;
    if (
      p.movieId !== movieId ||
      !isStringArray(p.keys) ||
      typeof p.scene !== 'number' ||
      typeof p.beat !== 'number' ||
      typeof p.savedAt !== 'number'
    ) {
      return null;
    }
    return {
      movieId,
      keys: p.keys,
      scene: p.scene,
      beat: p.beat,
      queue: Array.isArray(p.queue) ? (p.queue as TestQuestion[]) : null,
      missed: isStringArray(p.missed) ? p.missed : [],
      tested: isStringArray(p.tested) ? p.tested : [],
      known: isStringArray(p.known) ? p.known : [],
      savedAt: p.savedAt,
    };
  } catch {
    return null;
  }
}

async function writePersisted(movieId: number, p: ScreeningProgress | null): Promise<void> {
  try {
    if (p == null) await AsyncStorage.removeItem(storageKey(movieId));
    else await AsyncStorage.setItem(storageKey(movieId), JSON.stringify(p));
  } catch {
    /* best-effort */
  }
}

export const useScreeningStore = create<ScreeningState>((set, get) => {
  const commit = (movieId: number, p: ScreeningProgress | null) => {
    void writePersisted(movieId, p);
    set(s => ({ byMovie: { ...s.byMovie, [movieId]: p } }));
  };

  return {
    byMovie: {},

    hydrate: async movieId => {
      const persisted = await readPersisted(movieId);
      if (persisted && isSceneInFlight(persisted) && isStale(persisted, Date.now())) {
        commit(movieId, restartScene(persisted, Date.now()));
        return;
      }
      set(s => ({ byMovie: { ...s.byMovie, [movieId]: persisted } }));
    },

    isHydrated: movieId => movieId in get().byMovie,

    resumable: movieId => {
      const p = get().byMovie[movieId];
      if (!p) return null;
      if (isSceneInFlight(p) && isStale(p, Date.now())) {
        const restarted = restartScene(p, Date.now());
        commit(movieId, restarted);
        return restarted;
      }
      return p;
    },

    start: p => commit(p.movieId, { ...p, savedAt: Date.now() }),

    update: (movieId, patch) => {
      const p = get().byMovie[movieId];
      if (!p) return;
      commit(movieId, { ...p, ...patch, movieId, savedAt: Date.now() });
    },

    answer: (movieId, correct) => {
      const p = get().byMovie[movieId];
      if (!p || !p.queue || p.queue.length === 0) return;
      const head = p.queue[0];
      if (correct) {
        commit(movieId, {
          ...p,
          queue: p.queue.slice(1),
          tested: p.tested.includes(head.key) ? p.tested : [...p.tested, head.key],
          savedAt: Date.now(),
        });
      } else {
        commit(movieId, {
          ...p,
          queue: requeue(p.queue, 0),
          missed: p.missed.includes(head.key) ? p.missed : [...p.missed, head.key],
          savedAt: Date.now(),
        });
      }
    },

    markKnown: (movieId, key) => {
      const p = get().byMovie[movieId];
      if (!p || p.known.includes(key)) return;
      commit(movieId, {
        ...p,
        known: [...p.known, key],
        queue: p.queue ? p.queue.filter(q => q.key !== key) : null,
        savedAt: Date.now(),
      });
    },

    clear: movieId => commit(movieId, null),
  };
});
