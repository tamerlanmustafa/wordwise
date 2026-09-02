/**
 * screeningRunner — the join between a stored ScreeningProgress and the deck
 * on screen (#165). These are the decisions the scene runner makes every
 * beat, driven here without a renderer: which beats a scene has, which words
 * a question beat asks, and what happens when the server cannot card them.
 */

import {
  beatAfterCardRun,
  beatIndexForCard,
  cardRunStart,
  earlierCards,
  indexItems,
  questionBeatNeed,
  queueFromCards,
  resolveScene,
  wordsForBeat,
  type RunnerItem,
} from '../screeningRunner';
import { beatsForScene, SCENE_SIZE, type Beat, type TestQuestion } from '../screeningLogic';
import type { ScreeningProgress } from '../../../stores/screeningStore';

/** Twelve deck words, rarest last so `rank` ordering is easy to read. */
const deck: RunnerItem[] = Array.from({ length: 12 }, (_, i) => ({
  key: `w${i}`,
  word: `w${i}`,
  rank: 100 + i,
}));
const byKey = indexItems(deck);

const progress = (over: Partial<ScreeningProgress> = {}): ScreeningProgress => ({
  movieId: 7,
  keys: deck.map(d => d.key),
  scene: 0,
  beat: 0,
  queue: null,
  missed: [],
  tested: [],
  known: [],
  got: 0,
  forgot: 0,
  savedAt: 0,
  ...over,
});

const card = (word: string) => ({ word });

describe('indexItems', () => {
  it('answers on the deck key and on its lowercase form', () => {
    const map = indexItems([{ key: 'Linger', word: 'Linger', rank: 1 }]);
    expect(map.get('Linger')?.word).toBe('Linger');
    // The lesson endpoint lowercases every word it is given and echoes that
    // back on the card, so the lookup has to survive the round trip.
    expect(map.get('linger')?.word).toBe('Linger');
  });
});

describe('resolveScene', () => {
  it('cuts the frozen keys into scenes and gives the one in flight its beats', () => {
    const r = resolveScene(progress(), byKey);
    expect(r.scenes).toHaveLength(2);
    expect(r.cards.map(c => c.key)).toEqual(['w0', 'w1', 'w2', 'w3', 'w4', 'w5']);
    // Six cards, the spot check after the third, then the test.
    expect(r.beats.map(b => b.kind)).toEqual([
      'card', 'card', 'card', 'spot_check', 'card', 'card', 'card', 'test',
    ]);
    expect(r.beat).toEqual({ kind: 'card', key: 'w0' });
    expect(r.filmComplete).toBe(false);
  });

  it('re-shapes a scene that has been thinned by "I know this"', () => {
    const r = resolveScene(progress({ known: ['w1', 'w2'] }), byKey);
    expect(r.cards.map(c => c.key)).toEqual(['w0', 'w3', 'w4', 'w5']);
    // Four cards means the spot check lands after two, not after three —
    // the shape is re-derived, not stored.
    expect(r.beats.map(b => b.kind)).toEqual([
      'card', 'card', 'spot_check', 'card', 'card', 'test',
    ]);
  });

  it('drops a key that has left the deck entirely', () => {
    const thin = indexItems(deck.filter(d => d.key !== 'w3'));
    expect(resolveScene(progress(), thin).cards.map(c => c.key)).not.toContain('w3');
  });

  it('reports the film complete once the scene cursor runs past the last scene', () => {
    const r = resolveScene(progress({ scene: 2 }), byKey);
    expect(r.filmComplete).toBe(true);
    expect(r.scene).toBeNull();
    expect(r.beats).toEqual([]);
  });

  it('holds a scene boundary still even when the deck shrinks under it', () => {
    // Boundaries come from the FROZEN keys, so scene 1 still starts at 6.
    const r = resolveScene(progress({ scene: 1, known: ['w0', 'w1'] }), byKey);
    expect(r.scene).toEqual({ index: 1, start: 6, end: 12 });
    expect(r.cards).toHaveLength(SCENE_SIZE);
  });
});

describe('earlierCards', () => {
  it('is everything before the scene in flight, minus what was swiped away', () => {
    const p = progress({ scene: 1, known: ['w2'] });
    const keys = earlierCards(p, resolveScene(p, byKey), byKey).map(c => c.key);
    expect(keys).toEqual(['w0', 'w1', 'w3', 'w4', 'w5']);
  });

  it('is empty in the first scene, which has nothing behind it', () => {
    const p = progress();
    expect(earlierCards(p, resolveScene(p, byKey), byKey)).toEqual([]);
  });
});

describe('wordsForBeat', () => {
  it('asks nothing on a card beat', () => {
    const p = progress();
    const r = resolveScene(p, byKey);
    expect(wordsForBeat(r.beats[0], p, r, byKey)).toEqual([]);
  });

  it('asks one question on the spot check: the rarest card read so far', () => {
    const p = progress({ beat: 3 });
    const r = resolveScene(p, byKey);
    // Cards w0..w2 have been read; w2 carries the highest rank, so it is the
    // rarest and the one the reader came for.
    expect(wordsForBeat(r.beats[3], p, r, byKey)).toEqual([{ key: 'w2', source: 'scene' }]);
  });

  it('never spot-checks a word the reader has just swiped away', () => {
    const p = progress({ beat: 2, known: ['w2'] });
    const r = resolveScene(p, byKey);
    const spot = r.beats.find(b => b.kind === 'spot_check')!;
    expect(wordsForBeat(spot, p, r, byKey)).toEqual([{ key: 'w1', source: 'scene' }]);
  });

  it('has nothing to spot-check when every card it names is gone', () => {
    // A beat the runner is holding while the swipe that emptied it lands —
    // the caller reads the empty result as "skip this beat" rather than
    // stranding the reader on a question with no word behind it.
    const p = progress({ known: ['w0', 'w1', 'w2'] });
    const r = resolveScene(p, byKey);
    const stale: Beat = { kind: 'spot_check', from: ['w0', 'w1', 'w2'] };
    expect(wordsForBeat(stale, p, r, byKey)).toEqual([]);
  });

  it('composes a scene test of fresh picks plus resurfaced ones', () => {
    const p = progress({ scene: 1, beat: 7, missed: ['w0'] });
    const r = resolveScene(p, byKey);
    const questions = wordsForBeat(r.beats[r.beats.length - 1], p, r, byKey);
    // Three of this scene's six, rarest first, then the miss, then an
    // untested earlier card.
    expect(questions).toEqual([
      { key: 'w11', source: 'scene' },
      { key: 'w10', source: 'scene' },
      { key: 'w9', source: 'scene' },
      { key: 'w0', source: 'missed' },
      { key: 'w5', source: 'earlier' },
    ]);
  });
});

describe('queueFromCards', () => {
  const asked: TestQuestion[] = [
    { key: 'w0', source: 'scene' },
    { key: 'w1', source: 'scene' },
    { key: 'w2', source: 'missed' },
  ];

  it('keeps the asking order and hands back the card for each question', () => {
    const { queue, byKey: cards } = queueFromCards(asked, [card('w2'), card('w0'), card('w1')]);
    expect(queue.map(q => q.key)).toEqual(['w0', 'w1', 'w2']);
    expect(cards.get('w2')).toEqual({ word: 'w2' });
  });

  it('drops a word the server could not card, rather than asking it anyway', () => {
    // A cold language, an idiom, a lemma with no cached translation: the
    // lesson endpoint returns fewer cards than words, and a question with no
    // card behind it would hang the scene on a beat nobody can answer.
    const { queue } = queueFromCards(asked, [card('w0'), card('w2')]);
    expect(queue.map(q => q.key)).toEqual(['w0', 'w2']);
  });

  it('matches case-insensitively, because the composer lowercases what it is sent', () => {
    const { queue } = queueFromCards([{ key: 'Linger', source: 'scene' }], [card('linger')]);
    expect(queue.map(q => q.key)).toEqual(['Linger']);
  });

  it('asks a word once even if the response repeats it', () => {
    const { queue } = queueFromCards(asked, [card('w0'), card('w0'), card('w1'), card('w2')]);
    expect(queue).toHaveLength(3);
  });

  it('comes back empty when nothing was cardable, which the runner reads as "skip"', () => {
    expect(queueFromCards(asked, []).queue).toEqual([]);
  });
});

describe('questionBeatNeed', () => {
  const spot: Beat = { kind: 'spot_check', from: ['w0'] };
  const question = (key: string): TestQuestion => ({ key, source: 'scene' });

  it('has nothing to say about a card beat, or about no beat at all', () => {
    expect(questionBeatNeed({ kind: 'card', key: 'w0' }, null, 0)).toBe('not-a-question');
    expect(questionBeatNeed(null, null, 0)).toBe('not-a-question');
  });

  it('composes when the beat has no queue yet', () => {
    expect(questionBeatNeed(spot, null, 0)).toBe('compose');
  });

  it('rehydrates a queue that came back from disk with no cards behind it', () => {
    // The resume case: the queue is what the reader still owes, the cards are
    // re-fetched. Also the crash case, which is the same thing.
    expect(questionBeatNeed(spot, [question('w0')], 0)).toBe('rehydrate');
  });

  it('is ready once the queue and its cards are both in hand', () => {
    expect(questionBeatNeed(spot, [question('w0')], 1)).toBe('ready');
  });

  it('calls an emptied queue finished, whether or not cards are still held', () => {
    // Every question answered right at least once — the requeue rule's end.
    expect(questionBeatNeed(spot, [], 3)).toBe('empty');
    expect(questionBeatNeed(spot, [], 0)).toBe('empty');
  });
});

describe('card runs', () => {
  const beats = beatsForScene(['a', 'b', 'c', 'd', 'e', 'f']);

  it('brackets the run before the spot check and the run before the test', () => {
    expect([cardRunStart(beats, 0), beatAfterCardRun(beats, 0)]).toEqual([0, 3]);
    expect([cardRunStart(beats, 2), beatAfterCardRun(beats, 2)]).toEqual([0, 3]);
    expect([cardRunStart(beats, 4), beatAfterCardRun(beats, 4)]).toEqual([4, 7]);
    expect([cardRunStart(beats, 6), beatAfterCardRun(beats, 6)]).toEqual([4, 7]);
  });

  it('ends a run of cards with no question after it at the end of the scene', () => {
    const cardsOnly = beatsForScene(['a']).slice(0, 1);
    expect(beatAfterCardRun(cardsOnly, 0)).toBe(1);
  });

  it('finds a card by its word, and says -1 for one that has left the scene', () => {
    const keys = beats.map(b => (b.kind === 'card' ? `card:${b.key}` : b.kind));
    expect(beatIndexForCard(keys, 'd')).toBe(4);
    expect(beatIndexForCard(keys, 'zz')).toBe(-1);
  });
});
