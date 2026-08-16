import AsyncStorage from '@react-native-async-storage/async-storage';

// The store touches exactly two API surfaces: the feed page and the word
// save/interaction log.
jest.mock('../../services/api', () => ({
  srsApi: { feed: jest.fn() },
  wordwiseApi: { saveWord: jest.fn(), logInteraction: jest.fn() },
}));

import { useWordFeedStore, FEED_PAGE_SIZE, logFeedFlip } from '../wordFeedStore';
import { srsApi, wordwiseApi, type FeedItem } from '../../services/api';

const MIX_KEY = 'feedLevelMix';
const SEEN_KEY = 'feedSeenLemmas.v1';

const mockFeed = srsApi.feed as jest.Mock;
const mockSave = wordwiseApi.saveWord as jest.Mock;
const mockLog = wordwiseApi.logInteraction as jest.Mock;

const flush = () => new Promise<void>((r) => setImmediate(r));

const item = (id: number, cefr = 'B1'): FeedItem => ({
  lemma_id: id,
  word: `word${id}`,
  ipa: null,
  pos: 'noun',
  cefr,
  sentence: `A sentence with word${id} inside.`,
  sentence_match: { start: 16, end: 16 + `word${id}`.length },
  translated_word: `t${id}`,
  translated_sentence: `ts${id}`,
  translation_source: 'deepl',
});

const page = (items: FeedItem[], has_more = true) => ({
  items,
  mix_applied: { B1: items.length },
  has_more,
});

describe('wordFeedStore', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    useWordFeedStore.getState().reset();
    useWordFeedStore.setState({ seen: new Set(), mix: { A2: 0, B1: 70, B2: 20, C1: 10 } });
  });

  describe('paging', () => {
    it('appends a page and advances the cursor', async () => {
      mockFeed.mockResolvedValue(page([item(1), item(2)]));

      await useWordFeedStore.getState().fetchNext();

      expect(useWordFeedStore.getState().items).toHaveLength(2);
      expect(useWordFeedStore.getState().page).toBe(1);
      expect(mockFeed).toHaveBeenCalledWith(
        expect.objectContaining({ limit: FEED_PAGE_SIZE, offset: 0 }),
      );
    });

    it('requests the next offset on the following page', async () => {
      mockFeed.mockResolvedValue(page([item(1)]));
      await useWordFeedStore.getState().fetchNext();
      mockFeed.mockResolvedValue(page([item(2)]));
      await useWordFeedStore.getState().fetchNext();

      expect(mockFeed).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: FEED_PAGE_SIZE }),
      );
      expect(useWordFeedStore.getState().items.map((i) => i.lemma_id)).toEqual([1, 2]);
    });

    it('drops duplicates so the list never gets two identical keys', async () => {
      mockFeed.mockResolvedValue(page([item(1), item(2)]));
      await useWordFeedStore.getState().fetchNext();
      mockFeed.mockResolvedValue(page([item(2), item(3)]));
      await useWordFeedStore.getState().fetchNext();

      expect(useWordFeedStore.getState().items.map((i) => i.lemma_id)).toEqual([1, 2, 3]);
    });

    it('stops paging once the server says there is no more', async () => {
      mockFeed.mockResolvedValue(page([item(1)], false));
      await useWordFeedStore.getState().fetchNext();
      expect(useWordFeedStore.getState().exhausted).toBe(true);

      await useWordFeedStore.getState().fetchNext();
      expect(mockFeed).toHaveBeenCalledTimes(1);
    });

    it('does not fire two overlapping requests', async () => {
      let resolve!: (v: unknown) => void;
      mockFeed.mockReturnValue(new Promise((r) => { resolve = r; }));

      const first = useWordFeedStore.getState().fetchNext();
      const second = useWordFeedStore.getState().fetchNext();
      resolve(page([item(1)]));
      await Promise.all([first, second]);

      expect(mockFeed).toHaveBeenCalledTimes(1);
    });

    it('surfaces a failed page without wiping what is already on screen', async () => {
      mockFeed.mockResolvedValue(page([item(1)]));
      await useWordFeedStore.getState().fetchNext();

      mockFeed.mockRejectedValue(new Error('offline'));
      await useWordFeedStore.getState().fetchNext();

      expect(useWordFeedStore.getState().loadError).toBe(true);
      expect(useWordFeedStore.getState().loading).toBe(false);
      expect(useWordFeedStore.getState().items).toHaveLength(1);
    });
  });

  describe('seen-set persistence', () => {
    it('records a lemma as seen when it becomes the active card', async () => {
      mockFeed.mockResolvedValue(page([item(1), item(2)]));
      await useWordFeedStore.getState().fetchNext();

      useWordFeedStore.getState().setActiveIndex(1);
      await flush();

      expect(useWordFeedStore.getState().seen.has(2)).toBe(true);
      expect(JSON.parse((await AsyncStorage.getItem(SEEN_KEY))!)).toContain(2);
    });

    it('restores the seen set on hydrate', async () => {
      await AsyncStorage.setItem(SEEN_KEY, JSON.stringify([7, 8]));
      mockFeed.mockResolvedValue(page([item(1)]));

      await useWordFeedStore.getState().hydrate('B1', 'es');

      expect(useWordFeedStore.getState().seen.has(7)).toBe(true);
      expect(useWordFeedStore.getState().seen.has(8)).toBe(true);
    });

    it('survives an unreadable seen set rather than failing to load', async () => {
      await AsyncStorage.setItem(SEEN_KEY, 'not json');
      mockFeed.mockResolvedValue(page([item(1)]));

      await useWordFeedStore.getState().hydrate('B1', 'es');

      expect(useWordFeedStore.getState().seen.size).toBe(0);
      expect(useWordFeedStore.getState().items).toHaveLength(1);
    });
  });

  describe('mix', () => {
    it('persists a balanced mix and refetches from page 0', async () => {
      mockFeed.mockResolvedValue(page([item(1)]));
      await useWordFeedStore.getState().fetchNext();
      mockFeed.mockClear();
      mockFeed.mockResolvedValue(page([item(9, 'C1')]));

      await useWordFeedStore.getState().setMix({ A2: 0, B1: 0, B2: 0, C1: 100 });

      expect(JSON.parse((await AsyncStorage.getItem(MIX_KEY))!)).toEqual({
        A2: 0, B1: 0, B2: 0, C1: 100,
      });
      expect(mockFeed).toHaveBeenCalledWith(expect.objectContaining({ offset: 0 }));
      // The old page is discarded, not appended to.
      expect(useWordFeedStore.getState().items.map((i) => i.lemma_id)).toEqual([9]);
    });

    it('rejects a mix that does not total 100', async () => {
      await useWordFeedStore.getState().setMix({ A2: 0, B1: 70, B2: 20, C1: 0 });

      expect(await AsyncStorage.getItem(MIX_KEY)).toBeNull();
      expect(mockFeed).not.toHaveBeenCalled();
    });

    it('rejects a mix that overshoots 100', async () => {
      await useWordFeedStore.getState().setMix({ A2: 0, B1: 70, B2: 40, C1: 0 });
      expect(await AsyncStorage.getItem(MIX_KEY)).toBeNull();
    });

    it('restores a stored mix on hydrate', async () => {
      await AsyncStorage.setItem(MIX_KEY, JSON.stringify({ A2: 50, B1: 50 }));
      mockFeed.mockResolvedValue(page([item(1)]));

      await useWordFeedStore.getState().hydrate('B1', 'es');

      expect(useWordFeedStore.getState().mix).toEqual({ A2: 50, B1: 50 });
    });

    it('ignores a stored mix that no longer balances', async () => {
      await AsyncStorage.setItem(MIX_KEY, JSON.stringify({ B1: 30 }));
      mockFeed.mockResolvedValue(page([item(1)]));

      await useWordFeedStore.getState().hydrate('B2', 'es');

      // Falls back to the level-derived default rather than a broken mix.
      expect(useWordFeedStore.getState().mix).toEqual({ A2: 0, B1: 0, B2: 70, C1: 30 });
    });

    it('seeds the first-run mix from the onboarding level', async () => {
      mockFeed.mockResolvedValue(page([item(1)]));
      await useWordFeedStore.getState().hydrate('A2', 'es');
      expect(useWordFeedStore.getState().mix).toEqual({ A2: 70, B1: 20, B2: 10, C1: 0 });
    });
  });

  describe('favourite', () => {
    it('fills the heart before the request resolves', async () => {
      let resolve!: (v: unknown) => void;
      mockSave.mockReturnValue(new Promise((r) => { resolve = r; }));

      const pending = useWordFeedStore.getState().favourite(item(1));
      expect(useWordFeedStore.getState().saved.has(1)).toBe(true);

      resolve({ saved: true, word: 'word1' });
      await pending;
      expect(useWordFeedStore.getState().saved.has(1)).toBe(true);
    });

    it('rolls back when the save fails', async () => {
      mockSave.mockRejectedValue(new Error('500'));

      await useWordFeedStore.getState().favourite(item(1));

      expect(useWordFeedStore.getState().saved.has(1)).toBe(false);
    });

    it('rolls back an un-save failure too, restoring the filled heart', async () => {
      mockSave.mockResolvedValue({ saved: true, word: 'word1' });
      await useWordFeedStore.getState().favourite(item(1));

      mockSave.mockRejectedValue(new Error('500'));
      await useWordFeedStore.getState().favourite(item(1));

      expect(useWordFeedStore.getState().saved.has(1)).toBe(true);
    });

    it('trusts the server toggle over the optimistic guess', async () => {
      // The endpoint is a toggle: if it reports "not saved", believe it.
      mockSave.mockResolvedValue({ saved: false, word: 'word1' });

      await useWordFeedStore.getState().favourite(item(1));

      expect(useWordFeedStore.getState().saved.has(1)).toBe(false);
    });

    it('logs the save with feed provenance for the difficulty aggregate', async () => {
      mockSave.mockResolvedValue({ saved: true, word: 'word1' });

      await useWordFeedStore.getState().favourite(item(1, 'B2'));

      expect(mockLog).toHaveBeenCalledWith(
        'word1',
        'WORD_SAVE',
        null,
        { lemma_id: 1, cefr: 'B2', source: 'feed' },
      );
    });

    it('logs an un-save distinctly', async () => {
      mockSave.mockResolvedValue({ saved: false, word: 'word1' });
      await useWordFeedStore.getState().favourite(item(1));
      expect(mockLog).toHaveBeenCalledWith(
        'word1', 'WORD_UNSAVE', null, expect.objectContaining({ source: 'feed' }),
      );
    });

    it('does not log when the request failed', async () => {
      mockSave.mockRejectedValue(new Error('500'));
      await useWordFeedStore.getState().favourite(item(1));
      expect(mockLog).not.toHaveBeenCalled();
    });
  });

  describe('flip logging', () => {
    it('logs a translation reveal with feed provenance', () => {
      logFeedFlip(item(3, 'C1'));
      expect(mockLog).toHaveBeenCalledWith(
        'word3',
        'TRANSLATION_VIEW',
        null,
        { lemma_id: 3, cefr: 'C1', source: 'feed' },
      );
    });
  });
});
