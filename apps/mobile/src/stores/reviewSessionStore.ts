/**
 * reviewSessionStore — caches an in-flight SRS session to AsyncStorage
 * so the user can quit / background the app mid-session and pick up
 * where they left off without losing their 10-card deck.
 *
 * Per-card `srsApi.review()` calls are already fire-and-forget against
 * the server, so individual word state is never lost. What this store
 * preserves is the *session shape* — the same deck, the same index,
 * the same running stats — so the user finishes the same 10 cards they
 * started instead of getting a fresh draw on every reopen.
 *
 * The cache is keyed by `kind` plus, for the Lists tab's kinds, the
 * `listId` — so quitting a Practice session and opening a list's deck next
 * won't try to resume the wrong one. Sessions older than `STALE_MS` (24 h)
 * are silently discarded — beyond a day the SRS schedule has moved on and
 * the cached deck is no longer relevant.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SessionKind, SrsReviewCard } from '../services/api';

// Bump the version suffix whenever ReviewCard's wire-shape gains a
// required field — old cached sessions get silently ignored so the
// client falls through to a fresh /srs/session/start. v2: card-level
// example_sentence wiring (was missing on v1-cached sessions).
const KEY = 'srs.reviewSession.v2';
// Discard a cached session older than this — beyond a day the SRS
// schedule has moved on, the box bumps that fired locally are stale,
// and a fresh queue is almost certainly more useful.
const STALE_MS = 24 * 60 * 60 * 1000;

interface CachedSession {
  kind: SessionKind;
  /** The list this deck came from, for the two Lists-tab kinds. Null for
   *  `practice`, which has exactly one deck. */
  scopeId: number | null;
  /** Cards not yet answered. First entry is the next card to show. */
  remaining: SrsReviewCard[];
  /** Cumulative running totals across the WHOLE session (resumed +
   *  fresh portions). Used to give /srs/session/complete the right
   *  numerator when the session finally ends. */
  got: number;
  forgot: number;
  totalCards: number;
  savedAt: number;
}

interface ReviewSessionState {
  cached: CachedSession | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** Return the cached session if (a) it matches `kind` + `scopeId`,
   *  (b) is younger than STALE_MS, and (c) still has remaining cards.
   *  Otherwise returns null and clears the cache on the side. */
  resumable: (kind: SessionKind, scopeId?: number) => CachedSession | null;
  /** Replace the cache (e.g. just started a fresh session). */
  start: (s: Omit<CachedSession, 'savedAt'>) => void;
  /** Drop the head card and adjust running stats. */
  consume: (correct: boolean) => void;
  /** Wipe the cache — called on session-complete or when we detect a
   *  stale entry. */
  clear: () => void;
}

function sameTile(c: CachedSession, kind: SessionKind, scopeId?: number): boolean {
  if (c.kind !== kind) return false;
  // The list kinds can each have many decks — one per list — so the id has to
  // match too. `practice` has exactly one deck, so the kind alone settles it.
  if (kind === 'list_words' || kind === 'list_films') {
    return (c.scopeId ?? null) === (scopeId ?? null);
  }
  return true;
}

async function readPersisted(): Promise<CachedSession | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedSession>;
    if (
      typeof parsed.kind !== 'string' ||
      !Array.isArray(parsed.remaining) ||
      typeof parsed.totalCards !== 'number' ||
      typeof parsed.savedAt !== 'number'
    ) {
      return null;
    }
    return {
      kind: parsed.kind as SessionKind,
      scopeId: typeof parsed.scopeId === 'number' ? parsed.scopeId : null,
      remaining: parsed.remaining as SrsReviewCard[],
      got: typeof parsed.got === 'number' ? parsed.got : 0,
      forgot: typeof parsed.forgot === 'number' ? parsed.forgot : 0,
      totalCards: parsed.totalCards,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

async function writePersisted(s: CachedSession | null): Promise<void> {
  try {
    if (s == null) await AsyncStorage.removeItem(KEY);
    else await AsyncStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* best-effort */
  }
}

export const useReviewSessionStore = create<ReviewSessionState>((set, get) => ({
  cached: null,
  hydrated: false,

  hydrate: async () => {
    const persisted = await readPersisted();
    if (!persisted) {
      set({ cached: null, hydrated: true });
      return;
    }
    if (Date.now() - persisted.savedAt > STALE_MS) {
      void writePersisted(null);
      set({ cached: null, hydrated: true });
      return;
    }
    set({ cached: persisted, hydrated: true });
  },

  resumable: (kind, scopeId) => {
    const c = get().cached;
    if (!c) return null;
    if (Date.now() - c.savedAt > STALE_MS) {
      void writePersisted(null);
      set({ cached: null });
      return null;
    }
    if (!sameTile(c, kind, scopeId)) return null;
    if (c.remaining.length === 0) return null;
    return c;
  },

  start: (s) => {
    const next: CachedSession = { ...s, savedAt: Date.now() };
    void writePersisted(next);
    set({ cached: next });
  },

  consume: (correct) => {
    const c = get().cached;
    if (!c || c.remaining.length === 0) return;
    const next: CachedSession = {
      ...c,
      remaining: c.remaining.slice(1),
      got: c.got + (correct ? 1 : 0),
      forgot: c.forgot + (correct ? 0 : 1),
      savedAt: Date.now(),
    };
    void writePersisted(next);
    set({ cached: next });
  },

  clear: () => {
    void writePersisted(null);
    set({ cached: null });
  },
}));
