/**
 * deckLogic — pure state logic for the card-deck view mode on MovieDetail
 * (mockup 2a). No React, no AsyncStorage: everything here is unit-testable.
 *
 * The deck is a rotation over the same filtered/sorted item list the rows
 * render, and every card stays in it. Both commits — "Next" and "Knew it" —
 * advance and wrap; "Knew it" additionally records a marker, which is a label
 * on the card rather than a reason to remove it. (It used to remove: the
 * parent filtered marked words out of its item list, so a reader could swipe
 * a film's deck down to nothing with no way to put a card back.)
 *
 * The item list can still shrink for reasons of its own — a level tab change,
 * a word whose example sentence never arrives — and the 'sync' action is what
 * reconciles the cursor when it does.
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

// ── Reading the card behind ───────────────────────────────────────────────

/**
 * How far the finger must travel before the card behind starts showing its
 * face. Not zero: a resting deck is a stack of blank paper on purpose, and a
 * ghost that carried type would compete with the card in front of it. This is
 * past the point where a stray touch becomes a drag, so the reveal reads as an
 * answer to the gesture rather than as noise under a fingertip.
 */
export const BEHIND_REVEAL_START = 8;
/**
 * …and where it is fully legible. Deliberately well inside SWIPE_THRESHOLD
 * (90): the reader is choosing whether to commit somewhere around the
 * threshold, and the point of showing the next card is to inform that choice.
 * Arriving at the same moment as the commit would be a reveal nobody had time
 * to read.
 */
export const BEHIND_REVEAL_FULL = 56;

/**
 * Interpolation ramp for the behind-card's opacity, as a function of the
 * LOGICAL drag offset — symmetric, because both commits ("Next" toward the
 * trailing edge, "Knew it" toward the leading one) advance to the same card,
 * so both deserve the same preview.
 *
 * Returned as ranges rather than as a `(dx) => opacity` function because the
 * caller feeds it to `Animated.Value.interpolate`, which must own the
 * evaluation to stay on the native driver — a JS function called per frame
 * would drag the whole card back onto the JS thread mid-gesture.
 *
 * `clamp` is the drag's own limit (DRAG_CLAMP): the ranges have to cover the
 * full travel or the interpolation would extrapolate past its last stop.
 */
export function behindRevealRamp(clamp: number): {
  inputRange: number[];
  outputRange: number[];
} {
  return {
    inputRange: [
      -clamp,
      -BEHIND_REVEAL_FULL,
      -BEHIND_REVEAL_START,
      BEHIND_REVEAL_START,
      BEHIND_REVEAL_FULL,
      clamp,
    ],
    outputRange: [1, 1, 0, 0, 1, 1],
  };
}

// ── What the deck is allowed to contain ───────────────────────────────────

/**
 * Single words, never phrases — and the first `cap` WORDS, not the words
 * among the first `cap` items.
 *
 * A film's vocabulary arrives as words plus idioms and phrasal verbs, and the
 * deck used to shuffle them together. Two things went wrong with that.
 *
 * The visible one: idioms are not batched for example sentences (they carry
 * their own), so `hasRenderableSentence` lets every one of them through while
 * a word whose sentence the generator never produced is dropped. On a level
 * where SentenceBank is thin the words fall away and the idioms do not, and
 * the deck ends up being nothing but phrasal verbs — which is what a reader
 * switching to a level tab actually saw.
 *
 * The quiet one: mixed into the top 60, every idiom took a slot a word could
 * have had. Counting the cap in words is what makes "60 cards" mean 60 words.
 *
 * Cheaper than filter-then-slice, and that is not the reason for the loop —
 * the reason is that the cap has to be applied AFTER the filter to mean
 * anything, and writing it as one pass makes that impossible to get backwards.
 */
export function deckWordsOnly<T extends { word: string } | { phrase: string }>(
  items: readonly T[],
  cap?: number,
): Exclude<T, { phrase: string }>[] {
  type Word = Exclude<T, { phrase: string }>;
  const words: Word[] = [];
  for (const item of items) {
    if ('phrase' in item) continue;
    words.push(item as Word);
    if (cap != null && words.length >= cap) break;
  }
  return words;
}

// ── How many cards, and which ─────────────────────────────────────────────

/**
 * How many cards a deck aims to hold.
 *
 * A target, not a cap, and the difference is the whole point. The old code
 * capped the candidate list at 60 and *then* dropped every word whose example
 * sentence came back missing, so the deck was 60 minus however many misses the
 * film happened to have — and it shrank live, in front of the reader, as the
 * batch responses landed. "CARD 3 / 60" became "CARD 3 / 42" a second later.
 *
 * A film's vocabulary at one level runs to hundreds of words, so there is
 * always more where those came from. Taking 60 USABLE words instead of the
 * first 60 words costs nothing and holds the number still.
 */
export const DECK_TARGET_CARDS = 60;

/** The CEFR ladder, easiest first. One copy, so "the level above" is one idea. */
export const CEFR_LADDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

/**
 * How much of the deck may come from above the reader's level.
 *
 * The deck exists so a learner can follow a film's subtitles, and what stops
 * them is the words above their level — so the stretch band leads. It is a
 * CEILING rather than a quota, because the supply is a screenwriter's
 * vocabulary and not ours to promise: measured across 300 scripts, a strict
 * 70% stretch quota is satisfiable by 83% of films at B1, 18% at B2 and 1% at
 * C1. As a ceiling it binds only where there is a surplus — which is exactly
 * where the old rarest-first sort was over-reaching, at ~80% — and above B2 the
 * supply constrains it first and the mix degrades on its own.
 */
export const DECK_STRETCH_SHARE = 0.7;
export const DECK_STRETCH_CAP = Math.round(DECK_TARGET_CARDS * DECK_STRETCH_SHARE);

/**
 * Stretch words more common than this are skipped.
 *
 * The per-script CEFR classifier is noisy at the easy end: it puts `make`,
 * `say` and `run` in B2, and a B1 reader does not need a card for "make". A
 * floor on general frequency is a cheap, level-independent way to drop them —
 * anything this common is either already known or misclassified, and both are
 * wasted cards.
 *
 * Only the stretch band needs it. The own-level and fallback bands are ordered
 * rarest-first, so their common words sort to the bottom and are never reached.
 */
export const DECK_STRETCH_RANK_FLOOR = 500;

/** Anything the deck orders by general word frequency. Higher rank = rarer. */
export interface RankedWord {
  word: string;
  frequency_rank?: number | null;
}

/** Unranked words sort last in both directions — an unknown is not a signal. */
const rankOf = (item: RankedWord) => item.frequency_rank ?? null;

/**
 * Rarest first — the ordering for words AT or BELOW the reader's level.
 *
 * At their own level the common words are the ones they already know, so the
 * rare tail is where the genuine gaps are.
 */
export function rarestFirst<T extends RankedWord>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const ar = rankOf(a);
    const br = rankOf(b);
    if (ar == null) return br == null ? 0 : 1;
    if (br == null) return -1;
    return br - ar;
  });
}

/**
 * Most common first — the ordering for words ABOVE it.
 *
 * The opposite direction, deliberately, and the reason is the goal: a stretch
 * word is worth a card if the reader will meet it again, and the rarest words
 * in a band are the ones they will not. Sorting a band by maximum rarity also
 * selects for whatever is wrong with the data, because junk is rare by
 * construction — measured on a real film, rarest-first B2 for a B1 reader
 * opened with `psst, twig, bod, prudence, tamara, sitter, fragrant, whew`:
 * two proper nouns, two interjections and a hapax. Common-first on the same
 * band gives `petition, patch, nest, advisor, fury, persistent, obsession`.
 */
export function mostCommonFirst<T extends RankedWord>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const ar = rankOf(a);
    const br = rankOf(b);
    if (ar == null) return br == null ? 0 : 1;
    if (br == null) return -1;
    return ar - br;
  });
}

/**
 * The stretch band's candidates, in the order it wants them: level+1 first and
 * exhausted before level+2 is touched, each most-common-first, each with the
 * floor applied.
 *
 * Concatenated rather than merged and re-sorted, because the two levels are not
 * interchangeable — a B1 reader should meet every worthwhile B2 word before
 * being handed a C1 one, even though the C1 word may be the more common of the
 * two.
 */
export function stretchBand<T extends RankedWord>(
  levels: readonly (readonly T[])[],
  floor: number = DECK_STRETCH_RANK_FLOOR,
): T[] {
  return levels.flatMap((level) =>
    mostCommonFirst(level.filter((w) => (w.frequency_rank ?? -1) >= floor)),
  );
}

export interface DeckPlan<T> {
  /** The cards to show — `target` of them whenever the pool can supply it. */
  cards: T[];
  /**
   * The pool prefix that had to be examined to fill them, cards and rejects
   * alike. This is what the sentence batch must cover: a card can only be
   * judged usable once the backend has answered for it, so the answer has to
   * be asked for. Fetching only `cards` would leave every replacement word
   * permanently unknown, and therefore permanently optimistic.
   */
  scanned: T[];
}

export interface DeckBand<T> {
  /** Candidates, already in the order this band wants them taken. */
  items: readonly T[];
  /**
   * Most cards this band may contribute on the first pass, or undefined for
   * "as many as it takes". A cap is a ceiling and never a floor: a band that
   * cannot reach it simply contributes less, and the bands after it fill in.
   */
  cap?: number;
}

/**
 * Fill `target` cards from an ordered list of bands.
 *
 * Two passes. The first respects every cap, which is what makes the mix a
 * choice rather than an accident of what the film happens to contain. The
 * second runs only if the deck is still short and ignores the caps entirely —
 * a ceiling is there to stop one band crowding out the others, and once the
 * others are exhausted it has nothing left to protect. Better a deck that is
 * 90% stretch words than a deck of 34 cards.
 *
 * `usable` is asked about a word rather than handed the whole preview map, so
 * this stays a pure function of its arguments — the caller owns what "usable"
 * means (today: the backend has not told us the word has no example sentence).
 *
 * Optimism is deliberate: a word nobody has heard back about yet counts as
 * usable, so the deck is full from the first frame and only ever *replaces*
 * entries as answers arrive. The alternative — admitting a word only once it is
 * confirmed good — would start every deck at zero cards and fill it in
 * visibly, which is the same flicker in the other direction.
 */
export function planDeck<T extends { word: string }>(
  bands: readonly DeckBand<T>[],
  usable: (word: string) => boolean,
  target: number = DECK_TARGET_CARDS,
): DeckPlan<T> {
  const cards: T[] = [];
  const scanned: T[] = [];
  const taken = new Set<string>();
  const seen = new Set<string>();

  const pull = (band: DeckBand<T>, cap: number | undefined) => {
    let fromBand = 0;
    for (const item of band.items) {
      if (cards.length >= target) return;
      if (cap != null && fromBand >= cap) return;
      if (taken.has(item.word)) continue;
      // `seen` is per-word, not per-visit: the relaxed pass walks the same
      // bands again, and a rejected word counted twice would ask the sentence
      // batch for it twice.
      if (!seen.has(item.word)) {
        seen.add(item.word);
        scanned.push(item);
      }
      if (usable(item.word)) {
        cards.push(item);
        taken.add(item.word);
        fromBand += 1;
      }
    }
  };

  for (const band of bands) pull(band, band.cap);
  if (cards.length < target) for (const band of bands) pull(band, undefined);

  return { cards, scanned };
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
      // key has since left the deck (a level change, or a word dropped for
      // having no example sentence).
      const i = state.keys.indexOf(action.key);
      return i >= 0 && i !== state.index ? { ...state, index: i } : state;
    }
    case 'sync': {
      const { keys } = action;
      if (keys.length === 0) return { keys, index: -1 };
      const currentKey = state.index >= 0 ? state.keys[state.index] : undefined;
      const found = currentKey != null ? keys.indexOf(currentKey) : -1;
      if (found >= 0) return { keys, index: found };
      // The focused card left the deck: promote whatever now sits at the same
      // position, wrapping to the start past the end.
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
 * stored, the deck is empty, or the bookmarked word is no longer in it (dropped
 * for having no example sentence, or gone with a level change). A word that has
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
