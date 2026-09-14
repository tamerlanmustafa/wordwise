/**
 * Removing from an open list can be undone.
 *
 * Before: one silent tap, the row gone, the request already sent, nothing on
 * the screen able to bring it back. On a list the user made, the control was
 * an empty heart that read as "favourite this" and deleted the word instead.
 *
 * After: the row goes at once; the DELETE waits out the toast; Undo cancels it
 * and puts the item back where it was. These tests walk the window with fake
 * timers — including the exits, which is where a deferred write goes wrong:
 * undo in the last instant, a refresh landing mid-window, the same item added
 * back from elsewhere, sign-out with a delete still waiting, and the list
 * itself being deleted underneath it.
 */

jest.mock('../../services/api', () => {
  class ListApiError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status: number) {
      super(message);
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
    },
  };
});

jest.mock('../toastStore', () => ({ showToast: jest.fn() }));

import type { ListDetail, ListSummary, ListWordItem } from '../../core/types';
import { listsApi } from '../../services/api';
import { showToast } from '../toastStore';
import { REMOVE_UNDO_MS, useListsStore } from '../listsStore';
import { t } from '../../i18n';

const api = listsApi as unknown as Record<string, jest.Mock>;

const word = (w: string): ListWordItem => ({
  word: w, lemmaId: null, pos: null, cefr: null, srsState: 'new', addedAt: 'x',
});

const summary = (over: Partial<ListSummary> = {}): ListSummary => ({
  id: 428,
  name: 'Travel',
  kind: 'words',
  systemKey: null,
  count: 3,
  totalWords: null,
  preview: { posters: null, words: null },
  updatedAt: 'x',
  ...over,
});

const page = (words: string[]): ListDetail => ({
  summary: summary({ count: words.length }),
  items: words.map(word),
  nextCursor: null,
});

/** Settle any promise chains the timer callbacks start. */
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

const state = () => useListsStore.getState();
const words = () => (state().byId[428].items as ListWordItem[]).map((i) => i.word);

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  state().reset();
  useListsStore.setState({
    lists: [summary({ count: 3 })],
    byId: { 428: page(['goulash', 'passport', 'luggage']) },
    status: 'ready',
  });
});

afterEach(() => {
  state().reset();
  jest.useRealTimers();
});

describe('the removal itself', () => {
  it('hides the item at once and sends nothing yet', () => {
    state().removeItemWithUndo(428, 'goulash');
    expect(words()).toEqual(['passport', 'luggage']);
    expect(api.removeItem).not.toHaveBeenCalled();
  });

  it('moves BOTH counts — the index row and the open list’s header', () => {
    // "3 WORDS" above two words was the header reading a summary nobody
    // updated.
    state().removeItemWithUndo(428, 'goulash');
    expect(state().lists[0].count).toBe(2);
    expect(state().byId[428].summary.count).toBe(2);
  });

  it('sends the delete once the window closes', async () => {
    api.removeItem.mockResolvedValue(undefined);
    state().removeItemWithUndo(428, 'goulash');
    jest.advanceTimersByTime(REMOVE_UNDO_MS);
    await flush();
    expect(api.removeItem).toHaveBeenCalledTimes(1);
    expect(api.removeItem).toHaveBeenCalledWith(428, 'goulash');
  });

  it('does not schedule a second delete for a second tap mid-window', async () => {
    api.removeItem.mockResolvedValue(undefined);
    state().removeItemWithUndo(428, 'goulash');
    state().removeItemWithUndo(428, 'goulash');
    jest.advanceTimersByTime(REMOVE_UNDO_MS);
    await flush();
    expect(api.removeItem).toHaveBeenCalledTimes(1);
  });
});

describe('undo', () => {
  it('puts the item back where it was, and both counts with it', () => {
    const undo = state().removeItemWithUndo(428, 'passport');
    undo();
    expect(words()).toEqual(['goulash', 'passport', 'luggage']);
    expect(state().lists[0].count).toBe(3);
    expect(state().byId[428].summary.count).toBe(3);
  });

  it('means the delete is never sent', async () => {
    const undo = state().removeItemWithUndo(428, 'passport');
    undo();
    jest.advanceTimersByTime(REMOVE_UNDO_MS * 2);
    await flush();
    expect(api.removeItem).not.toHaveBeenCalled();
  });

  it('still works when reached after the delete went out', async () => {
    // The last-instant tap. Rather than a button that silently does nothing,
    // it puts the item back for real.
    api.removeItem.mockResolvedValue(undefined);
    api.addItems.mockResolvedValue(summary({ count: 3 }));
    const undo = state().removeItemWithUndo(428, 'passport');
    jest.advanceTimersByTime(REMOVE_UNDO_MS);
    await flush();
    undo();
    await flush();
    expect(api.addItems).toHaveBeenCalledWith(428, { words: [{ word: 'passport', lemma_id: null }] });
    expect(words()).toContain('passport');
  });

  it('keeps the open page on screen after a late undo', async () => {
    // Caught while writing the test above: the late undo first went through
    // the store's `addItems`, which drops the cached page on success. With the
    // list open and nothing to re-fetch it, the screen fell back to its
    // skeleton the instant the undo worked.
    api.removeItem.mockResolvedValue(undefined);
    api.addItems.mockResolvedValue(summary({ count: 3 }));
    const undo = state().removeItemWithUndo(428, 'passport');
    jest.advanceTimersByTime(REMOVE_UNDO_MS);
    await flush();
    undo();
    await flush();
    expect(state().byId[428]).toBeDefined();
    expect(state().lists[0].count).toBe(3);
  });

  it('removes it again, and says so, if the late undo cannot reach the server', async () => {
    api.removeItem.mockResolvedValue(undefined);
    api.addItems.mockRejectedValue(new Error('offline'));
    const undo = state().removeItemWithUndo(428, 'passport');
    jest.advanceTimersByTime(REMOVE_UNDO_MS);
    await flush();
    undo();
    await flush();
    // It really is gone on the server, so the screen must not claim otherwise.
    expect(words()).not.toContain('passport');
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
  });
});

describe('when the delete fails', () => {
  it('restores the item and says so, in the user’s language', async () => {
    api.removeItem.mockRejectedValue(new Error('offline'));
    state().removeItemWithUndo(428, 'goulash');
    jest.advanceTimersByTime(REMOVE_UNDO_MS);
    await flush();
    expect(words()).toEqual(['goulash', 'passport', 'luggage']);
    expect(state().byId[428].summary.count).toBe(3);
    // From the locale files — the store's toasts used to be English literals.
    // (The source guard below is what proves no literal survives; this proves
    // the key resolves.)
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ tone: 'error', message: t('lists:error.removeFailed') }),
    );
  });
});

describe('the store says nothing in English on its own', () => {
  it('has no hardcoded toast copy left', () => {
    // "Couldn't delete that list", "Couldn't add that", "Couldn't remove that"
    // were literals in a store serving six languages.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');
    const src = fs
      .readFileSync(path.join(__dirname, '..', 'listsStore.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).not.toMatch(/message:\s*['"`]/);
    expect(src).not.toMatch(/Couldn't/);
  });
});

describe('the window’s exits', () => {
  it('a refresh landing mid-window cannot bring the item back', async () => {
    // The server still has it until the timer fires. A sort change re-reads
    // the page — without the filter, the removed row reappears.
    api.detail.mockResolvedValue(page(['goulash', 'passport', 'luggage']));
    state().removeItemWithUndo(428, 'goulash');
    await state().fetchDetail(428, 'alpha');
    expect(words()).toEqual(['passport', 'luggage']);
    expect(state().byId[428].summary.count).toBe(2);
  });

  it('an index refresh mid-window does not tick the count back up', async () => {
    api.list.mockResolvedValue([summary({ count: 3 })]);
    state().removeItemWithUndo(428, 'goulash');
    await state().fetchLists();
    expect(state().lists[0].count).toBe(2);
  });

  it('adding the same item back from elsewhere cancels the removal instead of racing it', async () => {
    // Remove "goulash" here, tick it back on in the word feed's panel within
    // the window. Sending the add and then letting the timer fire would
    // delete the word the user just put back.
    api.removeItem.mockResolvedValue(undefined);
    state().removeItemWithUndo(428, 'goulash');
    await state().addItems(428, { words: [{ word: 'goulash', lemma_id: null }] });
    jest.advanceTimersByTime(REMOVE_UNDO_MS);
    await flush();
    expect(api.removeItem).not.toHaveBeenCalled();
    // It was never gone on the server, so nothing is sent as a fresh add.
    expect(api.addItems).not.toHaveBeenCalled();
    expect(words()).toContain('goulash');
  });

  it('sign-out drops the pending delete rather than sending it as nobody', async () => {
    // `logout` clears the tokens before `reset` runs. A timer left alive would
    // fire under the NEXT account's session.
    state().removeItemWithUndo(428, 'goulash');
    state().reset();
    jest.advanceTimersByTime(REMOVE_UNDO_MS * 2);
    await flush();
    expect(api.removeItem).not.toHaveBeenCalled();
  });

  it('deleting the list cancels its pending removals', async () => {
    api.remove.mockResolvedValue(undefined);
    state().removeItemWithUndo(428, 'goulash');
    await state().destroy(428);
    jest.advanceTimersByTime(REMOVE_UNDO_MS * 2);
    await flush();
    expect(api.removeItem).not.toHaveBeenCalled();
  });
});

describe('the immediate removal the word feed uses', () => {
  it('still commits at once — its checkbox is its own undo', async () => {
    api.removeItem.mockResolvedValue(undefined);
    await state().removeItem(428, 'goulash');
    expect(api.removeItem).toHaveBeenCalledWith(428, 'goulash');
    expect(state().byId[428].summary.count).toBe(2);
  });
});
