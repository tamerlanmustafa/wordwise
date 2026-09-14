/**
 * A deleted list stays deleted, whichever order the responses arrive in.
 *
 * Found on device while checking the delete flow end to end. Deleting a list
 * returns to the index before the request resolves, and returning to the index
 * refreshes it. The refresh reached the server BEFORE the delete committed, and
 * its response — still containing the list — was applied after. Result: the
 * toast said "List deleted", the server answered 404, and the row sat in the
 * index, tappable, opening a list that no longer existed.
 *
 * Both orderings are pinned, because the obvious fix ("ignore it while the
 * delete is in flight") only covers one: the stale response can just as easily
 * land after the delete has already resolved.
 */

jest.mock('../../services/api', () => ({
  ListApiError: class extends Error {},
  listsApi: {
    list: jest.fn(),
    detail: jest.fn(),
    create: jest.fn(),
    rename: jest.fn(),
    remove: jest.fn(),
    addItems: jest.fn(),
    removeItem: jest.fn(),
    reorder: jest.fn(),
  },
}));

jest.mock('../toastStore', () => ({ showToast: jest.fn() }));

import type { ListSummary } from '../../core/types';
import { listsApi } from '../../services/api';
import { useListsStore } from '../listsStore';

const api = listsApi as unknown as Record<string, jest.Mock>;
const state = () => useListsStore.getState();
const names = () => state().lists.map((l) => l.name);

const row = (id: number, name: string): ListSummary => ({
  id,
  name,
  kind: 'words',
  systemKey: id === 2 ? 'favourites' : null,
  count: 2,
  totalWords: null,
  preview: { posters: null, words: null },
  updatedAt: 'x',
});

const FAVS = row(2, 'Favourites');
const WEEKEND = row(503, 'Weekend words');

/** A promise the test resolves by hand, to choose the arrival order. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.clearAllMocks();
  state().reset();
  useListsStore.setState({ lists: [FAVS, WEEKEND], status: 'ready', hydrated: true });
});

describe('a refresh that read the server before the delete committed', () => {
  it('cannot resurrect the list when it lands WHILE the delete is in flight', async () => {
    const del = deferred<void>();
    api.remove.mockReturnValue(del.promise);
    api.list.mockResolvedValue([FAVS, WEEKEND]); // the stale snapshot

    const destroying = state().destroy(503);
    await state().fetchLists(); // lands first
    expect(names()).toEqual(['Favourites']);

    del.resolve();
    await expect(destroying).resolves.toBe(true);
    expect(names()).toEqual(['Favourites']);
  });

  it('cannot resurrect the list when it lands AFTER the delete resolved', async () => {
    // The ordering that defeats an "in flight" flag, and the one that was
    // actually observed on device.
    const read = deferred<ListSummary[]>();
    api.list.mockReturnValue(read.promise);
    api.remove.mockResolvedValue(undefined);

    const refreshing = state().fetchLists(); // request out first...
    await state().destroy(503); // ...delete resolves...
    read.resolve([FAVS, WEEKEND]); // ...stale response lands last
    await refreshing;

    expect(names()).toEqual(['Favourites']);
  });

  it('does not write the resurrected list into the on-disk cache either', async () => {
    // Otherwise the next cold start would paint the deleted list from cache.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cache = require('../../services/swrCache') as typeof import('../../services/swrCache');
    const write = jest.spyOn(cache, 'writeCache');
    api.remove.mockResolvedValue(undefined);
    await state().destroy(503);
    api.list.mockResolvedValue([FAVS, WEEKEND]);
    await state().fetchLists();
    const written = write.mock.calls.at(-1)?.[1] as ListSummary[];
    expect(written.map((l) => l.id)).toEqual([2]);
  });
});

describe('when the delete fails', () => {
  it('brings the row back, and stops hiding it from later refreshes', async () => {
    api.remove.mockRejectedValue(new Error('500'));
    await expect(state().destroy(503)).resolves.toBe(false);
    expect(names()).toEqual(['Favourites', 'Weekend words']);

    api.list.mockResolvedValue([FAVS, WEEKEND]);
    await state().fetchLists();
    expect(names()).toEqual(['Favourites', 'Weekend words']);
  });

  it('restores just that row, keeping what a refresh brought in meanwhile', async () => {
    const del = deferred<void>();
    api.remove.mockReturnValue(del.promise);
    const NEW = row(600, 'Made on the iPad');
    api.list.mockResolvedValue([FAVS, WEEKEND, NEW]);

    const destroying = state().destroy(503);
    await state().fetchLists();
    del.reject(new Error('500'));
    await destroying;

    // Restoring the whole pre-delete array would have dropped the new list.
    expect(names()).toEqual(expect.arrayContaining(['Favourites', 'Weekend words', 'Made on the iPad']));
  });
});

describe('a list being created while the index refreshes', () => {
  it('keeps its optimistic row, so the create can still land', async () => {
    const created = deferred<ListSummary>();
    api.create.mockReturnValue(created.promise);
    api.list.mockResolvedValue([FAVS, WEEKEND]); // the server has not heard of it yet

    const creating = state().create('Road trip', 'words');
    await state().fetchLists();
    expect(names()).toContain('Road trip');

    created.resolve(row(700, 'Road trip'));
    await creating;
    expect(state().lists.find((l) => l.name === 'Road trip')?.id).toBe(700);
  });
});

describe('sign-out', () => {
  it('forgets the tombstones along with the account', async () => {
    api.remove.mockResolvedValue(undefined);
    await state().destroy(503);
    state().reset();
    useListsStore.setState({ lists: [], status: 'ready', hydrated: true });
    api.list.mockResolvedValue([FAVS, WEEKEND]);
    await state().fetchLists();
    expect(names()).toEqual(['Favourites', 'Weekend words']);
  });
});
