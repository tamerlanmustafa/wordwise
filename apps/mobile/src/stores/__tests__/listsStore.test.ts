import AsyncStorage from '@react-native-async-storage/async-storage';

// Mock just the lists slice. ListApiError is a real class here because the
// store branches on `instanceof` to decide between a toast and a rethrow.
jest.mock('../../services/api', () => {
  class ListApiError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status: number) {
      super(message);
      this.name = 'ListApiError';
      this.code = code;
      this.status = status;
    }
  }
  return {
    ListApiError,
    listsApi: {
      list: jest.fn(),
      detail: jest.fn(),
      create: jest.fn(),
      rename: jest.fn(),
      remove: jest.fn(),
      addItems: jest.fn(),
      removeItem: jest.fn(),
      reorder: jest.fn(),
      practice: jest.fn(),
    },
  };
});

import { useListsStore } from '../listsStore';
import { listsApi, ListApiError } from '../../services/api';
import type { ListSummary } from '../../core/types';

const flush = () => new Promise<void>((r) => setImmediate(r));

const mockList = listsApi.list as jest.Mock;
const mockCreate = listsApi.create as jest.Mock;
const mockRemove = listsApi.remove as jest.Mock;
const mockRemoveItem = listsApi.removeItem as jest.Mock;
const mockAddItems = listsApi.addItems as jest.Mock;
const mockDetail = listsApi.detail as jest.Mock;

function summary(over: Partial<ListSummary> = {}): ListSummary {
  return {
    id: 30,
    name: 'Film noir',
    kind: 'films',
    systemKey: null,
    count: 3,
    dueCount: null,
    totalWords: 1200,
    preview: { posters: ['/a.jpg'], words: null },
    updatedAt: '2026-08-16T00:00:00Z',
    ...over,
  };
}

const REEL = summary({ id: 12, systemKey: 'reel', name: 'Saved from Home' });
const FAVS = summary({
  id: 11, kind: 'words', systemKey: 'favourites', name: 'Favourites',
  count: 8, dueCount: 2, totalWords: null,
  preview: { posters: null, words: ['reluctant'] },
});

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  useListsStore.setState({
    lists: [], byId: {}, status: 'idle', loadError: false,
    error: null, activeKind: 'films', hydrated: false,
  });
});

describe('fetchLists', () => {
  it('stores the index and clears the error flag', async () => {
    mockList.mockResolvedValue([REEL, FAVS]);
    await useListsStore.getState().fetchLists();
    expect(useListsStore.getState().lists).toHaveLength(2);
    expect(useListsStore.getState().loadError).toBe(false);
    expect(useListsStore.getState().status).toBe('ready');
  });

  it('keeps cached lists on screen when a refresh fails', async () => {
    // §8 — never blank a populated list because a refetch failed. An empty
    // array plus loadError means "we don't know", not "you have none".
    mockList.mockResolvedValueOnce([REEL, FAVS]);
    await useListsStore.getState().fetchLists();

    mockList.mockRejectedValueOnce(new Error('offline'));
    await useListsStore.getState().fetchLists();

    expect(useListsStore.getState().lists).toHaveLength(2);
    expect(useListsStore.getState().loadError).toBe(true);
  });
});

describe('activeKind', () => {
  it('persists the selected segment so the tab reopens where it was left', async () => {
    useListsStore.getState().setActiveKind('words');
    await flush();
    expect(await AsyncStorage.getItem('lists.activeKind.v1')).toBe('words');
  });

  it('restores the persisted segment on hydrate', async () => {
    await AsyncStorage.setItem('lists.activeKind.v1', 'words');
    mockList.mockResolvedValue([]);
    await useListsStore.getState().hydrate();
    expect(useListsStore.getState().activeKind).toBe('words');
  });

  it('falls back to films when nothing is stored', async () => {
    mockList.mockResolvedValue([]);
    await useListsStore.getState().hydrate();
    expect(useListsStore.getState().activeKind).toBe('films');
  });
});

describe('create', () => {
  it('shows an optimistic row immediately and swaps in the server row', async () => {
    mockCreate.mockResolvedValue(summary({ id: 99, name: 'Noir' }));
    const promise = useListsStore.getState().create('Noir', 'films');

    // Before the request resolves, a temp row is already on screen. Its id is
    // negative so it can never collide with a real server id.
    expect(useListsStore.getState().lists).toHaveLength(1);
    expect(useListsStore.getState().lists[0].id).toBeLessThan(0);

    await promise;
    expect(useListsStore.getState().lists).toEqual([summary({ id: 99, name: 'Noir' })]);
  });

  it('drops the temp row and rethrows so the sheet can field the error', async () => {
    // A duplicate name belongs on the sheet's name input, not in a toast, so
    // the store must not swallow it.
    mockCreate.mockRejectedValue(new ListApiError('duplicate_name', 'Taken', 409));

    await expect(useListsStore.getState().create('Film noir', 'films'))
      .rejects.toMatchObject({ code: 'duplicate_name' });

    expect(useListsStore.getState().lists).toEqual([]);
  });

  it('gives consecutive optimistic rows distinct ids', async () => {
    mockCreate.mockRejectedValue(new ListApiError('duplicate_name', 'Taken', 409));
    const ids: number[] = [];
    for (const name of ['a', 'b']) {
      const p = useListsStore.getState().create(name, 'films');
      ids.push(useListsStore.getState().lists[0].id);
      await p.catch(() => {});
    }
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe('removeItem', () => {
  beforeEach(() => {
    useListsStore.setState({
      lists: [summary({ id: 30, count: 2 })],
      byId: {
        30: {
          summary: summary({ id: 30, count: 2 }),
          items: [
            { tmdbId: 238, title: 'A', posterPath: null, year: null, rating: null, cefr: null, wordCount: null, addedAt: 'x' },
            { tmdbId: 240, title: 'B', posterPath: null, year: null, rating: null, cefr: null, wordCount: null, addedAt: 'x' },
          ],
          nextCursor: null,
        },
      },
    });
  });

  it('drops the item and decrements the count immediately', async () => {
    mockRemoveItem.mockResolvedValue(undefined);
    await useListsStore.getState().removeItem(30, 238);
    expect(useListsStore.getState().byId[30].items).toHaveLength(1);
    expect(useListsStore.getState().lists[0].count).toBe(1);
  });

  it('rolls back the item AND the count when the request is rejected', async () => {
    mockRemoveItem.mockRejectedValue(new ListApiError('unknown', 'nope', 500));
    await useListsStore.getState().removeItem(30, 238);

    expect(useListsStore.getState().byId[30].items).toHaveLength(2);
    expect(useListsStore.getState().lists[0].count).toBe(2);
  });

  it('matches word items by word rather than tmdb id', async () => {
    useListsStore.setState({
      lists: [summary({ id: 11, kind: 'words', count: 2 })],
      byId: {
        11: {
          summary: summary({ id: 11, kind: 'words', count: 2 }),
          items: [
            { word: 'reluctant', lemmaId: null, pos: null, cefr: null, srsState: 'new', nextReviewAt: null, addedAt: 'x' },
            { word: 'glimpse', lemmaId: null, pos: null, cefr: null, srsState: 'new', nextReviewAt: null, addedAt: 'x' },
          ],
          nextCursor: null,
        },
      },
    });
    mockRemoveItem.mockResolvedValue(undefined);
    await useListsStore.getState().removeItem(11, 'reluctant');
    expect(useListsStore.getState().byId[11].items).toEqual([
      expect.objectContaining({ word: 'glimpse' }),
    ]);
  });
});

describe('destroy', () => {
  it('restores the list when the delete fails', async () => {
    useListsStore.setState({ lists: [REEL, summary({ id: 30 })] });
    mockRemove.mockRejectedValue(new ListApiError('unknown', 'nope', 500));

    await useListsStore.getState().destroy(30);

    expect(useListsStore.getState().lists.map((l) => l.id)).toEqual([12, 30]);
  });

  it('drops the cached detail page on success', async () => {
    useListsStore.setState({
      lists: [summary({ id: 30 })],
      byId: { 30: { summary: summary({ id: 30 }), items: [], nextCursor: null } },
    });
    mockRemove.mockResolvedValue(undefined);

    await useListsStore.getState().destroy(30);

    expect(useListsStore.getState().lists).toEqual([]);
    expect(useListsStore.getState().byId[30]).toBeUndefined();
  });
});

describe('addItems', () => {
  it('bumps the count optimistically and adopts the server summary', async () => {
    useListsStore.setState({ lists: [summary({ id: 30, count: 3 })] });
    mockAddItems.mockResolvedValue(summary({ id: 30, count: 4 }));

    await useListsStore.getState().addItems(30, {
      films: [{ tmdb_id: 1, title: 'x', poster_path: null, year: null }],
    });

    expect(useListsStore.getState().lists[0].count).toBe(4);
  });

  it('rolls the count back when the add fails', async () => {
    useListsStore.setState({ lists: [summary({ id: 30, count: 3 })] });
    mockAddItems.mockRejectedValue(new ListApiError('unknown', 'nope', 500));

    await useListsStore.getState().addItems(30, {
      films: [{ tmdb_id: 1, title: 'x', poster_path: null, year: null }],
    });

    expect(useListsStore.getState().lists[0].count).toBe(3);
  });

  it('invalidates the cached page so the next open re-reads the order', async () => {
    useListsStore.setState({
      lists: [summary({ id: 30, count: 3 })],
      byId: { 30: { summary: summary({ id: 30 }), items: [], nextCursor: null } },
    });
    mockAddItems.mockResolvedValue(summary({ id: 30, count: 4 }));

    await useListsStore.getState().addItems(30, {
      films: [{ tmdb_id: 1, title: 'x', poster_path: null, year: null }],
    });

    expect(useListsStore.getState().byId[30]).toBeUndefined();
  });
});

describe('syncFromReel', () => {
  it('refreshes only the reel-backed row', async () => {
    // The reel is the one list that can drift while the user is on Home, so
    // it is the only one worth re-reading on focus.
    useListsStore.setState({ lists: [REEL, summary({ id: 30 })] });
    mockDetail.mockResolvedValue({
      summary: { ...REEL, count: 6 },
      items: [],
      nextCursor: null,
    });

    await useListsStore.getState().syncFromReel();

    expect(mockDetail).toHaveBeenCalledTimes(1);
    expect(mockDetail).toHaveBeenCalledWith(12);
    expect(useListsStore.getState().lists[0].count).toBe(6);
  });

  it('leaves the row alone when the refresh fails', async () => {
    useListsStore.setState({ lists: [REEL] });
    mockDetail.mockRejectedValue(new Error('offline'));

    await useListsStore.getState().syncFromReel();

    expect(useListsStore.getState().lists[0].count).toBe(REEL.count);
  });

  it('is a no-op when the index has no reel row yet', async () => {
    useListsStore.setState({ lists: [summary({ id: 30 })] });
    await useListsStore.getState().syncFromReel();
    expect(mockDetail).not.toHaveBeenCalled();
  });
});

describe('reorder', () => {
  it('reorders locally and rolls back on failure', async () => {
    const a = summary({ id: 1 });
    const b = summary({ id: 2 });
    const c = summary({ id: 3 });
    useListsStore.setState({ lists: [a, b, c] });
    (listsApi.reorder as jest.Mock).mockRejectedValue(new Error('nope'));

    await useListsStore.getState().reorder([3, 1, 2]);

    expect(useListsStore.getState().lists.map((l) => l.id)).toEqual([1, 2, 3]);
  });
});
