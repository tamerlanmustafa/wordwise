/**
 * screeningLogic — pure state logic for Screening Mode (#164): the movie
 * deck as a paced lesson with an END. No React, no AsyncStorage: everything
 * here is unit-testable.
 *
 * deckLogic.ts is a rotation — "next" wraps, a word stays in rotation until
 * learned — so a lesson built on it has nothing to finish on. This module is
 * a SECOND traversal over the same item list: linear, cut into scenes, each
 * scene ending in a test whose wrong answers come back until they are right.
 * The browsing rotation is untouched for readers who are not in a lesson.
 *
 * Every count here is derived from the item list the caller passes in — on
 * MovieDetailScreen that is the sentence-filtered `deckItems` (its
 * `deckTotal`), never the suggested-words cap. 60 is not 60: a film whose
 * words missed the sentence bank yields 41 cards, or 12, and sizing scenes
 * from the cap would cut empty scenes on exactly the thin films a young
 * language is made of.
 */

// ── Scene shape (product decisions on #161, 2026-09-01) ───────────────────

/**
 * Cards per scene. Six, not Duolingo's eight: a shorter sitting and more
 * completion moments per film. The plan's beat counts (8 cards → 15 beats,
 * 6 → 12) both decode the same way — cards, one spot check, then a test of
 * half the cards plus RESURFACE_COUNT — which is what the helpers below
 * encode, so changing this constant keeps the shape.
 */
export const SCENE_SIZE = 6;

/** Questions per scene test that bring back words from before this scene. */
export const RESURFACE_COUNT = 2;

/**
 * Cards of this scene tested fresh: half, rounded up, so a scene never tests
 * fewer than half the words the reader just studied. Half of six is three.
 */
export function freshTestCount(cardCount: number): number {
  return Math.ceil(Math.max(0, cardCount) / 2);
}

/**
 * The spot check lands after this many cards — the midpoint, rounded down so
 * at least one card always follows it (a check with nothing after it is the
 * test, one beat early). A one-card scene has no spot check.
 */
export function spotCheckAfter(cardCount: number): number {
  return Math.floor(Math.max(0, cardCount) / 2);
}

// ── Partitioning ──────────────────────────────────────────────────────────

/** A contiguous run of the deck: items `start` up to, but excluding, `end`. */
export interface Scene {
  index: number;
  start: number;
  end: number;
}

/**
 * Cut `total` items into scenes of `sceneSize`. The LAST scene absorbs the
 * remainder rather than being short — a two-card scene is not worth a test —
 * so scenes run from `sceneSize` up to `2 * sceneSize - 1` cards. Below one
 * full scene the whole deck is one scene of whatever exists, so a thin film
 * still gets a lesson; an empty deck gets no scenes at all.
 */
export function partitionScenes(total: number, sceneSize: number = SCENE_SIZE): Scene[] {
  const size = Math.max(1, Math.floor(sceneSize));
  const n = Number.isFinite(total) ? Math.floor(total) : 0;
  if (n <= 0) return [];
  const count = Math.max(1, Math.floor(n / size));
  const scenes: Scene[] = [];
  for (let i = 0; i < count; i++) {
    scenes.push({ index: i, start: i * size, end: i === count - 1 ? n : (i + 1) * size });
  }
  return scenes;
}

// ── Beats ─────────────────────────────────────────────────────────────────

export type Beat =
  | { kind: 'card'; key: string }
  /** One question over the cards read so far — a working-memory check. */
  | { kind: 'spot_check'; from: string[] }
  /** The scene test; expands into the queue pickTestWords composes. */
  | { kind: 'test' };

/**
 * The ordered beats of one scene: its cards with the spot check after the
 * midpoint card, then the test. The test is ONE beat here and expands to
 * `freshTestCount + RESURFACE_COUNT` questions, so a six-card scene is
 * 6 + 1 + 5 = 12 beats counted the way #161 counts them.
 *
 * `cardKeys` is the scene's cards in reading order with "I know this" swipes
 * already removed — a card the reader dismissed leaves the scene and its
 * tests. An empty scene has no beats.
 */
export function beatsForScene(cardKeys: readonly string[]): Beat[] {
  if (cardKeys.length === 0) return [];
  const after = spotCheckAfter(cardKeys.length);
  const beats: Beat[] = [];
  cardKeys.forEach((key, i) => {
    beats.push({ kind: 'card', key });
    if (after > 0 && i === after - 1) {
      beats.push({ kind: 'spot_check', from: cardKeys.slice(0, after) });
    }
  });
  beats.push({ kind: 'test' });
  return beats;
}

/** Stable identity of a beat, for the linear cursor's sync. */
export function beatKey(beat: Beat): string {
  return beat.kind === 'card' ? `card:${beat.key}` : beat.kind;
}

// ── Test composition ──────────────────────────────────────────────────────

/** What the test picker needs to know about a card. Idioms have no rank. */
export interface ScreeningItem {
  key: string;
  rank: number | null;
}

export type QuestionSource = 'scene' | 'missed' | 'earlier';

export interface TestQuestion {
  key: string;
  source: QuestionSource;
}

/**
 * Rarest first — a higher frequency rank is a rarer word, and the rare ones
 * are what the reader came to a film for. Unranked items (idioms) go last in
 * their original order, matching MovieDetailScreen's sort. Stable on ties.
 */
export function rarestFirst<T extends ScreeningItem>(items: readonly T[]): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const ar = a.item.rank;
      const br = b.item.rank;
      if (ar == null && br == null) return a.i - b.i;
      if (ar == null) return 1;
      if (br == null) return -1;
      return br - ar || a.i - b.i;
    })
    .map((x) => x.item);
}

/**
 * The questions of a scene test, in asking order:
 *
 * 1. `freshTestCount` of this scene's cards, rarest first.
 * 2. `RESURFACE_COUNT` brought back from before: the film's missed words
 *    first, oldest miss first, then earlier scenes' cards no test has reached
 *    yet, rarest first. This is the "bring back what you failed" loop.
 * 3. When there is nothing to bring back — the first scene, a clean run —
 *    those slots are filled from the rest of this scene instead, so a test is
 *    the same length whichever scene it is (energy prices it per question).
 *
 * A word is asked once per test: the fresh picks are excluded from the
 * resurfaced pool, so a word missed on this scene's spot check comes back
 * either way, but never twice. `missed` and `earlier` may overlap freely.
 */
export function pickTestWords(
  scene: readonly ScreeningItem[],
  missed: readonly string[],
  earlier: readonly ScreeningItem[],
  alreadyTested: Iterable<string>,
): TestQuestion[] {
  if (scene.length === 0) return [];
  const fresh = freshTestCount(scene.length);
  const size = fresh + RESURFACE_COUNT;
  const ordered = rarestFirst(scene);
  const taken = new Set<string>();
  const out: TestQuestion[] = [];
  const push = (key: string, source: QuestionSource) => {
    if (out.length >= size || taken.has(key)) return;
    taken.add(key);
    out.push({ key, source });
  };

  ordered.slice(0, fresh).forEach((item) => push(item.key, 'scene'));

  const resurfaceCap = out.length + RESURFACE_COUNT;
  for (const key of missed) {
    if (out.length >= resurfaceCap) break;
    push(key, 'missed');
  }
  const tested = new Set(alreadyTested);
  for (const item of rarestFirst(earlier)) {
    if (out.length >= resurfaceCap) break;
    if (!tested.has(item.key)) push(item.key, 'earlier');
  }

  ordered.forEach((item) => push(item.key, 'scene'));
  return out;
}

/**
 * A wrong answer goes to the BACK of the current test — the scene is not
 * over until every question has been answered right once. Duolingo's single
 * most valuable rule: it makes a mistake an obligation, not a punishment.
 * An out-of-range index, or a question already at the back, returns the
 * queue as is (same reference); the input is never mutated.
 */
export function requeue<T>(queue: T[], wrongIndex: number): T[] {
  if (wrongIndex < 0 || wrongIndex >= queue.length - 1) return queue;
  return [...queue.slice(0, wrongIndex), ...queue.slice(wrongIndex + 1), queue[wrongIndex]];
}

// ── Linear cursor ─────────────────────────────────────────────────────────

/**
 * A cursor over a fixed sequence of keys (a scene's beats) that ENDS — the
 * counterpart of deckLogic's DeckState, whose advance wraps. `index` is the
 * focused position; past the last key the cursor is `exhausted`, `index`
 * sits at `keys.length`, `currentKey` is null and nothing advances further.
 */
export interface LinearCursor {
  keys: string[];
  index: number;
  exhausted: boolean;
}

export type LinearAction =
  | { type: 'advance' }
  /** The keys changed under the cursor (a card was swiped "I know this"). */
  | { type: 'sync'; keys: string[] }
  | { type: 'restart'; keys: string[] };

/** A cursor at `index` (clamped) — 0 for a fresh scene, a stored beat on resume. */
export function startLinear(keys: string[], index: number = 0): LinearCursor {
  const i = Math.min(Math.max(0, Math.floor(index)), keys.length);
  return { keys, index: i, exhausted: i >= keys.length };
}

export function linearReducer(state: LinearCursor, action: LinearAction): LinearCursor {
  switch (action.type) {
    case 'advance': {
      if (state.exhausted) return state;
      const index = state.index + 1;
      return { ...state, index, exhausted: index >= state.keys.length };
    }
    case 'sync': {
      const { keys } = action;
      if (state.exhausted) return { keys, index: keys.length, exhausted: true };
      const current = state.keys[state.index];
      const found = current != null ? keys.indexOf(current) : -1;
      if (found >= 0) return { keys, index: found, exhausted: false };
      // The focused key left (its card was dismissed): promote whatever now
      // sits at the same position. Past the end there is nothing to promote —
      // the sequence ended under the cursor, and it says so rather than wrap.
      const index = Math.min(state.index, keys.length);
      return { keys, index, exhausted: index >= keys.length };
    }
    case 'restart':
      return startLinear(action.keys);
  }
}

/** The focused key, or null once the cursor is exhausted. */
export function currentKey(state: LinearCursor): string | null {
  return state.exhausted ? null : (state.keys[state.index] ?? null);
}

/** Positions passed and the total, for a "3 / 8"-style header. */
export function linearProgress(state: LinearCursor): { done: number; total: number } {
  return { done: state.exhausted ? state.keys.length : state.index, total: state.keys.length };
}
