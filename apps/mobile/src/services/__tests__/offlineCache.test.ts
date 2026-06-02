import AsyncStorage from '@react-native-async-storage/async-storage';
import { offlineCache } from '../offlineCache';
import type { VocabularyResponse } from '../api';

const INDEX_KEY = 'offline_vocab_index';
const keyFor = (k: string | number) => `offline_vocab_${k}`;

const vocab = (movieId: number): VocabularyResponse =>
  ({
    movie_id: movieId,
    script_id: movieId * 10,
    total_words: 100,
    unique_words: 50,
    level_distribution: { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 },
    average_confidence: 0.9,
    wordlist_coverage: 0.8,
    top_words_by_level: {},
  } as VocabularyResponse);

describe('offlineCache', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  describe('savePayload / getPayload', () => {
    it('persists a payload and reads it back with a savedAt stamp', async () => {
      await offlineCache.savePayload(1, 'Heat', { vocabulary: vocab(1), movieId: 1 });
      const got = await offlineCache.getPayload(1);
      expect(got?.movieId).toBe(1);
      expect(got?.vocabulary.movie_id).toBe(1);
      expect(got?.savedAt).toBeTruthy();
    });

    it('records the entry in the index, most-recent first', async () => {
      await offlineCache.savePayload(1, 'Heat', { vocabulary: vocab(1), movieId: 1 });
      await offlineCache.savePayload(2, 'Drive', { vocabulary: vocab(2), movieId: 2 });
      const index = await offlineCache.getIndex();
      expect(index.map((e) => e.cacheKey)).toEqual(['2', '1']);
      expect(index[0].movieTitle).toBe('Drive');
    });

    it('re-saving an existing key moves it to the front without duplicating', async () => {
      await offlineCache.savePayload(1, 'Heat', { vocabulary: vocab(1), movieId: 1 });
      await offlineCache.savePayload(2, 'Drive', { vocabulary: vocab(2), movieId: 2 });
      await offlineCache.savePayload(1, 'Heat', { vocabulary: vocab(1), movieId: 1 });
      const index = await offlineCache.getIndex();
      expect(index.map((e) => e.cacheKey)).toEqual(['1', '2']);
      expect(index).toHaveLength(2);
    });

    it('getPayload returns null for an unknown key', async () => {
      await expect(offlineCache.getPayload(999)).resolves.toBeNull();
    });
  });

  describe('LRU eviction (MAX_CACHED = 20)', () => {
    it('evicts the oldest entry once a 21st movie is cached', async () => {
      for (let i = 1; i <= 21; i += 1) {
        await offlineCache.savePayload(i, `Movie ${i}`, { vocabulary: vocab(i), movieId: i });
      }
      const index = await offlineCache.getIndex();
      expect(index).toHaveLength(20);
      // Movie 1 was the oldest → evicted; its payload blob is gone too.
      expect(index.find((e) => e.cacheKey === '1')).toBeUndefined();
      expect(await AsyncStorage.getItem(keyFor(1))).toBeNull();
      expect(await offlineCache.getPayload(21)).not.toBeNull();
    });
  });

  describe('backwards compatibility', () => {
    it('reads a legacy raw-VocabularyResponse blob saved under the bare key', async () => {
      // Older builds stored the VocabularyResponse directly (no wrapper).
      await AsyncStorage.setItem(keyFor(5), JSON.stringify(vocab(5)));
      const got = await offlineCache.getPayload(5);
      expect(got?.vocabulary.movie_id).toBe(5);
      expect(got?.movieId).toBe(5);
    });

    it('normalises a legacy index entry that used movieId instead of cacheKey', async () => {
      await AsyncStorage.setItem(
        INDEX_KEY,
        JSON.stringify([{ movieId: 7, movieTitle: 'Old', cachedAt: '2025-01-01' }]),
      );
      const index = await offlineCache.getIndex();
      expect(index[0].cacheKey).toBe('7');
      expect(index[0].movieTitle).toBe('Old');
    });

    it('legacy saveVocabulary/getVocabulary helpers still work', async () => {
      await offlineCache.saveVocabulary(8, 'Eight', vocab(8));
      await expect(offlineCache.getVocabulary(8)).resolves.toMatchObject({ movie_id: 8 });
    });
  });

  describe('remove / clearAll', () => {
    it('remove drops both the payload and its index entry', async () => {
      await offlineCache.savePayload(1, 'Heat', { vocabulary: vocab(1), movieId: 1 });
      await offlineCache.remove(1);
      expect(await offlineCache.getPayload(1)).toBeNull();
      expect(await offlineCache.getIndex()).toEqual([]);
    });

    it('clearAll wipes every payload and the index', async () => {
      await offlineCache.savePayload(1, 'Heat', { vocabulary: vocab(1), movieId: 1 });
      await offlineCache.savePayload(2, 'Drive', { vocabulary: vocab(2), movieId: 2 });
      await offlineCache.clearAll();
      expect(await offlineCache.getIndex()).toEqual([]);
      expect(await AsyncStorage.getItem(keyFor(1))).toBeNull();
      expect(await AsyncStorage.getItem(keyFor(2))).toBeNull();
    });
  });

  describe('string cache keys (non-movie payloads)', () => {
    it('supports arbitrary string keys, not just numeric movie ids', async () => {
      await offlineCache.savePayload('search:heat', 'Heat search', {
        vocabulary: vocab(1),
        movieId: 1,
      });
      const got = await offlineCache.getPayload('search:heat');
      expect(got?.vocabulary.movie_id).toBe(1);
    });
  });
});
