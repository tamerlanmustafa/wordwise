jest.mock('../../services/api', () => ({
  wordwiseApi: { getMoviesByCefr: jest.fn() },
  // Identity enrichment keeps assertions about ordering/ids simple.
  enrichMoviesWithTmdb: jest.fn(async (rows: unknown[]) => rows),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

import { drawHasRotated, primeCefrMoviesCache, useInfiniteCefrMovies } from '../useInfiniteCefrMovies';
import { wordwiseApi, enrichMoviesWithTmdb } from '../../services/api';
import { clearCacheMemory, peekCache, writeCache } from '../../services/swrCache';
import { renderHook, flushAsync, act, cleanupHooks } from '../../test-utils/renderHook';
import { DEFAULT_FEED_FILTERS, type MovieType } from '../../components/filmFeed/filterOptions';

const mockGet = wordwiseApi.getMoviesByCefr as jest.Mock;

const page = (
  movies: Array<{ tmdb_id?: number; movie_id?: number; title: string }>,
  has_more: boolean,
  extra: Record<string, unknown> = {},
) => ({
  level: 'B1',
  total: 99,
  offset: 0,
  has_more,
  movies,
  ...extra,
});

/** A `sort=recommended` page, as the server answers it. */
const draw = (
  movies: Array<{ tmdb_id?: number; movie_id?: number; title: string }>,
  has_more: boolean,
  seed: number,
) =>
  page(movies, has_more, {
    seed,
    next_rotation_at: new Date(Date.now() + 4 * 3600_000).toISOString(),
  });

describe('useInfiniteCefrMovies', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    (enrichMoviesWithTmdb as jest.Mock).mockImplementation(async (rows: unknown[]) => rows);
    // The hook caches page 0 to AsyncStorage now, and the mock persists across
    // tests in a file. Without this, one test's successful load paints the
    // next test's list and the suite passes or fails on ordering.
    await AsyncStorage.clear();
    // …and holds it in memory, which AsyncStorage.clear() does not reach.
    clearCacheMemory();
  });

  afterEach(() => cleanupHooks());

  it('loads the first page on mount and exposes loading/hasMore', async () => {
    mockGet.mockResolvedValueOnce(page([{ tmdb_id: 1, title: 'A' }, { tmdb_id: 2, title: 'B' }], true));

    const { result } = renderHook(() => useInfiniteCefrMovies('B1', 'rating', 'desc'));
    expect(result.current.loading).toBe(true);
    await flushAsync();

    expect(result.current.loading).toBe(false);
    expect(result.current.movies.map((m) => m.id)).toEqual([1, 2]);
    expect(result.current.hasMore).toBe(true);
    expect(mockGet).toHaveBeenCalledWith('B1', 10, { offset: 0, sort: 'rating', order: 'desc' });
  });

  it('derives a stable id from tmdb_id, falling back to movie_id', async () => {
    mockGet.mockResolvedValueOnce(page([{ movie_id: 55, title: 'No TMDB' }], false));
    const { result } = renderHook(() => useInfiniteCefrMovies('B1', 'rating', 'desc'));
    await flushAsync();
    expect(result.current.movies[0].id).toBe(55);
  });

  it('appends the next page on loadMore and advances the offset', async () => {
    mockGet
      .mockResolvedValueOnce(page([{ tmdb_id: 1, title: 'A' }], true))
      .mockResolvedValueOnce(page([{ tmdb_id: 2, title: 'B' }], false));

    const { result } = renderHook(() => useInfiniteCefrMovies('B1', 'rating', 'desc'));
    await flushAsync();

    await act(async () => {
      result.current.loadMore();
      await Promise.resolve();
    });
    await flushAsync();

    expect(result.current.movies.map((m) => m.id)).toEqual([1, 2]);
    expect(result.current.hasMore).toBe(false);
    expect(mockGet).toHaveBeenLastCalledWith('B1', 10, { offset: 1, sort: 'rating', order: 'desc' });
  });

  it('stops paginating once hasMore is false', async () => {
    mockGet.mockResolvedValueOnce(page([{ tmdb_id: 1, title: 'A' }], false));
    const { result } = renderHook(() => useInfiniteCefrMovies('B1', 'rating', 'desc'));
    await flushAsync();

    await act(async () => {
      result.current.loadMore(); // should be a no-op: hasMore is false
      await Promise.resolve();
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('surfaces an error and empties the list on a failed initial load', async () => {
    mockGet.mockRejectedValueOnce(new Error('Failed to load movies'));
    const { result } = renderHook(() => useInfiniteCefrMovies('B1', 'rating', 'desc'));
    await flushAsync();

    expect(result.current.error).toBe('Failed to load movies');
    expect(result.current.movies).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('reload re-fetches page 0', async () => {
    mockGet
      .mockResolvedValueOnce(page([{ tmdb_id: 1, title: 'A' }], true))
      .mockResolvedValueOnce(page([{ tmdb_id: 9, title: 'Z' }], false));

    const { result } = renderHook(() => useInfiniteCefrMovies('B1', 'rating', 'desc'));
    await flushAsync();

    await act(async () => {
      result.current.reload();
      await Promise.resolve();
    });
    await flushAsync();

    expect(result.current.movies.map((m) => m.id)).toEqual([9]);
  });

  // ── Animation filter (#114) ───────────────────────────────────────────────
  describe('movieType', () => {
    it('defaults to the unfiltered feed and sends no `animated`', async () => {
      mockGet.mockResolvedValueOnce(page([{ tmdb_id: 1, title: 'A' }], false));
      renderHook(() => useInfiniteCefrMovies('B1', 'rating', 'desc'));
      await flushAsync();
      expect(mockGet.mock.calls[0][2].animated).toBeUndefined();
    });

    it('sends animated=false for live action, not a missing param', async () => {
      mockGet.mockResolvedValueOnce(page([{ tmdb_id: 1, title: 'A' }], false));
      renderHook(() => useInfiniteCefrMovies('B1', 'rating', 'desc', 'live'));
      await flushAsync();
      expect(mockGet.mock.calls[0][2].animated).toBe(false);
    });

    it('resets to page 0 when the filter changes, instead of appending', async () => {
      // The failure this guards: keeping the offset across a filter change
      // would start the animated feed at row 10 of the unfiltered one, so the
      // first page of results would simply be missing.
      mockGet
        .mockResolvedValueOnce(page([{ tmdb_id: 1, title: 'Live' }], true))
        .mockResolvedValueOnce(page([{ tmdb_id: 7, title: 'Toon' }], true));

      // renderHook here takes no props (see test-utils/renderHook), so the
      // filter is held outside the hook and the host is re-rendered.
      let type: MovieType = 'all';
      const { result, rerender } = renderHook(() =>
        useInfiniteCefrMovies('B1', 'rating', 'desc', type),
      );
      await flushAsync();

      type = 'animation';
      await act(async () => {
        rerender();
        await Promise.resolve();
      });
      await flushAsync();

      expect(mockGet.mock.calls[1][2]).toMatchObject({ offset: 0, animated: true });
      // Replaced, not appended — the old feed's rows are gone.
      expect(result.current.movies.map((m) => m.id)).toEqual([7]);
    });

    it('keeps paginating within the filter once it is on', async () => {
      mockGet
        .mockResolvedValueOnce(page([{ tmdb_id: 1, title: 'A' }], true))
        .mockResolvedValueOnce(page([{ tmdb_id: 2, title: 'B' }], false));

      const { result } = renderHook(() =>
        useInfiniteCefrMovies('A1', 'rating', 'desc', 'animation'),
      );
      await flushAsync();

      await act(async () => {
        result.current.loadMore();
        await Promise.resolve();
      });
      await flushAsync();

      // Page 2 continues from page 1 *under the filter* — offset advances and
      // `animated` is still set, so the server keeps narrowing.
      expect(mockGet.mock.calls[1][2]).toMatchObject({ offset: 1, animated: true });
      expect(result.current.movies.map((m) => m.id)).toEqual([1, 2]);
    });
  });

  // ── Recommended: the rotation seed ────────────────────────────────────────
  // `sort=recommended` is a seeded shuffle, so OFFSET pagination is only
  // coherent while every page is a slice of the SAME shuffle. This is the one
  // rule in the feature that fails silently — the user just sees a film twice
  // and never sees another — so it is pinned rather than eyeballed.
  describe('recommendation seed', () => {
    it('asks for no particular draw on the first page', async () => {
      mockGet.mockResolvedValueOnce(draw([{ tmdb_id: 1, title: 'A' }], true, 77));
      renderHook(() => useInfiniteCefrMovies('B1', 'recommended', 'desc'));
      await flushAsync();
      // The server picks the current window and tells us which it used.
      expect(mockGet.mock.calls[0][2].seed).toBeUndefined();
    });

    it('sends the first page’s seed back on every append', async () => {
      mockGet
        .mockResolvedValueOnce(draw([{ tmdb_id: 1, title: 'A' }], true, 77))
        .mockResolvedValueOnce(draw([{ tmdb_id: 2, title: 'B' }], true, 77))
        .mockResolvedValueOnce(draw([{ tmdb_id: 3, title: 'C' }], false, 77));

      const { result } = renderHook(() =>
        useInfiniteCefrMovies('B1', 'recommended', 'desc'),
      );
      await flushAsync();

      for (let i = 0; i < 2; i++) {
        await act(async () => {
          result.current.loadMore();
          await Promise.resolve();
        });
        await flushAsync();
      }

      expect(mockGet.mock.calls[1][2]).toMatchObject({ offset: 1, seed: 77 });
      expect(mockGet.mock.calls[2][2]).toMatchObject({ offset: 2, seed: 77 });
      // Three pages, no repeat and nothing dropped.
      expect(result.current.movies.map((m) => m.id)).toEqual([1, 2, 3]);
    });

    it('clears the seed on a reset, so a new level is a new draw', async () => {
      // Reusing the old seed across a level change would page a B2 shelf
      // through an ordering computed for B1 — not wrong exactly, but it makes
      // "the rotation" mean nothing, and a level change is the clearest signal
      // the user wants a different set.
      mockGet
        .mockResolvedValueOnce(draw([{ tmdb_id: 1, title: 'A' }], true, 77))
        .mockResolvedValueOnce(draw([{ tmdb_id: 5, title: 'E' }], true, 78));

      let level = 'B1';
      const { rerender } = renderHook(() =>
        useInfiniteCefrMovies(level, 'recommended', 'desc'),
      );
      await flushAsync();

      level = 'B2';
      await act(async () => {
        rerender();
        await Promise.resolve();
      });
      await flushAsync();

      expect(mockGet.mock.calls[1][2]).toMatchObject({ offset: 0 });
      expect(mockGet.mock.calls[1][2].seed).toBeUndefined();
    });

    it('adopts the new seed the reset came back with, for its own appends', async () => {
      mockGet
        .mockResolvedValueOnce(draw([{ tmdb_id: 1, title: 'A' }], true, 77))
        .mockResolvedValueOnce(draw([{ tmdb_id: 5, title: 'E' }], true, 78))
        .mockResolvedValueOnce(draw([{ tmdb_id: 6, title: 'F' }], false, 78));

      let level = 'B1';
      const { result, rerender } = renderHook(() =>
        useInfiniteCefrMovies(level, 'recommended', 'desc'),
      );
      await flushAsync();

      level = 'B2';
      await act(async () => {
        rerender();
        await Promise.resolve();
      });
      await flushAsync();

      await act(async () => {
        result.current.loadMore();
        await Promise.resolve();
      });
      await flushAsync();

      expect(mockGet.mock.calls[2][2]).toMatchObject({ offset: 1, seed: 78 });
    });

    it('sends no seed on the column sorts, which are already stable', async () => {
      mockGet
        .mockResolvedValueOnce(page([{ tmdb_id: 1, title: 'A' }], true))
        .mockResolvedValueOnce(page([{ tmdb_id: 2, title: 'B' }], false));

      const { result } = renderHook(() => useInfiniteCefrMovies('B1', 'rating', 'desc'));
      await flushAsync();
      await act(async () => {
        result.current.loadMore();
        await Promise.resolve();
      });
      await flushAsync();

      expect(mockGet.mock.calls[0][2].seed).toBeUndefined();
      expect(mockGet.mock.calls[1][2].seed).toBeUndefined();
    });

    it('exposes when the draw expires, and nothing when the sort has no draw', async () => {
      mockGet.mockResolvedValueOnce(draw([{ tmdb_id: 1, title: 'A' }], false, 77));
      const { result } = renderHook(() =>
        useInfiniteCefrMovies('B1', 'recommended', 'desc'),
      );
      await flushAsync();
      expect(typeof result.current.nextRotationAt).toBe('string');

      mockGet.mockResolvedValueOnce(page([{ tmdb_id: 1, title: 'A' }], false));
      const plain = renderHook(() => useInfiniteCefrMovies('B1', 'rating', 'desc'));
      await flushAsync();
      // Null hides the "new set in 4h" line rather than printing a stale one.
      expect(plain.result.current.nextRotationAt).toBeNull();
    });
  });
  // ── Cached first page ────────────────────────────────────────────────────
  //
  // The tab is lazily mounted, so before this the user tapped it and then
  // watched a skeleton while a request went out and every film was enriched
  // from TMDB. The cache paints last session's page immediately and lets the
  // live request replace it.
  //
  // Two rules matter. The cache never supplies an offset: the live page 0
  // replaces the painted one before anything appends. And a painted
  // Recommended page is never reshuffled on screen: the live request asks for
  // the draw it painted, and a rotated draw that the request has already outrun
  // is not painted at all. Every page of a scroll still sends one seed, so
  // paging an older draw is exactly as coherent as paging the current one.
  describe('the cached first page', () => {
    /** Load once so a page 0 is cached, then throw the hook away. */
    const seedCache = async (movies = [{ tmdb_id: 1, title: 'Cached' }]) => {
      mockGet.mockResolvedValueOnce(page(movies, true));
      renderHook(() => useInfiniteCefrMovies('B1', 'rating', 'desc'));
      await flushAsync();
      cleanupHooks();
      jest.clearAllMocks();
      (enrichMoviesWithTmdb as jest.Mock).mockImplementation(async (rows: unknown[]) => rows);
    };

    it('shows the last page before the network answers', async () => {
      await seedCache();
      // A request that never settles: whatever is on screen came from disk.
      mockGet.mockReturnValueOnce(new Promise(() => {}));

      const { result } = renderHook(() => useInfiniteCefrMovies('B1', 'rating', 'desc'));
      await flushAsync();

      expect(result.current.movies.map((m) => m.title)).toEqual(['Cached']);
      expect(result.current.loading).toBe(false); // no skeleton
    });

    it('replaces the cached page with the fresh one', async () => {
      await seedCache();
      mockGet.mockResolvedValueOnce(page([{ tmdb_id: 9, title: 'Fresh' }], false));

      const { result } = renderHook(() => useInfiniteCefrMovies('B1', 'rating', 'desc'));
      await flushAsync();

      expect(result.current.movies.map((m) => m.title)).toEqual(['Fresh']);
    });

    it('keeps the cached page when the network fails', async () => {
      // Offline resilience, and the reason the cache is worth having beyond
      // the first 400ms: a stale list of films beats an empty screen.
      await seedCache();
      mockGet.mockRejectedValueOnce(new Error('offline'));

      const { result } = renderHook(() => useInfiniteCefrMovies('B1', 'rating', 'desc'));
      await flushAsync();

      expect(result.current.movies.map((m) => m.title)).toEqual(['Cached']);
    });

    it('does not paint another filter’s cache', async () => {
      // A cached page from a different level or sort is the wrong list, not a
      // stale one — showing it would look like the filter had failed.
      await seedCache();
      mockGet.mockReturnValueOnce(new Promise(() => {}));

      const { result } = renderHook(() => useInfiniteCefrMovies('C1', 'rating', 'desc'));
      await flushAsync();

      expect(result.current.movies).toEqual([]);
      expect(result.current.loading).toBe(true); // skeleton, correctly
    });

    const RECOMMENDED_B1 = 'movies.byCefr.B1.recommended.desc.all';
    /** A Recommended page on disk, from a draw that is still open or not. */
    const drawOnDisk = async (title: string, seed: number, rotated: boolean) => {
      await AsyncStorage.setItem(
        `swr_${RECOMMENDED_B1}`,
        JSON.stringify({
          data: {
            movies: [{ tmdb_id: seed, title }],
            seed,
            nextRotationAt: new Date(Date.now() + (rotated ? -1 : 1) * 3600_000).toISOString(),
          },
          savedAt: Date.now(),
        }),
      );
    };

    it('asks for the draw it painted, so the answer keeps the order on screen', async () => {
      // The swap this prevents: a page cached in one three-hour window, painted
      // in the next, and replaced a second later by a reshuffled shelf.
      mockGet.mockResolvedValueOnce(draw([{ tmdb_id: 1, title: 'Saved' }], true, 41));
      renderHook(() => useInfiniteCefrMovies('B1', 'recommended', 'desc'));
      await flushAsync();
      cleanupHooks();
      jest.clearAllMocks();
      (enrichMoviesWithTmdb as jest.Mock).mockImplementation(async (rows: unknown[]) => rows);

      mockGet.mockResolvedValueOnce(draw([{ tmdb_id: 1, title: 'Saved' }], true, 41));
      const { result } = renderHook(() =>
        useInfiniteCefrMovies('B1', 'recommended', 'desc'),
      );
      await flushAsync();
      // The draw from disk, but never the offset: the live page 0 replaces the
      // painted one before anything appends.
      expect(mockGet.mock.calls[0][2]).toMatchObject({ offset: 0, seed: 41 });

      mockGet.mockResolvedValueOnce(draw([{ tmdb_id: 2, title: 'Next' }], false, 41));
      await act(async () => {
        result.current.loadMore();
        await Promise.resolve();
      });
      // One seed from the first page of the scroll to the last.
      expect(mockGet.mock.calls[1][2]).toMatchObject({ offset: 1, seed: 41 });
    });

    it('does not paint a rotated draw that the request would only reshuffle', async () => {
      // Nothing in memory, so the request goes out before the disk answers —
      // for the current draw. An older draw read back afterwards would be
      // swapped the moment that answer landed, so the skeleton stays.
      await drawOnDisk('Old draw', 40, true);
      mockGet.mockReturnValueOnce(new Promise(() => {}));

      const { result } = renderHook(() =>
        useInfiniteCefrMovies('B1', 'recommended', 'desc'),
      );
      await flushAsync();

      expect(result.current.movies).toEqual([]);
      expect(result.current.loading).toBe(true);
      expect(mockGet.mock.calls[0][2].seed).toBeUndefined();
    });

    it('still paints a saved draw that is current', async () => {
      await drawOnDisk('This window', 40, false);
      mockGet.mockReturnValueOnce(new Promise(() => {}));

      const { result } = renderHook(() =>
        useInfiniteCefrMovies('B1', 'recommended', 'desc'),
      );
      await flushAsync();

      expect(result.current.movies.map((m) => m.title)).toEqual(['This window']);
    });

    it('shows a rotated draw after all once the network has failed', async () => {
      // Offline, a stale shelf still beats an empty screen — and there is no
      // answer left to reshuffle it.
      await drawOnDisk('Old draw', 40, true);
      mockGet.mockRejectedValueOnce(new Error('offline'));

      const { result } = renderHook(() =>
        useInfiniteCefrMovies('B1', 'recommended', 'desc'),
      );
      await flushAsync();

      expect(result.current.movies.map((m) => m.title)).toEqual(['Old draw']);
    });

    it('does not let an older draw overwrite a newer one it finds in memory', async () => {
      // A tab opened before the launch refresh landed asks for the draw it
      // painted. If that refresh has since stored the next draw, the tab's
      // answer must not put the older shelf back for the next launch.
      const hour = 3600_000;
      await writeCache(RECOMMENDED_B1, {
        movies: [{ tmdb_id: 1, title: 'Older draw' }],
        seed: 42,
        nextRotationAt: new Date(Date.now() - hour).toISOString(),
      });
      let answer!: (value: unknown) => void;
      mockGet.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));

      const { result } = renderHook(() =>
        useInfiniteCefrMovies('B1', 'recommended', 'desc'),
      );
      await flushAsync();
      expect(mockGet.mock.calls[0][2].seed).toBe(42);

      await writeCache(RECOMMENDED_B1, {
        movies: [{ tmdb_id: 9, title: 'Newer draw' }],
        seed: 43,
        nextRotationAt: new Date(Date.now() + hour).toISOString(),
      });
      await act(async () => {
        answer(draw([{ tmdb_id: 1, title: 'Older draw' }], true, 42));
      });
      await flushAsync();

      // The screen keeps the shelf it showed…
      expect(result.current.movies.map((m) => m.title)).toEqual(['Older draw']);
      // …and the next launch opens on the newer one.
      expect(peekCache<{ seed: number }>(RECOMMENDED_B1)?.seed).toBe(43);
    });

    it('cannot append while only the cache has painted', async () => {
      // `loading` is false so the skeleton is gone, but the live request still
      // owns the offset and the seed. An append here would page a draw the
      // hook does not have yet.
      await seedCache();
      mockGet.mockReturnValueOnce(new Promise(() => {}));

      const { result } = renderHook(() => useInfiniteCefrMovies('B1', 'rating', 'desc'));
      await flushAsync();
      await act(async () => {
        result.current.loadMore();
        await Promise.resolve();
      });

      expect(mockGet).toHaveBeenCalledTimes(1);
    });

    it('ignores a cache older than its lifetime', async () => {
      await seedCache();
      // A day and a bit later.
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now + 25 * 60 * 60 * 1000);
      mockGet.mockReturnValueOnce(new Promise(() => {}));

      const { result } = renderHook(() => useInfiniteCefrMovies('B1', 'rating', 'desc'));
      await flushAsync();

      expect(result.current.movies).toEqual([]);
      (Date.now as jest.Mock).mockRestore();
    });
  });

  // ── Painted on the first frame ───────────────────────────────────────────
  //
  // Reading the cache when the tab mounted still put a skeleton in the first
  // frame, because the read answers after it. Measured after a cold start:
  // ~300ms of skeleton rows over a page that was on disk. Launch reads it now,
  // and the hook starts from memory.
  describe('primed at launch', () => {
    const order = DEFAULT_FEED_FILTERS.sortAsc ? 'asc' : 'desc';
    const defaultKey = (level: string) =>
      `movies.byCefr.${level}.${DEFAULT_FEED_FILTERS.sort}.${order}.${DEFAULT_FEED_FILTERS.movieType}`;
    /** A saved page 0 for the feed's default filters. Its draw is `current`
     *  unless a test says otherwise, because priming a rotated draw sends a
     *  request. `legacy` is the bare list stored before the draw was. */
    const onDisk = async (
      level: string,
      movies: unknown[],
      state: 'current' | 'rotated' | 'legacy' = 'current',
    ) => {
      const data =
        state === 'legacy'
          ? movies
          : {
              movies,
              seed: 7,
              nextRotationAt: new Date(
                Date.now() + (state === 'current' ? 1 : -1) * 3600_000,
              ).toISOString(),
            };
      await AsyncStorage.setItem(
        `swr_${defaultKey(level)}`,
        JSON.stringify({ data, savedAt: Date.now() }),
      );
    };
    /** Every `loading` value the hook ever rendered, in order. */
    const renderRecording = (level: string, sort = DEFAULT_FEED_FILTERS.sort) => {
      const loadingSeen: boolean[] = [];
      const handle = renderHook(() => {
        const r = useInfiniteCefrMovies(level, sort, order, DEFAULT_FEED_FILTERS.movieType);
        loadingSeen.push(r.loading);
        return r;
      });
      return { ...handle, loadingSeen };
    };

    it('renders the cached page on the very first render — no skeleton at all', async () => {
      await onDisk('A1', [{ id: 1, title: 'Cached' }]);
      await primeCefrMoviesCache('A1');
      mockGet.mockReturnValueOnce(new Promise(() => {}));

      const { result, loadingSeen } = renderRecording('A1');

      // Before any flush: this is the first frame.
      expect(result.current.movies.map((m) => m.title)).toEqual(['Cached']);
      expect(loadingSeen[0]).toBe(false);
      await flushAsync();
      // …and the reset the mount effect runs does not flash it back on.
      expect(loadingSeen).not.toContain(true);
    });

    it('still lets the network answer replace the primed page', async () => {
      await onDisk('A1', [{ id: 1, title: 'Cached' }]);
      await primeCefrMoviesCache('A1');
      mockGet.mockResolvedValueOnce(page([{ tmdb_id: 9, title: 'Fresh' }], false));

      const { result } = renderRecording('A1');
      await flushAsync();

      expect(result.current.movies.map((m) => m.title)).toEqual(['Fresh']);
    });

    it('primes the page the feed opens on — the default filters at that level', async () => {
      await onDisk('A1', [{ id: 1, title: 'Default' }]);
      await onDisk('B2', [{ id: 2, title: 'Other level' }]);

      expect((await primeCefrMoviesCache('A1'))?.map((m) => m.title)).toEqual(['Default']);
      mockGet.mockReturnValueOnce(new Promise(() => {}));

      // Not another level's page: that one was never read.
      const { loadingSeen } = renderRecording('B2');
      expect(loadingSeen[0]).toBe(true);
      await flushAsync(); // its own disk read still paints it, a frame later
    });

    it('resolves to nothing when there is no page on disk', async () => {
      expect(await primeCefrMoviesCache('A1')).toBeNull();
    });

    it('does not paint a primed page that is past its lifetime', async () => {
      await onDisk('A1', [{ id: 1, title: 'Cached' }]);
      await primeCefrMoviesCache('A1');
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now + 25 * 60 * 60 * 1000);
      mockGet.mockReturnValueOnce(new Promise(() => {}));

      const { result, loadingSeen } = renderRecording('A1');

      expect(result.current.movies).toEqual([]);
      expect(loadingSeen[0]).toBe(true);
      await flushAsync();
      expect(result.current.movies).toEqual([]);
      (Date.now as jest.Mock).mockRestore();
    });

    // ── A saved shelf from an earlier window ──────────────────────────────
    //
    // Recommended rotates every three hours. Painting an older draw and then
    // letting the live answer replace it was a visible swap a second after the
    // tab opened, on every cold start after a rotation.
    describe('when the saved shelf is from an earlier window', () => {
      it('fetches the current draw at launch, so the tab opens on it', async () => {
        await onDisk('A1', [{ id: 1, title: 'Old shelf' }], 'rotated');
        mockGet.mockResolvedValueOnce(draw([{ tmdb_id: 9, title: 'Current shelf' }], true, 8));

        await primeCefrMoviesCache('A1');
        await flushAsync();

        // The current window: the feed's default filters, first page, no seed.
        expect(mockGet).toHaveBeenCalledTimes(1);
        expect(mockGet.mock.calls[0][0]).toBe('A1');
        expect(mockGet.mock.calls[0][2]).toMatchObject({ offset: 0, sort: DEFAULT_FEED_FILTERS.sort });
        expect(mockGet.mock.calls[0][2].seed).toBeUndefined();

        mockGet.mockReturnValueOnce(new Promise(() => {}));
        const { result, loadingSeen } = renderRecording('A1');
        // The first frame is already the current shelf…
        expect(result.current.movies.map((m) => m.title)).toEqual(['Current shelf']);
        expect(loadingSeen[0]).toBe(false);
        await flushAsync();
        // …and the tab's own request asks for that same draw.
        expect(mockGet.mock.calls[1][2].seed).toBe(8);
      });

      it('keeps the shelf on screen when the tab opens before that fetch lands', async () => {
        await onDisk('A1', [{ id: 1, title: 'Old shelf' }], 'rotated');
        let landRefresh!: (value: unknown) => void;
        mockGet.mockReturnValueOnce(new Promise((resolve) => { landRefresh = resolve; }));
        await primeCefrMoviesCache('A1');

        let answerTab!: (value: unknown) => void;
        mockGet.mockReturnValueOnce(new Promise((resolve) => { answerTab = resolve; }));
        const { result } = renderRecording('A1');
        await flushAsync();
        expect(result.current.movies.map((m) => m.title)).toEqual(['Old shelf']);
        // The tab asks for the draw it painted…
        expect(mockGet.mock.calls[1][2].seed).toBe(7);

        // …the launch fetch lands with the next draw, and nothing on screen moves…
        await act(async () => {
          landRefresh(draw([{ tmdb_id: 9, title: 'Current shelf' }], true, 8));
        });
        await flushAsync();
        expect(result.current.movies.map((m) => m.title)).toEqual(['Old shelf']);

        // …the tab's own answer keeps the order it had…
        await act(async () => {
          answerTab(draw([{ tmdb_id: 1, title: 'Old shelf' }], true, 7));
        });
        await flushAsync();
        expect(result.current.movies.map((m) => m.title)).toEqual(['Old shelf']);

        // …and the next launch opens on the current shelf, without asking again.
        mockGet.mockClear();
        const nextLaunch = await primeCefrMoviesCache('A1');
        expect(nextLaunch?.map((m) => m.title)).toEqual(['Current shelf']);
        expect(mockGet).not.toHaveBeenCalled();
      });

      it('does not paint a page saved before draws were recorded — nothing could keep its order', async () => {
        // Measured on an iPhone SE when this first landed: a legacy page painted
        // on a fast tap was swapped for the current shelf 270ms later, because
        // the tab had no draw to ask for. A skeleton once beats that swap.
        await onDisk('A1', [{ id: 1, title: 'Legacy' }], 'legacy');
        let land!: (value: unknown) => void;
        mockGet.mockReturnValueOnce(new Promise((resolve) => { land = resolve; }));
        await primeCefrMoviesCache('A1');

        mockGet.mockReturnValueOnce(new Promise(() => {}));
        const { result, loadingSeen } = renderRecording('A1');
        expect(result.current.movies).toEqual([]);
        expect(loadingSeen[0]).toBe(true);
        await flushAsync();
        // Not from disk a moment later either.
        expect(result.current.movies).toEqual([]);

        await act(async () => {
          land(draw([{ tmdb_id: 9, title: 'Current shelf' }], true, 8));
        });
        await flushAsync();
      });

      it('treats a page saved before draws were recorded as rotated', async () => {
        await onDisk('A1', [{ id: 1, title: 'Legacy' }], 'legacy');
        mockGet.mockResolvedValueOnce(draw([{ tmdb_id: 9, title: 'Current shelf' }], true, 8));

        await primeCefrMoviesCache('A1');
        await flushAsync();

        expect(mockGet).toHaveBeenCalledTimes(1);
      });

      it('warms the pictures of each page it puts in memory', async () => {
        await onDisk('A1', [{ id: 1, title: 'Old shelf' }], 'rotated');
        mockGet.mockResolvedValueOnce(draw([{ tmdb_id: 9, title: 'Current shelf' }], true, 8));
        const warmed: string[][] = [];

        await primeCefrMoviesCache('A1', (movies) => warmed.push(movies.map((m) => m.title)));
        await flushAsync();

        expect(warmed).toEqual([['Old shelf'], ['Current shelf']]);
      });

      it('keeps the saved shelf when that fetch fails', async () => {
        await onDisk('A1', [{ id: 1, title: 'Old shelf' }], 'rotated');
        mockGet.mockRejectedValueOnce(new Error('offline'));

        await primeCefrMoviesCache('A1');
        await flushAsync();

        expect(await primeCefrMoviesCache('A1')).toEqual([{ id: 1, title: 'Old shelf' }]);
        mockGet.mockReturnValueOnce(new Promise(() => {}));
      });

      it('does not store the page if the account signed out while it was in flight', async () => {
        await onDisk('A1', [{ id: 1, title: 'Old shelf' }], 'rotated');
        let land!: (value: unknown) => void;
        mockGet.mockReturnValueOnce(new Promise((resolve) => { land = resolve; }));
        await primeCefrMoviesCache('A1');

        clearCacheMemory(); // what sign-out does
        await act(async () => {
          land(draw([{ tmdb_id: 9, title: 'Previous account' }], true, 8));
        });
        await flushAsync();

        expect(peekCache(defaultKey('A1'))).toBeNull();
      });
    });

    describe('when there is nothing to rotate', () => {
      it('sends no request when the saved draw is still current', async () => {
        await onDisk('A1', [{ id: 1, title: 'This window' }]);
        await primeCefrMoviesCache('A1');
        await flushAsync();
        expect(mockGet).not.toHaveBeenCalled();
      });

      it('sends no request when nothing was saved', async () => {
        await primeCefrMoviesCache('A1');
        await flushAsync();
        expect(mockGet).not.toHaveBeenCalled();
      });
    });
  });

  describe('drawHasRotated', () => {
    const now = Date.parse('2026-09-15T12:00:00Z');

    it('is false while the draw’s window is open', () => {
      expect(drawHasRotated({ seed: 1, nextRotationAt: '2026-09-15T15:00:00Z' }, now)).toBe(false);
    });

    it('is true from the instant the window closes', () => {
      expect(drawHasRotated({ seed: 1, nextRotationAt: '2026-09-15T12:00:00Z' }, now)).toBe(true);
    });

    it('is true when no draw was recorded, or the time is unreadable', () => {
      expect(drawHasRotated({ seed: null, nextRotationAt: null }, now)).toBe(true);
      expect(drawHasRotated({ seed: 1, nextRotationAt: 'not a date' }, now)).toBe(true);
    });
  });
});
