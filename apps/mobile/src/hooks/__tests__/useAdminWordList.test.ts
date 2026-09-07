/**
 * useAdminWordList — the admin Words page's per-level list.
 *
 * Everything worth testing here is a race. The happy path ("asks for a level,
 * gets words back") is one assertion; the rest of this file is the three ways
 * a paged list quietly shows the wrong thing when the network is slow, none of
 * which reproduce on a developer's laptop:
 *
 *   - a superseded tab's response landing after the tab you actually chose;
 *   - two end-reaches computing the same offset and appending a page twice;
 *   - an append failure emptying a list you were reading.
 *
 * So the mocked API resolves on demand rather than immediately — a promise you
 * settle by hand is the only way to put two requests in flight at once and
 * choose the order they land in.
 */

import { cleanupHooks, flushAsync, renderHook, act } from '../../test-utils/renderHook';
import type { AdminWord, AdminWordPage } from '../../services/api';

interface Pending {
  args: { level: string; sort?: string; offset?: number; limit?: number };
  resolve: (page: AdminWordPage) => void;
  reject: (e: Error) => void;
}

let mockPending: Pending[] = [];

jest.mock('../../services/api', () => ({
  adminApi: {
    wordList: jest.fn(
      (args: Pending['args']) =>
        new Promise((resolve, reject) => {
          mockPending.push({ args, resolve, reject });
        }),
    ),
  },
}));

const { useAdminWordList, WORD_PAGE_SIZE } =
  require('../useAdminWordList') as typeof import('../useAdminWordList');

const word = (lemma: string, id = Number(lemma.replace(/\D/g, '')) || 1): AdminWord => ({
  id,
  lemma,
  pos: 'NOUN',
  cefr_level: 'B2',
  confidence: 0.55,
  source: 'frequency_backoff',
  frequency_rank: id,
  movie_count: 3,
  has_definition: true,
  hidden: false,
});

const page = (lemmas: string[], has_more = false, offset = 0): AdminWordPage => ({
  words: lemmas.map((l, i) => word(l, offset + i + 1)),
  has_more,
  offset,
});

/** Settle the nth in-flight request and let React commit the result. */
async function land(index: number, p: AdminWordPage) {
  await act(async () => {
    mockPending[index].resolve(p);
    await Promise.resolve();
  });
  await flushAsync();
}

describe('useAdminWordList', () => {
  afterEach(() => {
    mockPending = [];
    cleanupHooks();
    jest.clearAllMocks();
  });

  it('asks for nothing until a level is chosen', () => {
    renderHook(() => useAdminWordList(null));

    expect(mockPending).toHaveLength(0);
  });

  it('loads page 0 for the chosen level', async () => {
    const { result } = renderHook(() => useAdminWordList('B2'));

    expect(result.current.loading).toBe(true);
    expect(mockPending[0].args).toMatchObject({ level: 'B2', offset: 0, limit: WORD_PAGE_SIZE });

    await land(0, page(['w1', 'w2'], true));

    expect(result.current.words.map((w) => w.lemma)).toEqual(['w1', 'w2']);
    expect(result.current.loading).toBe(false);
    expect(result.current.hasMore).toBe(true);
  });

  it('appends the next page from the length it already holds', async () => {
    const { result } = renderHook(() => useAdminWordList('B2'));
    await land(0, page(['w1', 'w2'], true));

    act(() => result.current.loadMore());
    expect(mockPending[1].args.offset).toBe(2);

    await land(1, page(['w3'], false, 2));

    expect(result.current.words.map((w) => w.lemma)).toEqual(['w1', 'w2', 'w3']);
    expect(result.current.hasMore).toBe(false);
  });

  it('ignores a second end-reach while the first page is still in flight', async () => {
    // Two onEndReached fire in consecutive frames near the bottom of a list.
    // Without the in-flight lock both read the same offset and the same page
    // gets appended twice — visible as duplicated words, not as an error.
    const { result } = renderHook(() => useAdminWordList('B2'));
    await land(0, page(['w1', 'w2'], true));

    act(() => result.current.loadMore());
    act(() => result.current.loadMore());

    expect(mockPending).toHaveLength(2); // page 0 + one append, not two

    await land(1, page(['w3'], false, 2));
    expect(result.current.words.map((w) => w.lemma)).toEqual(['w1', 'w2', 'w3']);
  });

  it('does not append past the end of the list', async () => {
    const { result } = renderHook(() => useAdminWordList('B2'));
    await land(0, page(['w1'], false));

    act(() => result.current.loadMore());

    expect(mockPending).toHaveLength(1);
  });

  it('drops a superseded level response instead of painting it', async () => {
    // Tap A1, then C2 before A1 lands. A1's words must never appear under C2.
    let level = 'A1';
    const { result, rerender } = renderHook(() => useAdminWordList(level));
    expect(mockPending[0].args.level).toBe('A1');

    level = 'C2';
    rerender();
    expect(mockPending[1].args.level).toBe('C2');

    await land(1, page(['cee'], false));
    await land(0, page(['ay'], true)); // the stale A1 page, landing late

    expect(result.current.words.map((w) => w.lemma)).toEqual(['cee']);
    expect(result.current.hasMore).toBe(false);
  });

  it('restarts at page 0 when the sort changes', async () => {
    let sort: 'frequency' | 'alpha' = 'frequency';
    const { result, rerender } = renderHook(() => useAdminWordList('B2', sort));
    await land(0, page(['w1', 'w2'], true));

    sort = 'alpha';
    rerender();

    expect(mockPending[1].args).toMatchObject({ sort: 'alpha', offset: 0 });
    // The old sort's rows are gone immediately; showing them under the new
    // chip would claim an ordering the list does not have.
    expect(result.current.words).toEqual([]);
  });

  it('clears the list when the level is deselected', async () => {
    let level: string | null = 'B2';
    const { result, rerender } = renderHook(() => useAdminWordList(level));
    await land(0, page(['w1'], true));

    level = null;
    rerender();

    expect(result.current.words).toEqual([]);
    expect(result.current.hasMore).toBe(false);
    expect(mockPending).toHaveLength(1); // deselecting asks for nothing
  });

  it('keeps the rows already on screen when an append fails', async () => {
    // Losing a list you were reading because page 4 timed out is a worse
    // outcome than a short list.
    const { result } = renderHook(() => useAdminWordList('B2'));
    await land(0, page(['w1', 'w2'], true));

    act(() => result.current.loadMore());
    await act(async () => {
      mockPending[1].reject(new Error('timeout'));
      await Promise.resolve();
    });
    await flushAsync();

    expect(result.current.words.map((w) => w.lemma)).toEqual(['w1', 'w2']);
    expect(result.current.error).toBe('timeout');
    expect(result.current.loadingMore).toBe(false);
  });

  it('empties the list when page 0 itself fails', async () => {
    const { result } = renderHook(() => useAdminWordList('B2'));

    await act(async () => {
      mockPending[0].reject(new Error('500'));
      await Promise.resolve();
    });
    await flushAsync();

    expect(result.current.words).toEqual([]);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.error).toBe('500');
    expect(result.current.loading).toBe(false);
  });
});
