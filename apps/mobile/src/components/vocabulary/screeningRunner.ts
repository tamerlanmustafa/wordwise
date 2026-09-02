/**
 * screeningRunner — the decisions ScreeningScene makes, with no React in
 * them (#165). screeningLogic.ts owns the shape of a scene (how a deck cuts
 * into scenes, which words a test asks, where a wrong answer goes);
 * screeningStore.ts owns the progress on disk. This module is the join: it
 * reads a stored ScreeningProgress against the deck that is on screen right
 * now and answers the three questions the runner asks every beat —
 *
 *   1. which beats is this scene, and where in them are we (`resolveScene`)
 *   2. which words does the beat in front of us ask (`wordsForBeat`)
 *   3. what queue do the server's cards make (`queueFromCards`)
 *
 * Keeping it here is what lets the whole scene — cards, spot check, test,
 * requeue, resume — be driven in a jest test with no render library, which
 * is the house rule for apps/mobile.
 */

import {
  beatKey,
  beatsForScene,
  partitionScenes,
  pickTestWords,
  rarestFirst,
  type Beat,
  type Scene,
  type ScreeningItem,
  type TestQuestion,
} from './screeningLogic';
import type { ScreeningProgress } from '../../stores/screeningStore';

/** The deck as the runner needs it: a key, and the rank that orders a test. */
export interface RunnerItem extends ScreeningItem {
  /** The word to ask the server for. Same as `key` for words; an idiom's
   *  phrase, which the lesson composer will simply fail to card. */
  word: string;
}

/** Everything about the scene in flight, derived — nothing here is stored. */
export interface ResolvedScene {
  /** Scene boundaries over the frozen `progress.keys`. */
  scenes: Scene[];
  /** The scene in flight, or null when `progress.scene` is past the last. */
  scene: Scene | null;
  /** Its cards, in reading order, minus "I know this" and minus anything
   *  that has since left the deck. */
  cards: RunnerItem[];
  /** Its beats, and their stable keys for the linear cursor. */
  beats: Beat[];
  beatKeys: string[];
  /** The focused beat, or null once the scene's beats are exhausted. */
  beat: Beat | null;
  /** True when every scene of the film is behind us. */
  filmComplete: boolean;
}

/**
 * Index a deck by key so the runner can look a stored key back up. Case is
 * preserved — these are the deck's own keys — but the map also answers on a
 * lowercased key, because the lesson endpoint lowercases every word it is
 * given and echoes that back on the card.
 */
export function indexItems(items: readonly RunnerItem[]): Map<string, RunnerItem> {
  const map = new Map<string, RunnerItem>();
  for (const item of items) {
    map.set(item.key, item);
    const lower = item.key.toLowerCase();
    if (!map.has(lower)) map.set(lower, item);
  }
  return map;
}

/** Keys of `progress` that are still on screen and not swiped away. */
function liveKeys(
  keys: readonly string[],
  known: readonly string[],
  byKey: Map<string, RunnerItem>,
): RunnerItem[] {
  const dismissed = new Set(known);
  const out: RunnerItem[] = [];
  for (const key of keys) {
    if (dismissed.has(key)) continue;
    const item = byKey.get(key);
    // A key with no item left (level switch, marked learned elsewhere) is
    // gone from the lesson too — it can neither be shown nor asked about.
    if (item) out.push(item);
  }
  return out;
}

/**
 * The scene in flight. `progress.keys` is frozen at lesson start, so the
 * scene BOUNDARIES never move even as `known` thins a scene out — what
 * changes is how many cards are left inside them, which is exactly what
 * `beatsForScene` re-derives here (a six-card scene swiped down to four
 * tests two fresh words, not three).
 */
export function resolveScene(
  progress: ScreeningProgress,
  byKey: Map<string, RunnerItem>,
): ResolvedScene {
  const scenes = partitionScenes(progress.keys.length);
  const scene = scenes[progress.scene] ?? null;
  const filmComplete = scenes.length > 0 && progress.scene >= scenes.length;
  if (!scene) {
    return { scenes, scene: null, cards: [], beats: [], beatKeys: [], beat: null, filmComplete };
  }
  const cards = liveKeys(progress.keys.slice(scene.start, scene.end), progress.known, byKey);
  const beats = beatsForScene(cards.map(c => c.key));
  return {
    scenes,
    scene,
    cards,
    beats,
    beatKeys: beats.map(beatKey),
    beat: beats[progress.beat] ?? null,
    filmComplete,
  };
}

/** Cards of scenes BEFORE the one in flight — the resurfacing pool. */
export function earlierCards(
  progress: ScreeningProgress,
  resolved: ResolvedScene,
  byKey: Map<string, RunnerItem>,
): RunnerItem[] {
  if (!resolved.scene) return [];
  return liveKeys(progress.keys.slice(0, resolved.scene.start), progress.known, byKey);
}

/**
 * The words a beat asks about, in asking order, tagged with where each came
 * from so the runner can persist a queue that survives a quit.
 *
 * A `spot_check` is ONE question over the cards just read — the rarest of
 * them, the same "you came for the rare ones" rule the scene test opens
 * with. A `test` is `pickTestWords`. A `card` beat asks nothing.
 */
export function wordsForBeat(
  beat: Beat | null,
  progress: ScreeningProgress,
  resolved: ResolvedScene,
  byKey: Map<string, RunnerItem>,
): TestQuestion[] {
  if (!beat) return [];
  if (beat.kind === 'card') return [];
  if (beat.kind === 'spot_check') {
    const dismissed = new Set(progress.known);
    const pool = beat.from
      .filter(key => !dismissed.has(key))
      .map(key => byKey.get(key))
      .filter((item): item is RunnerItem => item != null);
    const pick = rarestFirst(pool)[0];
    return pick ? [{ key: pick.key, source: 'scene' }] : [];
  }
  return pickTestWords(
    resolved.cards,
    progress.missed,
    earlierCards(progress, resolved, byKey),
    progress.tested,
  );
}

/** Minimum the runner needs of a server card to queue it. */
export interface LessonCard {
  word: string;
}

/**
 * Keep only the questions the server actually carded, in the order asked,
 * and hand back the card for each.
 *
 * The lesson endpoint drops any word it cannot build a translation MCQ for
 * — a cold language, an idiom, a lemma with no translation cached — so a
 * five-question test can come back as three, and asking a question with no
 * card would hang the scene on a beat that can never be answered. Matching
 * is case-insensitive because the composer lowercases every word it is
 * given, and one card per word: a duplicate in the response is ignored
 * rather than allowed to ask the same word twice.
 */
export function queueFromCards<C extends LessonCard>(
  questions: readonly TestQuestion[],
  cards: readonly C[],
): { queue: TestQuestion[]; byKey: Map<string, C> } {
  const cardsByWord = new Map<string, C>();
  for (const card of cards) {
    const word = card.word.toLowerCase();
    if (!cardsByWord.has(word)) cardsByWord.set(word, card);
  }
  const queue: TestQuestion[] = [];
  const byKey = new Map<string, C>();
  for (const question of questions) {
    const card = cardsByWord.get(question.key.toLowerCase());
    if (!card || byKey.has(question.key)) continue;
    byKey.set(question.key, card);
    queue.push(question);
  }
  return { queue, byKey };
}

/**
 * What a question beat still needs, as one value instead of a chain of
 * conditions spread across a React effect.
 *
 *   compose   — no queue yet: pick the words and ask the lesson endpoint.
 *   rehydrate — a queue restored from disk with no cards behind it (a resume,
 *               or a scene the app was killed in the middle of): ask again for
 *               exactly the words still owed.
 *   ready     — queue and cards both present; render the head.
 *   empty     — every question has been answered right; the beat is finished.
 *
 * Pulled out here because the effect that acts on it must NOT depend on its
 * own in-flight flag: setting a loading flag inside an effect that lists it
 * re-runs the effect and cancels the fetch it just started. Stating the
 * decision as data keeps that flag out of the condition entirely, and makes
 * the state machine something a test can drive.
 */
export type QuestionBeatNeed = 'not-a-question' | 'compose' | 'rehydrate' | 'ready' | 'empty';

export function questionBeatNeed(
  beat: Beat | null,
  queue: readonly TestQuestion[] | null,
  cardCount: number,
): QuestionBeatNeed {
  if (!beat || beat.kind === 'card') return 'not-a-question';
  if (queue == null) return 'compose';
  if (queue.length === 0) return 'empty';
  return cardCount > 0 ? 'ready' : 'rehydrate';
}

/**
 * Where the linear cursor should sit for a card the deck just focused.
 * -1 when that card is not a beat of this scene (it was swiped away between
 * the deck's commit and this render), which the caller reads as "leave the
 * cursor where it is" rather than as a jump to beat 0.
 */
export function beatIndexForCard(beatKeys: readonly string[], word: string): number {
  return beatKeys.indexOf(`card:${word}`);
}

/**
 * The beat that ENDS the run of cards `from` sits in: the spot check or the
 * test the run falls through to. Past the end it returns `beats.length`,
 * which the linear cursor reads as exhausted.
 */
export function beatAfterCardRun(beats: readonly Beat[], from: number): number {
  for (let i = Math.max(0, from); i < beats.length; i++) {
    if (beats[i].kind !== 'card') return i;
  }
  return beats.length;
}

/**
 * The first beat of the run of cards `from` sits in. The pair with
 * `beatAfterCardRun` is what lets the study deck be mounted per RUN rather
 * than per card: the reader swipes through three cards as a deck, with its
 * stack, its undo and its animation intact, and the runner only takes over
 * again at the question the run ends on.
 */
export function cardRunStart(beats: readonly Beat[], from: number): number {
  let i = Math.min(Math.max(0, from), beats.length - 1);
  while (i > 0 && beats[i - 1].kind === 'card') i--;
  return Math.max(0, i);
}
