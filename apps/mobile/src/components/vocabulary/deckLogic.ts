/**
 * deckLogic — pure state logic for the card-deck view mode on MovieDetail
 * (mockup 2a). No React, no AsyncStorage: everything here is unit-testable.
 *
 * The deck is a rotation over the same filtered/sorted item list the rows
 * render. "Next" wraps around (a word stays in rotation until learned);
 * learned words leave the deck via the parent's item list shrinking, which
 * the reducer reconciles in the 'sync' action.
 */

import { SWIPE_COMMIT_VELOCITY } from '../../utils/swipeDecision';

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

/**
 * …or a flick faster than this commits on its own, however short the drag —
 * without it a quick thumb flick travels ~60pt, falls inside SWIPE_THRESHOLD
 * and springs back, which is what "the card barely responds" was (#110).
 * Deliberately the home feed's constant, not a second number: the same finger
 * movement should commit on a movie row and on a word card alike.
 */
export const SWIPE_VELOCITY_THRESHOLD = SWIPE_COMMIT_VELOCITY;

export type SwipeAction = 'learn' | 'next' | null;

/**
 * Gesture release → action. Toward the leading edge = "I know this", toward
 * the trailing edge = next card. Commits once the card has travelled past
 * `threshold` OR been flicked faster than SWIPE_VELOCITY_THRESHOLD; anything
 * slower and shorter is a no-op (spring back).
 *
 * `dx` and `vx` are both LOGICAL — positive means toward the trailing edge in
 * either reading direction. `vx` is a physical value like `dx`, so the caller
 * multiplies both by `directionSign`; forgetting it on `vx` alone would make
 * an Arabic flick commit the opposite action to an Arabic drag.
 *
 * Direction resolution mirrors swipeActionOnRelease exactly (prefer the drag,
 * fall back to the flick only when the card released at dx 0). A second, more
 * clever tie-break here would recreate the two-answers-to-one-question split
 * this change exists to remove.
 */
export function swipeDecision(
  dx: number,
  vx: number = 0,
  threshold: number = SWIPE_THRESHOLD,
): SwipeAction {
  const committed = Math.abs(dx) >= threshold || Math.abs(vx) > SWIPE_VELOCITY_THRESHOLD;
  if (!committed) return null;
  const dir = dx !== 0 ? dx : vx;
  if (dir === 0) return null;
  return dir > 0 ? 'next' : 'learn';
}

/**
 * The drag must be this many times more horizontal than vertical to claim.
 * 1.0 is "more horizontal than vertical" — a 45° cone, widened from the 34°
 * one at 1.5, which rejected the diagonal arc a real thumb traces. It stops
 * short of the home feed's 0.65 (57°, which accepts drags whose *vertical*
 * travel is the larger of the two) because the deck's mis-claim is the more
 * expensive one: on grant it disables the entire MovieDetail ScrollView
 * (handleDeckDragStateChange) and then refuses termination, so a gesture
 * claimed by mistake freezes the screen's scrolling until the finger lifts.
 */
export const HORIZONTAL_BIAS = 1.0;
/** Minimum horizontal travel before the deck claims the gesture. */
export const CLAIM_DISTANCE = 10;

/**
 * Should a move claim the pan for the card (vs. leaving it to the parent's
 * vertical scroll)? Decisively horizontal drags belong to the deck; vertical
 * and ambiguous diagonal ones stay with the ScrollView.
 */
export function shouldClaimHorizontalDrag(dx: number, dy: number): boolean {
  return Math.abs(dx) > Math.abs(dy) * HORIZONTAL_BIAS && Math.abs(dx) > CLAIM_DISTANCE;
}

// ── Stack geometry ────────────────────────────────────────────────────────

/**
 * Resting transform for each stack slot, front (0) to back. On a commit the
 * incoming card animates from slot 1 (the near-ghost position, Ledger
 * mockup: translateY -9 / scale 0.955) to slot 0, so the arrival reads as
 * the deck stepping one card forward.
 */
export const STACK_SLOTS = [
  { translateY: 0, scale: 1, opacity: 1 },
  { translateY: -9, scale: 0.955, opacity: 0.75 },
  { translateY: -16, scale: 0.92, opacity: 0.55 },
] as const;

export type StackSlot = (typeof STACK_SLOTS)[number];

// ── Deck cursor reducer ───────────────────────────────────────────────────

export interface DeckState {
  /** Item keys (word / idiom phrase) in display order. */
  keys: string[];
  /** Focused card position; -1 when the deck is empty. */
  index: number;
}

export type DeckAction =
  | { type: 'advance' }
  | { type: 'focus'; key: string }
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
    case 'focus': {
      // Undo: bring a previously swiped card back into focus. No-op when the
      // key has since left the deck (e.g. it was marked learned).
      const i = state.keys.indexOf(action.key);
      return i >= 0 && i !== state.index ? { ...state, index: i } : state;
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
 * The cards the deck keeps warm — fetched before anyone taps them — in the
 * order the reader will reach them: the focused card, then the one behind it.
 *
 * Two, not one: warming only the focused card leaves every advance waiting on
 * a request, and warming further ahead buys nothing a reader can reach before
 * the next window is computed. At two, the incoming card after an advance is
 * always already warm, so the steady-state cost is one fetch per advance —
 * exactly what a tap used to cost, moved earlier.
 *
 * Deduped: a one-card deck warms one card, and on the last card of a deck the
 * wrap-around target is the already-warm first card.
 */
export function warmWindowKeys(state: DeckState): string[] {
  if (state.index < 0 || state.keys.length === 0) return [];
  const focused = state.keys[state.index];
  const nextIndex = peekNextIndex(state);
  const next = nextIndex >= 0 ? state.keys[nextIndex] : null;
  return next != null && next !== focused ? [focused, next] : [focused];
}

/** Where the resume bookmark sits on the deck's progress rule. */
export interface ResumeMarker {
  /** 1-based card the reader came back to — what a screen reader says. */
  card: number;
  /** …and where to draw it, as a whole percentage of the track. */
  percent: number;
}

/**
 * The resume mark for a deck, or null when there is nothing to mark.
 *
 * `percent` is deliberately the SAME `card / total` the progress fill is drawn
 * with, rounded the same way: on the card the reader came back to, the mark has
 * to land exactly on the fill's leading edge or it reads as an off-by-one
 * rather than as "here". The card number is returned alongside rather than
 * recovered from the percentage, which after rounding to whole percent no
 * longer identifies a card in a deck of more than a hundred.
 *
 * Null covers all three ways the mark stops meaning anything: no bookmark was
 * stored, the deck is empty, or the bookmarked word is no longer in it (marked
 * learned since, or dropped for having no example sentence). A word that has
 * left the deck must not fall back to position 0 — that would pin the mark to
 * the start of the rule and quietly claim the reader resumed at card 1.
 */
export function resumeMarker(
  keys: string[],
  resumeWord: string | null | undefined,
): ResumeMarker | null {
  if (!resumeWord || keys.length === 0) return null;
  const i = keys.indexOf(resumeWord);
  if (i < 0) return null;
  const card = i + 1;
  return { card, percent: Math.round((card / keys.length) * 100) };
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

// ── Initial view resolution (screen load) ─────────────────────────────────

/** The movie_bookmark_{id} payload as persisted across app versions. */
export interface StoredMovieBookmark {
  word: string | null;
  level: string;
  explicit?: boolean;
  /** Legacy idioms-mode bookmarks stored a difficulty bucket, not CEFR. */
  mode?: string;
}

/** Level tab to open when there is no bookmark: the one with the most words. */
export function pickDefaultLevel(distribution: Record<string, number>): string | null {
  const entries = Object.entries(distribution);
  if (entries.length === 0) return null;
  return entries.reduce((a, b) => (a[1] > b[1] ? a : b))[0];
}

/**
 * Level tab a stored bookmark resolves to. Legacy idioms-mode bookmarks kept
 * a difficulty bucket ("elementary"/…) rather than a CEFR code, so the
 * bookmarked phrase is looked up to find its real CEFR level.
 */
export function resolveBookmarkLevel(
  bookmark: StoredMovieBookmark,
  idioms: { phrase: string; cefr_level?: string | null }[],
): string {
  if (bookmark.mode === 'idioms' && bookmark.word) {
    const found = idioms.find((i) => i.phrase === bookmark.word);
    if (found?.cefr_level) return found.cefr_level.toUpperCase();
  }
  return bookmark.level;
}
