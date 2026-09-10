/**
 * `idle` is not `ready`, and treating it as such tells readers they have no
 * lists.
 *
 * The store is created at `status: 'idle'` and only reaches `'loading'` inside
 * `fetchLists`, which `hydrate` calls after two awaits — the segment
 * preference and the cached index. Every consumer that asked
 * `status === 'loading'` therefore had a window where the answer was "not
 * loading" while the truth was "has not started". With `lists` still empty,
 * both the Lists tab and the word feed's list panel fall through to their
 * loaded branch and render an empty collection.
 *
 * Measured on the first tap of Lists after a cold start: `n=0 status=idle` at
 * +157ms, rows at +198ms. Forty-one milliseconds on a warm cache; on a cold
 * one the same window is bounded by the network instead.
 *
 * This file pins the store's actual state sequence rather than the screens'
 * source text, because the sequence is the thing that made the reading wrong —
 * if `hydrate` ever set `'loading'` up front, the old test would have been
 * fine and this one would still pass.
 */

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
import { listsApi } from '../../services/api';

const mockList = listsApi.list as jest.Mock;

describe('the lists store starts in a state that is not "ready"', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useListsStore.getState().reset();
  });

  it('is idle before anything is asked of it', () => {
    // The state the screens mount into. Not 'loading' — that is the whole
    // point, and why `status === 'loading'` was the wrong question.
    expect(useListsStore.getState().status).toBe('idle');
    expect(useListsStore.getState().lists).toEqual([]);
  });

  it('an empty index is never "ready" until a load has actually finished', async () => {
    // The invariant the screens depend on, stated as the screens ask it:
    // "nothing to show AND not finished trying" must be true for every state
    // before the answer arrives, and false once it has.
    const nothingYet = () => {
      const { status, lists } = useListsStore.getState();
      return status !== 'ready' && lists.length === 0;
    };

    expect(nothingYet()).toBe(true);

    let release!: (v: unknown) => void;
    mockList.mockReturnValue(new Promise((r) => { release = r; }));
    const inFlight = useListsStore.getState().fetchLists();

    expect(nothingYet()).toBe(true);

    release([{ id: 1, name: 'Film noir', kind: 'films', systemKey: null, count: 0,
               totalWords: 0, preview: { posters: null, words: null },
               updatedAt: '2026-09-10T00:00:00Z' }]);
    await inFlight;

    expect(useListsStore.getState().status).toBe('ready');
    expect(nothingYet()).toBe(false);
  });

  it('a failed load still ends "ready", so the screen stops waiting', async () => {
    // Otherwise the fix above would trade a wrong empty state for a skeleton
    // that never resolves — worse, because it cannot be retried by looking at
    // it. `loadError` is what the retry line reads.
    mockList.mockRejectedValue(new Error('offline'));

    await useListsStore.getState().fetchLists();

    expect(useListsStore.getState().status).toBe('ready');
    expect(useListsStore.getState().loadError).toBe(true);
  });
});

describe('the consumers ask the right question', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const read = (...p: string[]) =>
    fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');

  it('ListsIndexScreen gates its skeleton on "not ready"', () => {
    expect(read('components', 'screens', 'ListsIndexScreen.tsx'))
      .toMatch(/const loading = status !== 'ready' && lists\.length === 0;/);
  });

  it("the word feed's list panel does too", () => {
    expect(read('components', 'WordFeedScreen.tsx'))
      .toMatch(/useListsStore\(\(st\) => st\.status !== 'ready'\)/);
  });
});
