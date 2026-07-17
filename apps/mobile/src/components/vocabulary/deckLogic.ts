/**
 * deckLogic — pure state logic for the card-deck view mode on MovieDetail
 * (mockup 2a). No React, no AsyncStorage: everything here is unit-testable.
 *
 * The deck is a rotation over the same filtered/sorted item list the rows
 * render. "Next" wraps around (a word stays in rotation until learned);
 * learned words leave the deck via the parent's item list shrinking, which
 * the reducer reconciles in the 'sync' action.
 */

// ── View mode ─────────────────────────────────────────────────────────────

export type VocabViewMode = 'rows' | 'cards';

export const VIEW_MODE_KEY = 'vocab_view_mode';

export const DEFAULT_VIEW_MODE: VocabViewMode = 'rows';

/** Parse a persisted view mode; anything unrecognized falls back. */
export function parseViewMode(
  raw: string | null | undefined,
  fallback: VocabViewMode = DEFAULT_VIEW_MODE,
): VocabViewMode {
  return raw === 'rows' || raw === 'cards' ? raw : fallback;
}

// ── Swipe decision ────────────────────────────────────────────────────────

/** Same 90pt threshold as BookmarkRowWrapper's row swipes. */
export const SWIPE_THRESHOLD = 90;

export type SwipeAction = 'learn' | 'next' | null;

/**
 * Gesture release → action. Left past the threshold = "I know this",
 * right = next card. Anything inside the threshold is a no-op (spring back).
 */
export function swipeDecision(dx: number, threshold: number = SWIPE_THRESHOLD): SwipeAction {
  if (dx <= -threshold) return 'learn';
  if (dx >= threshold) return 'next';
  return null;
}

// ── Deck cursor reducer ───────────────────────────────────────────────────

export interface DeckState {
  /** Item keys (word / idiom phrase) in display order. */
  keys: string[];
  /** Focused card position; -1 when the deck is empty. */
  index: number;
}

export type DeckAction =
  | { type: 'advance' }
  | { type: 'sync'; keys: string[] }
  | { type: 'restore'; keys: string[]; bookmarkWord: string | null };

/** Initial state: start from the bookmarked word when present, else card 0. */
export function restoreDeck(keys: string[], bookmarkWord: string | null | undefined): DeckState {
  if (keys.length === 0) return { keys, index: -1 };
  const i = bookmarkWord ? keys.indexOf(bookmarkWord) : -1;
  return { keys, index: i >= 0 ? i : 0 };
}

export function deckReducer(state: DeckState, action: DeckAction): DeckState {
  switch (action.type) {
    case 'advance': {
      if (state.keys.length === 0) return state;
      return { ...state, index: (state.index + 1) % state.keys.length };
    }
    case 'sync': {
      const { keys } = action;
      if (keys.length === 0) return { keys, index: -1 };
      const currentKey = state.index >= 0 ? state.keys[state.index] : undefined;
      const found = currentKey != null ? keys.indexOf(currentKey) : -1;
      if (found >= 0) return { keys, index: found };
      // The focused card left the deck (marked learned): promote whatever now
      // sits at the same position, wrapping to the start past the end.
      const index = state.index > 0 ? state.index % keys.length : 0;
      return { keys, index };
    }
    case 'restore':
      return restoreDeck(action.keys, action.bookmarkWord);
  }
}

/**
 * Position of the card sitting behind the focused one — the advance target.
 * -1 when the deck has nothing behind (empty or a single card).
 */
export function peekNextIndex(state: DeckState): number {
  if (state.index < 0 || state.keys.length <= 1) return -1;
  return (state.index + 1) % state.keys.length;
}

/**
 * The card that gets focus after `removedKey` is marked learned — used to
 * write the implicit resume bookmark before the parent's item list catches up.
 */
export function promotedKeyAfterRemoval(state: DeckState, removedKey: string): string | null {
  const rest = state.keys.filter((k) => k !== removedKey);
  if (rest.length === 0) return null;
  const index = state.index > 0 ? state.index % rest.length : 0;
  return rest[index];
}
