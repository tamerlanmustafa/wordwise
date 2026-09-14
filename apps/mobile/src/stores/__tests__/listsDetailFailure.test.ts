/**
 * An open list that cannot load says so, and the index behind it stays quiet.
 *
 * Measured on device with the API stopped: a list opened offline showed its
 * skeleton for 15 seconds and counting — no error, no retry. The screen's
 * "loading" test was simply "no page yet", and a failed fetch set the INDEX's
 * failure flag rather than anything the open list could read. So the list
 * shimmered for ever, and the index behind it grew a connection strip for a
 * request it never made.
 *
 * Also pinned here: the index now refreshes on every focus, a delete reports
 * whether it actually happened, and a rename reaches the open list's header.
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

const row = (over: Partial<ListSummary> = {}): ListSummary => ({
  id: 2,
  name: 'Favourites',
  kind: 'words',
  systemKey: 'favourites',
  count: 7,
  totalWords: null,
  preview: { posters: null, words: null },
  updatedAt: 'x',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  state().reset();
  useListsStore.setState({ lists: [row()], status: 'ready' });
});

describe('a list that cannot load', () => {
  it('records the failure against THAT list', async () => {
    api.detail.mockRejectedValue(new TypeError('Network request failed'));
    await state().fetchDetail(2);
    expect(state().detailFailure[2]).toBe('offline');
  });

  it('leaves the index’s own failure flag alone', async () => {
    api.detail.mockRejectedValue(new TypeError('Network request failed'));
    await state().fetchDetail(2);
    expect(state().loadError).toBe(false);
    expect(state().failure).toBeNull();
  });

  it('clears the failure when a retry succeeds', async () => {
    api.detail.mockRejectedValueOnce(new TypeError('Network request failed'));
    await state().fetchDetail(2);
    api.detail.mockResolvedValueOnce({ summary: row(), items: [], nextCursor: null });
    await state().fetchDetail(2);
    expect(state().detailFailure[2]).toBeUndefined();
    expect(state().byId[2]).toBeDefined();
  });

  it('does not clear another list’s failure', async () => {
    api.detail.mockRejectedValue(new TypeError('Network request failed'));
    await state().fetchDetail(9);
    api.detail.mockResolvedValue({ summary: row(), items: [], nextCursor: null });
    await state().fetchDetail(2);
    expect(state().detailFailure[9]).toBe('offline');
  });

  it('is cleared on sign-out', async () => {
    api.detail.mockRejectedValue(new TypeError('Network request failed'));
    await state().fetchDetail(2);
    state().reset();
    expect(state().detailFailure).toEqual({});
  });
});

describe('the index refresh', () => {
  it('keeps the same array when the server has nothing new', async () => {
    // Runs on every focus now. The same array is what stops backing out of a
    // list from re-rendering every row behind it.
    const before = state().lists;
    api.list.mockResolvedValue([row()]);
    await state().fetchLists();
    expect(state().lists).toBe(before);
  });

  it('picks up a count changed elsewhere', async () => {
    api.list.mockResolvedValue([row({ count: 8 })]);
    await state().fetchLists();
    expect(state().lists[0].count).toBe(8);
  });
});

describe('destroy', () => {
  it('reports success only once the server has deleted it', async () => {
    api.remove.mockResolvedValue(undefined);
    await expect(state().destroy(2)).resolves.toBe(true);
  });

  it('reports failure, so the screen does not claim "List deleted"', async () => {
    api.remove.mockRejectedValue(new Error('500'));
    await expect(state().destroy(2)).resolves.toBe(false);
    expect(state().lists).toHaveLength(1);
  });
});

describe('rename', () => {
  it('renames the open list’s header as well as the index row', async () => {
    useListsStore.setState({
      lists: [row({ id: 5, name: 'Trvael', systemKey: null })],
      byId: { 5: { summary: row({ id: 5, name: 'Trvael', systemKey: null }), items: [], nextCursor: null } },
    });
    api.rename.mockResolvedValue(row({ id: 5, name: 'Travel', systemKey: null }));
    await state().rename(5, 'Travel');
    expect(state().lists[0].name).toBe('Travel');
    expect(state().byId[5].summary.name).toBe('Travel');
  });

  it('rolls both back and rethrows, so a duplicate name lands on the field', async () => {
    useListsStore.setState({
      lists: [row({ id: 5, name: 'Food', systemKey: null })],
      byId: { 5: { summary: row({ id: 5, name: 'Food', systemKey: null }), items: [], nextCursor: null } },
    });
    api.rename.mockRejectedValue(Object.assign(new Error('dup'), { code: 'duplicate_name' }));
    await expect(state().rename(5, 'Travel')).rejects.toThrow();
    expect(state().lists[0].name).toBe('Food');
    expect(state().byId[5].summary.name).toBe('Food');
  });
});
