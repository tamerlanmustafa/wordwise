import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  usePracticePathStore,
  kindAtIndex,
  PRACTICE_KIND_CYCLE,
} from '../practicePathStore';

const KEY = 'practice.path.cursor.v1';
const flush = () => new Promise<void>((r) => setImmediate(r));

describe('practicePathStore', () => {
  let nowSpy: jest.SpyInstance;
  let clock = 1_000_000;

  beforeEach(async () => {
    await AsyncStorage.clear();
    clock = 1_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => clock);
    // _resetTo also clears the module-level debounce timestamp.
    usePracticePathStore.getState()._resetTo(0);
    usePracticePathStore.setState({ hydrated: false });
  });

  afterEach(() => nowSpy.mockRestore());

  describe('hydrate', () => {
    it('defaults to cursor 0 when nothing is persisted', async () => {
      await usePracticePathStore.getState().hydrate();
      expect(usePracticePathStore.getState().cursor).toBe(0);
      expect(usePracticePathStore.getState().hydrated).toBe(true);
    });

    it('restores a persisted cursor', async () => {
      await AsyncStorage.setItem(KEY, JSON.stringify({ cursor: 12 }));
      await usePracticePathStore.getState().hydrate();
      expect(usePracticePathStore.getState().cursor).toBe(12);
    });

    it('floors a fractional persisted cursor', async () => {
      await AsyncStorage.setItem(KEY, JSON.stringify({ cursor: 4.9 }));
      await usePracticePathStore.getState().hydrate();
      expect(usePracticePathStore.getState().cursor).toBe(4);
    });

    it('ignores a corrupt/negative persisted cursor and falls back to 0', async () => {
      await AsyncStorage.setItem(KEY, JSON.stringify({ cursor: -3 }));
      await usePracticePathStore.getState().hydrate();
      expect(usePracticePathStore.getState().cursor).toBe(0);
    });

    it('survives garbage JSON without throwing', async () => {
      await AsyncStorage.setItem(KEY, 'not json');
      await usePracticePathStore.getState().hydrate();
      expect(usePracticePathStore.getState().cursor).toBe(0);
      expect(usePracticePathStore.getState().hydrated).toBe(true);
    });
  });

  describe('advance', () => {
    it('increments the cursor by one and returns the new value', () => {
      const next = usePracticePathStore.getState().advance();
      expect(next).toBe(1);
      expect(usePracticePathStore.getState().cursor).toBe(1);
    });

    it('persists the advanced cursor', async () => {
      usePracticePathStore.getState().advance();
      await flush();
      expect(await AsyncStorage.getItem(KEY)).toBe(JSON.stringify({ cursor: 1 }));
    });

    it('debounces a double-fire within ADVANCE_DEBOUNCE_MS (coalesced to one bump)', () => {
      const first = usePracticePathStore.getState().advance();
      const second = usePracticePathStore.getState().advance(); // same tick
      expect(first).toBe(1);
      expect(second).toBe(1); // not 2 — second call is swallowed
      expect(usePracticePathStore.getState().cursor).toBe(1);
    });

    it('advances again once the debounce window has elapsed', () => {
      usePracticePathStore.getState().advance(); // → 1
      clock += 900; // > 800ms
      const next = usePracticePathStore.getState().advance(); // → 2
      expect(next).toBe(2);
      expect(usePracticePathStore.getState().cursor).toBe(2);
    });
  });

  describe('_resetTo', () => {
    it('jumps the cursor to an arbitrary index and clears the debounce', () => {
      usePracticePathStore.getState()._resetTo(9);
      expect(usePracticePathStore.getState().cursor).toBe(9);
      // debounce cleared → an immediate advance still works.
      expect(usePracticePathStore.getState().advance()).toBe(10);
    });
  });

  describe('kindAtIndex cycle alignment with the store', () => {
    it('cycles through the canonical 3-step kind sequence', () => {
      expect(PRACTICE_KIND_CYCLE).toEqual([
        'quick_recall',
        'tough_words',
        'movie_deep_dive',
      ]);
      expect(kindAtIndex(0)).toBe('quick_recall');
      expect(kindAtIndex(7)).toBe('tough_words'); // 7 % 3 === 1
    });
  });
});
