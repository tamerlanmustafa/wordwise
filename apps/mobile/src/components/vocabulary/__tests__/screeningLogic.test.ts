import * as fs from 'fs';
import * as path from 'path';
import {
  SCENE_SIZE,
  RESURFACE_COUNT,
  freshTestCount,
  spotCheckAfter,
  partitionScenes,
  beatsForScene,
  beatKey,
  rarestFirst,
  pickTestWords,
  requeue,
  startLinear,
  linearReducer,
  currentKey,
  linearProgress,
  type Beat,
  type ScreeningItem,
  type TestQuestion,
} from '../screeningLogic';

const keys = (n: number, prefix = 'w') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
const item = (key: string, rank: number | null): ScreeningItem => ({ key, rank });

describe('scene shape', () => {
  it('is a six-card scene with two resurfaced questions (#161)', () => {
    expect(SCENE_SIZE).toBe(6);
    expect(RESURFACE_COUNT).toBe(2);
  });

  it('tests half the cards, rounded up', () => {
    expect(freshTestCount(6)).toBe(3);
    expect(freshTestCount(7)).toBe(4);
    expect(freshTestCount(11)).toBe(6);
    expect(freshTestCount(1)).toBe(1);
    expect(freshTestCount(0)).toBe(0);
  });

  it('lands the spot check after the midpoint card, with a card always after it', () => {
    expect(spotCheckAfter(6)).toBe(3);
    expect(spotCheckAfter(7)).toBe(3);
    expect(spotCheckAfter(8)).toBe(4);
    expect(spotCheckAfter(2)).toBe(1);
    expect(spotCheckAfter(1)).toBe(0);
  });
});

describe('partitionScenes', () => {
  it('cuts an empty deck into no scenes', () => {
    expect(partitionScenes(0)).toEqual([]);
  });

  it('makes a thin deck one scene of whatever exists', () => {
    expect(partitionScenes(1)).toEqual([{ index: 0, start: 0, end: 1 }]);
    expect(partitionScenes(5)).toEqual([{ index: 0, start: 0, end: 5 }]);
  });

  it('lets the last scene absorb the remainder instead of cutting a short one', () => {
    expect(partitionScenes(7)).toEqual([{ index: 0, start: 0, end: 7 }]);
    expect(partitionScenes(8)).toEqual([{ index: 0, start: 0, end: 8 }]);
    expect(partitionScenes(9)).toEqual([{ index: 0, start: 0, end: 9 }]);
    expect(partitionScenes(11)).toEqual([{ index: 0, start: 0, end: 11 }]);
    expect(partitionScenes(13)).toEqual([
      { index: 0, start: 0, end: 6 },
      { index: 1, start: 6, end: 13 },
    ]);
  });

  it('cuts exact multiples evenly', () => {
    expect(partitionScenes(12)).toEqual([
      { index: 0, start: 0, end: 6 },
      { index: 1, start: 6, end: 12 },
    ]);
    const sixty = partitionScenes(60);
    expect(sixty).toHaveLength(10);
    expect(sixty.every(s => s.end - s.start === 6)).toBe(true);
  });

  it('sizes a 41-card deck (60 is not 60) into six scenes, the last one 11 long', () => {
    const scenes = partitionScenes(41);
    expect(scenes).toHaveLength(6);
    expect(scenes[5]).toEqual({ index: 5, start: 30, end: 41 });
  });

  it.each([6, 7, 8, 9, 41, 60, 100])(
    'never produces an empty or short scene from %i items',
    total => {
      const scenes = partitionScenes(total);
      expect(scenes.length).toBeGreaterThan(0);
      for (const s of scenes) {
        expect(s.end - s.start).toBeGreaterThanOrEqual(SCENE_SIZE);
        expect(s.end - s.start).toBeLessThan(2 * SCENE_SIZE);
      }
    },
  );

  it.each([1, 5, 6, 13, 41, 60])('tiles the whole deck from %i items, no gap or overlap', total => {
    const scenes = partitionScenes(total);
    expect(scenes[0].start).toBe(0);
    expect(scenes[scenes.length - 1].end).toBe(total);
    scenes.forEach((s, i) => {
      expect(s.index).toBe(i);
      if (i > 0) expect(s.start).toBe(scenes[i - 1].end);
    });
  });

  it('takes a scene size, for the eight-card shape the plan compared against', () => {
    expect(partitionScenes(16, 8)).toEqual([
      { index: 0, start: 0, end: 8 },
      { index: 1, start: 8, end: 16 },
    ]);
  });

  it('treats junk totals as empty', () => {
    expect(partitionScenes(NaN)).toEqual([]);
    expect(partitionScenes(-3)).toEqual([]);
  });
});

describe('beatsForScene', () => {
  it('runs cards, a spot check after the midpoint, then the test', () => {
    const beats = beatsForScene(keys(6));
    expect(beats.map(beatKey)).toEqual([
      'card:w1',
      'card:w2',
      'card:w3',
      'spot_check',
      'card:w4',
      'card:w5',
      'card:w6',
      'test',
    ]);
    expect(beats[3]).toEqual({ kind: 'spot_check', from: ['w1', 'w2', 'w3'] });
  });

  it('is 12 beats for a six-card scene once the test expands (#161)', () => {
    const cards = keys(6).map(k => item(k, 1000));
    const beats = beatsForScene(cards.map(c => c.key));
    const questions = pickTestWords(cards, [], [], []);
    expect(beats.length - 1 + questions.length).toBe(12);
  });

  it('gives a one-card scene no spot check', () => {
    expect(beatsForScene(['solo']).map(beatKey)).toEqual(['card:solo', 'test']);
  });

  it('has no beats for an empty scene', () => {
    expect(beatsForScene([])).toEqual([]);
  });

  it('draws the spot check from exactly the cards read so far on a long last scene', () => {
    const beats = beatsForScene(keys(11));
    const spot = beats.findIndex(b => b.kind === 'spot_check');
    expect(spot).toBe(5); // after card 5
    expect((beats[spot] as Extract<Beat, { kind: 'spot_check' }>).from).toEqual(keys(5));
  });
});

describe('rarestFirst', () => {
  it('orders by descending frequency rank with unranked items last, stable on ties', () => {
    const items = [
      item('a', 100),
      item('idiom1', null),
      item('b', 5000),
      item('c', 2000),
      item('idiom2', null),
      item('d', 2000),
    ];
    expect(rarestFirst(items).map(i => i.key)).toEqual(['b', 'c', 'd', 'a', 'idiom1', 'idiom2']);
  });

  it('does not mutate its input', () => {
    const items = [item('a', 1), item('b', 2)];
    rarestFirst(items);
    expect(items.map(i => i.key)).toEqual(['a', 'b']);
  });
});

describe('pickTestWords', () => {
  // Card order is reading order; the ranks make w6 the rarest and w1 the commonest.
  const scene = keys(6).map((k, i) => item(k, (i + 1) * 1000));
  const earlier = keys(6, 'e').map((k, i) => item(k, (i + 1) * 100));

  it('on a first scene asks five questions, all from the scene, rarest first', () => {
    expect(pickTestWords(scene, [], [], [])).toEqual([
      { key: 'w6', source: 'scene' },
      { key: 'w5', source: 'scene' },
      { key: 'w4', source: 'scene' },
      { key: 'w3', source: 'scene' },
      { key: 'w2', source: 'scene' },
    ]);
  });

  it('brings missed words back first, oldest miss first', () => {
    const q = pickTestWords(scene, ['e2', 'e5', 'e1'], earlier, ['e2', 'e5', 'e1']);
    expect(q).toHaveLength(5);
    expect(q.slice(3)).toEqual([
      { key: 'e2', source: 'missed' },
      { key: 'e5', source: 'missed' },
    ]);
  });

  it("then earlier scenes' untested words, rarest first", () => {
    const q = pickTestWords(scene, ['e1'], earlier, ['e6', 'e5']);
    expect(q.slice(3)).toEqual([
      { key: 'e1', source: 'missed' },
      { key: 'e4', source: 'earlier' },
    ]);
  });

  it('fills from the scene when there is nothing left to bring back', () => {
    const q = pickTestWords(scene, [], earlier, earlier.map(e => e.key));
    expect(q.map(x => x.source)).toEqual(['scene', 'scene', 'scene', 'scene', 'scene']);
  });

  it('resurfaces a spot-check miss from this scene once, never twice', () => {
    // w1 (commonest) is not among the fresh three, so it comes back as missed…
    expect(pickTestWords(scene, ['w1'], [], [])[3]).toEqual({ key: 'w1', source: 'missed' });
    // …while w6 (rarest) already is, so it appears once and the slot moves on.
    const q = pickTestWords(scene, ['w6'], earlier, []);
    expect(q.filter(x => x.key === 'w6')).toHaveLength(1);
    expect(q[3]).toEqual({ key: 'e6', source: 'earlier' });
  });

  it('never asks a word twice, whatever overlaps the inputs have', () => {
    const q = pickTestWords(scene, ['e1', 'e1', 'w2', 'e3'], [...earlier, ...scene], ['e3']);
    const ks = q.map(x => x.key);
    expect(new Set(ks).size).toBe(ks.length);
    expect(q).toHaveLength(5);
  });

  it('sizes the test from the scene it is given, not from a constant', () => {
    expect(pickTestWords(scene.slice(0, 1), [], earlier, [])).toHaveLength(3); // 1 fresh + 2 back
    expect(pickTestWords(scene.slice(0, 1), [], [], [])).toHaveLength(1); // nothing to fill from
    expect(pickTestWords(keys(11).map(k => item(k, 1)), [], [], [])).toHaveLength(8); // 6 + 2
    expect(pickTestWords([], ['e1'], earlier, [])).toEqual([]);
  });

  it('puts unranked idioms after every ranked word', () => {
    // Four items → a four-question test (2 fresh + 2 filled), so all are asked.
    const withIdiom = [item('run out of', null), ...scene.slice(0, 3)];
    expect(pickTestWords(withIdiom, [], [], []).map(x => x.key)).toEqual([
      'w3',
      'w2',
      'w1',
      'run out of',
    ]);
  });
});

describe('requeue', () => {
  const q: TestQuestion[] = [
    { key: 'a', source: 'scene' },
    { key: 'b', source: 'scene' },
    { key: 'c', source: 'missed' },
  ];

  it('moves the wrong question to the back', () => {
    expect(requeue(q, 0).map(x => x.key)).toEqual(['b', 'c', 'a']);
    expect(requeue(q, 1).map(x => x.key)).toEqual(['a', 'c', 'b']);
  });

  it('leaves a question already at the back, and out-of-range indices, alone', () => {
    expect(requeue(q, 2)).toBe(q);
    expect(requeue(q, -1)).toBe(q);
    expect(requeue(q, 3)).toBe(q);
    expect(requeue([], 0)).toEqual([]);
  });

  it('does not mutate the input', () => {
    requeue(q, 0);
    expect(q.map(x => x.key)).toEqual(['a', 'b', 'c']);
  });

  it('is not over until every question has been answered right once', () => {
    let queue = [...q];
    const asked: string[] = [];
    const wrongLeft: Record<string, number> = { b: 2 };
    while (queue.length) {
      const head = queue[0];
      asked.push(head.key);
      if ((wrongLeft[head.key] ?? 0) > 0) {
        wrongLeft[head.key] -= 1;
        queue = requeue(queue, 0);
      } else {
        queue = queue.slice(1);
      }
    }
    expect(asked).toEqual(['a', 'b', 'c', 'b', 'b']);
  });
});

describe('linear cursor', () => {
  // card:w1, spot_check, card:w2, card:w3, test
  const ks = beatsForScene(keys(3)).map(beatKey);

  it('starts on the first beat', () => {
    expect(startLinear(ks)).toEqual({ keys: ks, index: 0, exhausted: false });
    expect(currentKey(startLinear(ks))).toBe('card:w1');
  });

  it('ends — it does not wrap', () => {
    let s = startLinear(ks);
    for (let i = 0; i < ks.length; i++) {
      expect(s.exhausted).toBe(false);
      s = linearReducer(s, { type: 'advance' });
    }
    expect(s.exhausted).toBe(true);
    expect(s.index).toBe(ks.length);
    expect(currentKey(s)).toBeNull();
    expect(linearReducer(s, { type: 'advance' })).toBe(s);
  });

  it('is exhausted from the start on an empty sequence', () => {
    expect(startLinear([])).toEqual({ keys: [], index: 0, exhausted: true });
  });

  it('resumes at a stored beat, clamping junk', () => {
    expect(startLinear(ks, 3).index).toBe(3);
    expect(startLinear(ks, 99)).toEqual({ keys: ks, index: 5, exhausted: true });
    expect(startLinear(ks, -4).index).toBe(0);
  });

  it('reports progress for the header', () => {
    expect(linearProgress(startLinear(ks, 2))).toEqual({ done: 2, total: 5 });
    expect(linearProgress(startLinear(ks, 99))).toEqual({ done: 5, total: 5 });
  });

  describe('sync (a card swiped "I know this")', () => {
    // Without w2: card:w1, spot_check, card:w3, test
    const withoutW2 = beatsForScene(['w1', 'w3']).map(beatKey);

    it('keeps focus on the same beat when an earlier card leaves', () => {
      const s = startLinear(ks, 3); // card:w3
      const next = linearReducer(s, { type: 'sync', keys: withoutW2 });
      expect(next).toEqual({ keys: withoutW2, index: 2, exhausted: false });
    });

    it('promotes the beat now at the same position when the focused card leaves', () => {
      const s = startLinear(ks, 2); // card:w2
      const next = linearReducer(s, { type: 'sync', keys: withoutW2 });
      expect(currentKey(next)).toBe('card:w3');
    });

    it('exhausts instead of wrapping when the sequence ends under the cursor', () => {
      const s = startLinear(ks, 3); // card:w3
      const onlyW1 = beatsForScene(['w1']).map(beatKey); // card:w1, test
      const next = linearReducer(s, { type: 'sync', keys: onlyW1 });
      expect(next).toEqual({ keys: onlyW1, index: 2, exhausted: true });
    });

    it('stays exhausted through a sync', () => {
      const s = startLinear(ks, 99);
      expect(linearReducer(s, { type: 'sync', keys: withoutW2 })).toEqual({
        keys: withoutW2,
        index: withoutW2.length,
        exhausted: true,
      });
    });
  });

  it('restarts from the first beat', () => {
    const s = startLinear(ks, 99);
    expect(linearReducer(s, { type: 'restart', keys: ks })).toEqual(startLinear(ks));
  });
});

describe('a scene, end to end', () => {
  it('walks six cards, a spot check and a five-question test to a real end', () => {
    const cards = keys(6).map((k, i) => item(k, (i + 1) * 10));
    const beats = beatsForScene(cards.map(c => c.key));
    let cursor = startLinear(beats.map(beatKey));
    const seen: string[] = [];
    let answered = 0;
    while (!cursor.exhausted) {
      const key = currentKey(cursor) as string;
      seen.push(key);
      if (key === 'test') {
        let queue = pickTestWords(cards, [], [], []);
        let firstWrong = true;
        while (queue.length) {
          answered += 1;
          if (firstWrong) {
            firstWrong = false;
            queue = requeue(queue, 0);
          } else {
            queue = queue.slice(1);
          }
        }
      }
      cursor = linearReducer(cursor, { type: 'advance' });
    }
    expect(seen).toHaveLength(8);
    expect(seen.filter(k => k.startsWith('card:'))).toHaveLength(6);
    expect(answered).toBe(6); // five questions, one of them asked twice
    expect(currentKey(cursor)).toBeNull();
  });
});

describe('source guard: nothing sizes a scene from the suggested-words cap', () => {
  it.each(['../screeningLogic.ts', '../../../stores/screeningStore.ts'])(
    '%s never reads SUGGESTED_CAP',
    rel => {
      const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
      expect(src).not.toMatch(/SUGGESTED_CAP/);
    },
  );
});
