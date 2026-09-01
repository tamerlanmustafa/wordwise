import AsyncStorage from '@react-native-async-storage/async-storage';
import { useScreeningStore, isSceneInFlight, type ScreeningProgress } from '../screeningStore';

const KEY = (movieId: number) => `screening.progress.v1.${movieId}`;
const STALE_MS = 24 * 60 * 60 * 1000;
const flush = () => new Promise<void>(r => setImmediate(r));

const progress = (
  movieId: number,
  over: Partial<ScreeningProgress> = {},
): Omit<ScreeningProgress, 'savedAt'> => ({
  movieId,
  keys: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7'],
  scene: 0,
  beat: 0,
  queue: null,
  missed: [],
  tested: [],
  known: [],
  ...over,
});
const q = (...keys: string[]) => keys.map(key => ({ key, source: 'scene' as const }));
const queueKeys = (movieId: number) =>
  useScreeningStore.getState().resumable(movieId)?.queue?.map(x => x.key);

describe('screeningStore', () => {
  let nowSpy: jest.SpyInstance;
  let clock = 1_700_000_000_000;

  beforeEach(async () => {
    await AsyncStorage.clear();
    clock = 1_700_000_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => clock);
    useScreeningStore.setState({ byMovie: {} });
  });

  afterEach(() => nowSpy.mockRestore());

  const store = () => useScreeningStore.getState();

  describe('start / persistence', () => {
    it("stores a film's progress and stamps savedAt", () => {
      store().start(progress(7, { scene: 1 }));
      const c = store().resumable(7)!;
      expect(c.movieId).toBe(7);
      expect(c.scene).toBe(1);
      expect(c.savedAt).toBe(clock);
    });

    it("writes through to AsyncStorage under the film's own key", async () => {
      store().start(progress(7));
      await flush();
      const raw = await AsyncStorage.getItem(KEY(7));
      expect(JSON.parse(raw!).movieId).toBe(7);
    });

    it('keeps two films apart', () => {
      store().start(progress(7, { scene: 2 }));
      store().start(progress(9));
      expect(store().resumable(7)!.scene).toBe(2);
      expect(store().resumable(9)!.scene).toBe(0);
    });
  });

  describe('update', () => {
    it('merges a patch and re-stamps savedAt', () => {
      store().start(progress(7));
      clock += 5_000;
      store().update(7, { beat: 3 });
      const c = store().resumable(7)!;
      expect(c.beat).toBe(3);
      expect(c.keys).toHaveLength(7);
      expect(c.savedAt).toBe(clock);
    });

    it('is a no-op for a film with nothing stored', () => {
      store().update(7, { beat: 3 });
      expect(store().byMovie[7]).toBeUndefined();
    });
  });

  describe('answer (the test queue)', () => {
    it('drops the head on a right answer and records it as tested', () => {
      store().start(progress(7, { beat: 7, queue: q('a', 'b') }));
      store().answer(7, true);
      expect(queueKeys(7)).toEqual(['b']);
      expect(store().resumable(7)!.tested).toEqual(['a']);
      expect(store().resumable(7)!.missed).toEqual([]);
    });

    it('sends a wrong answer to the back and records the miss, oldest first', () => {
      store().start(progress(7, { beat: 7, queue: q('a', 'b', 'c') }));
      store().answer(7, false); // a
      expect(queueKeys(7)).toEqual(['b', 'c', 'a']);
      expect(store().resumable(7)!.missed).toEqual(['a']);
      store().answer(7, false); // b
      expect(queueKeys(7)).toEqual(['c', 'a', 'b']);
      expect(store().resumable(7)!.missed).toEqual(['a', 'b']);
      store().answer(7, true); // c
      store().answer(7, false); // a again: order kept, no duplicate
      expect(queueKeys(7)).toEqual(['b', 'a']);
      expect(store().resumable(7)!.missed).toEqual(['a', 'b']);
    });

    it('is not over until every question has been answered right once', () => {
      store().start(progress(7, { beat: 7, queue: q('a', 'b') }));
      store().answer(7, false); // a → [b, a]
      store().answer(7, true); // b
      store().answer(7, false); // a, already last → [a]
      store().answer(7, true); // a
      store().answer(7, true); // nothing left: no-op
      const c = store().resumable(7)!;
      expect(c.queue).toEqual([]);
      expect(c.tested).toEqual(['b', 'a']);
      expect(c.missed).toEqual(['a']);
    });

    it('is a no-op outside a test', () => {
      store().start(progress(7));
      store().answer(7, true);
      expect(store().resumable(7)!.tested).toEqual([]);
    });
  });

  describe('markKnown', () => {
    it('removes the word from the scene and from the pending test, once', () => {
      store().start(progress(7, { beat: 7, queue: q('a', 'b') }));
      store().markKnown(7, 'b');
      expect(store().resumable(7)!.known).toEqual(['b']);
      expect(queueKeys(7)).toEqual(['a']);
      store().markKnown(7, 'b');
      expect(store().resumable(7)!.known).toEqual(['b']);
    });
  });

  describe('resumable and the 24h rule', () => {
    it('returns null for a film with nothing stored', () => {
      expect(store().resumable(7)).toBeNull();
    });

    it("restarts a stale in-flight scene from its first card but keeps the film's progress", () => {
      store().start(
        progress(7, {
          scene: 2,
          beat: 4,
          queue: q('a'),
          missed: ['x'],
          tested: ['y'],
          known: ['z'],
        }),
      );
      clock += STALE_MS + 1;
      const c = store().resumable(7)!;
      expect(c.beat).toBe(0);
      expect(c.queue).toBeNull();
      expect(isSceneInFlight(c)).toBe(false);
      expect(c.scene).toBe(2);
      expect(c.missed).toEqual(['x']);
      expect(c.tested).toEqual(['y']);
      expect(c.known).toEqual(['z']);
      expect(c.savedAt).toBe(clock);
    });

    it('leaves a scene not yet started alone, however old it is', () => {
      store().start(progress(7, { scene: 3 }));
      const savedAt = clock;
      clock += 3 * STALE_MS;
      const c = store().resumable(7)!;
      expect(c.scene).toBe(3);
      expect(c.savedAt).toBe(savedAt);
    });

    it('resumes an in-flight scene younger than a day at its beat', () => {
      store().start(progress(7, { beat: 4, queue: q('a') }));
      clock += STALE_MS - 1;
      expect(store().resumable(7)!.beat).toBe(4);
      expect(queueKeys(7)).toEqual(['a']);
    });
  });

  describe('hydrate', () => {
    it('loads a persisted film and marks it hydrated', async () => {
      store().start(progress(7, { beat: 2 }));
      await flush();
      useScreeningStore.setState({ byMovie: {} });
      expect(store().isHydrated(7)).toBe(false);
      await store().hydrate(7);
      expect(store().isHydrated(7)).toBe(true);
      expect(store().resumable(7)!.beat).toBe(2);
    });

    it('hydrates a film with nothing stored to null, and says so', async () => {
      await store().hydrate(7);
      expect(store().isHydrated(7)).toBe(true);
      expect(store().resumable(7)).toBeNull();
    });

    it('applies the 24h rule on hydrate and writes the restarted scene back', async () => {
      store().start(progress(7, { scene: 1, beat: 5, queue: q('a') }));
      await flush();
      clock += STALE_MS + 1;
      useScreeningStore.setState({ byMovie: {} });
      await store().hydrate(7);
      await flush();
      expect(store().resumable(7)).toMatchObject({ scene: 1, beat: 0, queue: null });
      expect(JSON.parse((await AsyncStorage.getItem(KEY(7)))!).beat).toBe(0);
    });

    it('hydrates to null when storage holds malformed data', async () => {
      await AsyncStorage.setItem(KEY(7), '{bad json');
      await store().hydrate(7);
      expect(store().resumable(7)).toBeNull();

      await AsyncStorage.setItem(
        KEY(8),
        JSON.stringify({ movieId: 8, keys: 'nope', scene: 0, beat: 0, savedAt: clock }),
      );
      await store().hydrate(8);
      expect(store().resumable(8)).toBeNull();
    });

    it('ignores a record filed under the wrong film', async () => {
      await AsyncStorage.setItem(KEY(7), JSON.stringify({ ...progress(9), savedAt: clock }));
      await store().hydrate(7);
      expect(store().resumable(7)).toBeNull();
    });

    it('defaults the optional sets when an older record lacks them', async () => {
      await AsyncStorage.setItem(
        KEY(7),
        JSON.stringify({ movieId: 7, keys: ['a'], scene: 0, beat: 0, savedAt: clock }),
      );
      await store().hydrate(7);
      expect(store().resumable(7)).toMatchObject({
        queue: null,
        missed: [],
        tested: [],
        known: [],
      });
    });
  });

  describe('clear', () => {
    it('wipes the film in memory and on disk, leaving other films alone', async () => {
      store().start(progress(7));
      store().start(progress(9));
      await flush();
      store().clear(7);
      await flush();
      expect(store().resumable(7)).toBeNull();
      expect(await AsyncStorage.getItem(KEY(7))).toBeNull();
      expect(store().resumable(9)).not.toBeNull();
    });
  });
});
