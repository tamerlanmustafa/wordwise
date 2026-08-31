import AsyncStorage from '@react-native-async-storage/async-storage';

// The store touches exactly two API surfaces: the feed page and the word
// save/interaction log.
jest.mock('../../services/api', () => ({
  srsApi: { feed: jest.fn() },
  wordwiseApi: { saveWord: jest.fn(), logInteraction: jest.fn() },
}));

import {
  useWordFeedStore,
  FEED_PAGE_SIZE,
  BUFFER_LIMIT,
  BUFFER_TTL_MS,
  logFeedFlip,
} from '../wordFeedStore';
import { srsApi, wordwiseApi, type FeedItem } from '../../services/api';
import { useListsStore } from '../listsStore';

const MIX_KEY = 'feedLevelMix';
const BUFFER_KEY = 'feedBuffer.v1';

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
  // Null is the honest default for a fixture: most lemmas have no definition
  // until the definition worker reaches them, and the card must render fine
  // either way.
  definition: null,
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

/** What `persistBuffer` writes. `lang` must match what hydrate was handed. */
const buffered = (items: FeedItem[], lang: string | null = 'es', savedAt = Date.now()) =>
  JSON.stringify({ lang, savedAt, items });

const ids = () => useWordFeedStore.getState().items.map((i) => i.lemma_id);

const readBuffer = async () => JSON.parse((await AsyncStorage.getItem(BUFFER_KEY))!);

const seedOf = (call: number) => mockFeed.mock.calls[call][0].seed as string;

describe('wordFeedStore', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    useWordFeedStore.getState().reset();
    useWordFeedStore.setState({ mix: { A2: 0, B1: 70, B2: 20, C1: 10 } });
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

  describe('instant open (disk buffer)', () => {
    it('shows the buffered cards before the request resolves', async () => {
      await AsyncStorage.setItem(BUFFER_KEY, buffered([item(1), item(2)]));
      // A request that never settles: whatever is on screen came from disk.
      mockFeed.mockReturnValue(new Promise(() => {}));

      const pending = useWordFeedStore.getState().hydrate('B1', 'es');
      await flush();

      expect(ids().sort()).toEqual([1, 2]);
      expect(useWordFeedStore.getState().hydrated).toBe(true);
      void pending;
    });

    it('appends the fetched page behind the buffer so nothing on screen moves', async () => {
      await AsyncStorage.setItem(BUFFER_KEY, buffered([item(1), item(2)]));
      mockFeed.mockResolvedValue(page([item(3)]));

      await useWordFeedStore.getState().hydrate('B1', 'es');

      expect(ids().slice(-1)).toEqual([3]);
      expect(ids()).toHaveLength(3);
    });

    it('drops a fetched card the buffer is already showing', async () => {
      await AsyncStorage.setItem(BUFFER_KEY, buffered([item(1), item(2)]));
      mockFeed.mockResolvedValue(page([item(2), item(3)]));

      await useWordFeedStore.getState().hydrate('B1', 'es');

      expect(ids().sort()).toEqual([1, 2, 3]);
    });

    it('ignores a buffer translated into a different language', async () => {
      await AsyncStorage.setItem(BUFFER_KEY, buffered([item(1)], 'es'));
      mockFeed.mockResolvedValue(page([item(9)]));

      await useWordFeedStore.getState().hydrate('B1', 'tr');

      expect(ids()).toEqual([9]);
    });

    it('ignores a buffer past its TTL', async () => {
      const stale = Date.now() - BUFFER_TTL_MS - 1;
      await AsyncStorage.setItem(BUFFER_KEY, buffered([item(1)], 'es', stale));
      mockFeed.mockResolvedValue(page([item(9)]));

      await useWordFeedStore.getState().hydrate('B1', 'es');

      expect(ids()).toEqual([9]);
    });

    it('falls back to a normal cold start on an unreadable buffer', async () => {
      await AsyncStorage.setItem(BUFFER_KEY, 'not json');
      mockFeed.mockResolvedValue(page([item(9)]));

      await useWordFeedStore.getState().hydrate('B1', 'es');

      expect(ids()).toEqual([9]);
    });

    it('writes the page to disk for the next launch', async () => {
      mockFeed.mockResolvedValue(page([item(1), item(2)]));

      await useWordFeedStore.getState().hydrate('B1', 'es');
      await flush();

      const stored = await readBuffer();
      expect(stored.lang).toBe('es');
      expect(stored.items.map((i: FeedItem) => i.lemma_id)).toEqual([1, 2]);
    });

    it('keeps only the newest cards, so the buffer rotates', async () => {
      const many = Array.from({ length: BUFFER_LIMIT + 5 }, (_, n) => item(n + 1));
      mockFeed.mockResolvedValue(page(many));

      await useWordFeedStore.getState().hydrate('B1', 'es');
      await flush();

      const stored = await readBuffer();
      expect(stored.items).toHaveLength(BUFFER_LIMIT);
      // The tail, not the head — the oldest five are the ones dropped.
      expect(stored.items[0].lemma_id).toBe(6);
    });

    it('keeps a saved word out of the buffer so it does not come back', async () => {
      mockFeed.mockResolvedValue(page([item(1), item(2)]));
      await useWordFeedStore.getState().hydrate('B1', 'es');

      mockSave.mockResolvedValue({ saved: true, word: 'word1' });
      await useWordFeedStore.getState().favourite(item(1));
      await flush();

      const stored = await readBuffer();
      expect(stored.items.map((i: FeedItem) => i.lemma_id)).toEqual([2]);
    });

    it('hydrates once when boot and the screen both ask in the same tick', async () => {
      mockFeed.mockResolvedValue(page([item(1)]));

      await Promise.all([
        useWordFeedStore.getState().hydrate('B1', 'es'),
        useWordFeedStore.getState().hydrate('B1', 'es'),
      ]);

      expect(mockFeed).toHaveBeenCalledTimes(1);
    });
  });

  describe('per-launch shuffle seed', () => {
    it('sends one seed and reuses it for every page of the session', async () => {
      mockFeed.mockResolvedValue(page([item(1)]));
      await useWordFeedStore.getState().hydrate('B1', 'es');
      mockFeed.mockResolvedValue(page([item(2)]));
      await useWordFeedStore.getState().fetchNext();

      expect(seedOf(0)).toBeTruthy();
      // Paging only addresses a stable sequence while the seed holds still.
      expect(seedOf(1)).toBe(seedOf(0));
    });

    it('mints a new seed on the next cold start', async () => {
      mockFeed.mockResolvedValue(page([item(1)]));
      await useWordFeedStore.getState().hydrate('B1', 'es');
      const first = seedOf(0);

      useWordFeedStore.getState().reset();
      await useWordFeedStore.getState().hydrate('B1', 'es');

      expect(seedOf(1)).not.toBe(first);
    });

    it('re-cuts the deck when the mix changes', async () => {
      mockFeed.mockResolvedValue(page([item(1)]));
      await useWordFeedStore.getState().hydrate('B1', 'es');
      const first = seedOf(0);

      await useWordFeedStore.getState().setMix({ A2: 0, B1: 0, B2: 0, C1: 100 });

      expect(seedOf(1)).not.toBe(first);
    });

    it('clears the buffer on a mix change so the old levels do not return', async () => {
      mockFeed.mockResolvedValue(page([item(1)]));
      await useWordFeedStore.getState().hydrate('B1', 'es');
      await flush();
      expect(await AsyncStorage.getItem(BUFFER_KEY)).not.toBeNull();

      mockFeed.mockReturnValue(new Promise(() => {}));
      void useWordFeedStore.getState().setMix({ A2: 0, B1: 0, B2: 0, C1: 100 });
      await flush();

      expect(await AsyncStorage.getItem(BUFFER_KEY)).toBeNull();
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

    it('keeps the deck when Done commits a mix that did not change', async () => {
      mockFeed.mockResolvedValue(page([item(1), item(2)]));
      await useWordFeedStore.getState().fetchNext();
      useWordFeedStore.getState().setActiveIndex(1);
      mockFeed.mockClear();

      // What the panel emits for the legacy four-level mix the store holds:
      // same feed, six-level shape. Opening the panel and tapping Done must
      // not throw away the deck or the user's place in it.
      await useWordFeedStore.getState().setMix({
        A1: 0, A2: 0, B1: 70, B2: 20, C1: 10, C2: 0,
      });

      expect(mockFeed).not.toHaveBeenCalled();
      expect(ids()).toEqual([1, 2]);
      expect(useWordFeedStore.getState().activeIndex).toBe(1);
    });

    it('still persists an unchanged mix, which a first run has never written', async () => {
      // The in-memory mix on a first run is a default nobody stored, so the
      // write has to happen before the no-change bail.
      expect(await AsyncStorage.getItem(MIX_KEY)).toBeNull();

      await useWordFeedStore.getState().setMix({
        A1: 0, A2: 0, B1: 70, B2: 20, C1: 10, C2: 0,
      });

      expect(JSON.parse((await AsyncStorage.getItem(MIX_KEY))!)).toEqual({
        A1: 0, A2: 0, B1: 70, B2: 20, C1: 10, C2: 0,
      });
      expect(mockFeed).not.toHaveBeenCalled();
    });

    it('still reloads on a one-percent change', async () => {
      // The drag commits whole percents, so this is the smallest real edit.
      // A dedupe that swallowed it would strand the user on the old deck.
      mockFeed.mockResolvedValue(page([item(1)]));
      await useWordFeedStore.getState().fetchNext();
      mockFeed.mockClear();
      mockFeed.mockResolvedValue(page([item(9)]));

      await useWordFeedStore.getState().setMix({
        A1: 0, A2: 0, B1: 69, B2: 21, C1: 10, C2: 0,
      });

      expect(mockFeed).toHaveBeenCalledWith(expect.objectContaining({ offset: 0 }));
      expect(ids()).toEqual([9]);
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

    it('carries a four-level mix from the previous build through unchanged', async () => {
      // The literal value the four-level panel wrote. A1 and C2 are simply
      // absent; they read as 0, so it still totals 100 and must survive the
      // upgrade untouched — resetting it would throw away a choice the user
      // made, and every existing install has one of these on disk.
      await AsyncStorage.setItem(MIX_KEY, '{"A2":0,"B1":70,"B2":20,"C1":10}');
      mockFeed.mockResolvedValue(page([item(1)]));

      await useWordFeedStore.getState().hydrate('B2', 'es');

      expect(useWordFeedStore.getState().mix).toEqual({ A2: 0, B1: 70, B2: 20, C1: 10 });
    });

    it('recovers a stored mix that no longer balances instead of discarding it', async () => {
      // The old panel's legal-but-unsendable state. Scaled and snapped back to
      // 100 with its shape intact, rather than replaced by the default.
      await AsyncStorage.setItem(MIX_KEY, JSON.stringify({ B1: 30 }));
      mockFeed.mockResolvedValue(page([item(1)]));

      await useWordFeedStore.getState().hydrate('B2', 'es');

      expect(useWordFeedStore.getState().mix).toEqual({
        A1: 0, A2: 0, B1: 100, B2: 0, C1: 0, C2: 0,
      });
    });

    it('seeds the first-run mix from the onboarding level', async () => {
      mockFeed.mockResolvedValue(page([item(1)]));
      await useWordFeedStore.getState().hydrate('A2', 'es');
      expect(useWordFeedStore.getState().mix).toEqual({
        A1: 0, A2: 70, B1: 20, B2: 10, C1: 0, C2: 0,
      });
    });

    it('seeds an A1 user on A1, now that the mix reaches that far down', async () => {
      mockFeed.mockResolvedValue(page([item(1)]));
      await useWordFeedStore.getState().hydrate('A1', 'es');
      expect(useWordFeedStore.getState().mix).toEqual({
        A1: 70, A2: 20, B1: 10, B2: 0, C1: 0, C2: 0,
      });
    });

    it('accepts a single-level mix at either end of the range', async () => {
      mockFeed.mockResolvedValue(page([item(1)]));

      await useWordFeedStore.getState().setMix({ A1: 100, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 });
      expect(useWordFeedStore.getState().mix.A1).toBe(100);

      await useWordFeedStore.getState().setMix({ A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 100 });
      expect(useWordFeedStore.getState().mix.C2).toBe(100);
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

  describe('list membership', () => {
    const MEMBERSHIP_KEY = 'feedListMembership.v1';
    let mockAdd: jest.Mock;
    let mockRemove: jest.Mock;

    beforeEach(() => {
      mockAdd = jest.fn().mockResolvedValue(undefined);
      mockRemove = jest.fn().mockResolvedValue(undefined);
      useListsStore.setState({ addItems: mockAdd, removeItem: mockRemove });
    });

    const membership = () => useWordFeedStore.getState().listMembership;

    it('adds the word to a list and ticks it immediately', async () => {
      await useWordFeedStore.getState().toggleList(item(1), 10);

      expect(mockAdd).toHaveBeenCalledWith(10, {
        words: [{ word: 'word1', lemma_id: 1 }],
      });
      expect(membership()[1]).toEqual([10]);
    });

    it('is set membership, not assignment — a word can be in several lists', async () => {
      await useWordFeedStore.getState().toggleList(item(1), 10);
      await useWordFeedStore.getState().toggleList(item(1), 20);

      expect(membership()[1]).toEqual([10, 20]);
    });

    it('untoggles just the one list, leaving the others alone', async () => {
      await useWordFeedStore.getState().toggleList(item(1), 10);
      await useWordFeedStore.getState().toggleList(item(1), 20);

      await useWordFeedStore.getState().toggleList(item(1), 10);

      // Word lists key their items on the word, not the lemma id.
      expect(mockRemove).toHaveBeenCalledWith(10, 'word1');
      expect(membership()[1]).toEqual([20]);
    });

    it('keeps each word’s membership separate', async () => {
      await useWordFeedStore.getState().toggleList(item(1), 10);
      await useWordFeedStore.getState().toggleList(item(2), 20);

      expect(membership()[1]).toEqual([10]);
      expect(membership()[2]).toEqual([20]);
    });

    it('ticks optimistically, before the request resolves', async () => {
      let resolve!: () => void;
      mockAdd.mockReturnValue(new Promise<void>((r) => { resolve = r; }));

      const pending = useWordFeedStore.getState().toggleList(item(1), 10);
      expect(membership()[1]).toEqual([10]);

      resolve();
      await pending;
      expect(membership()[1]).toEqual([10]);
    });

    it('rolls the tick back when the add fails', async () => {
      mockAdd.mockRejectedValue(new Error('500'));

      await useWordFeedStore.getState().toggleList(item(1), 10);

      expect(membership()[1] ?? []).toEqual([]);
    });

    it('restores the tick when a remove fails', async () => {
      await useWordFeedStore.getState().toggleList(item(1), 10);
      mockRemove.mockRejectedValue(new Error('500'));

      await useWordFeedStore.getState().toggleList(item(1), 10);

      expect(membership()[1]).toEqual([10]);
    });

    it('survives a relaunch so the rail label is right on cold start', async () => {
      await useWordFeedStore.getState().toggleList(item(1), 10);
      await flush();
      expect(JSON.parse((await AsyncStorage.getItem(MEMBERSHIP_KEY))!)).toEqual({ 1: [10] });

      mockFeed.mockResolvedValue(page([item(1)]));
      useWordFeedStore.getState().reset();
      await useWordFeedStore.getState().hydrate('B1', 'es');

      expect(membership()[1]).toEqual([10]);
    });

    it('prunes emptied entries rather than storing dead keys', async () => {
      await useWordFeedStore.getState().toggleList(item(1), 10);
      await useWordFeedStore.getState().toggleList(item(1), 10);
      await flush();

      expect(JSON.parse((await AsyncStorage.getItem(MEMBERSHIP_KEY))!)).toEqual({});
    });

    it('logs the add with feed provenance and the list it went to', async () => {
      await useWordFeedStore.getState().toggleList(item(1, 'B2'), 10);

      expect(mockLog).toHaveBeenCalledWith(
        'word1',
        'WORD_SAVE',
        null,
        { lemma_id: 1, cefr: 'B2', source: 'feed', list_id: 10 },
      );
    });

    it('does not log when the request failed', async () => {
      mockAdd.mockRejectedValue(new Error('500'));
      await useWordFeedStore.getState().toggleList(item(1), 10);
      expect(mockLog).not.toHaveBeenCalled();
    });
  });

  describe('panels', () => {
    it('opens one panel at a time — they share a lane', () => {
      useWordFeedStore.getState().setPanelOpen('mix');
      expect(useWordFeedStore.getState().openPanel).toBe('mix');

      useWordFeedStore.getState().setPanelOpen('list');
      expect(useWordFeedStore.getState().openPanel).toBe('list');

      useWordFeedStore.getState().setPanelOpen(null);
      expect(useWordFeedStore.getState().openPanel).toBeNull();
    });
  });
});
