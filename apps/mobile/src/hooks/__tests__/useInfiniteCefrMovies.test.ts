jest.mock('../../services/api', () => ({
  wordwiseApi: { getMoviesByCefr: jest.fn() },
  // Identity enrichment keeps assertions about ordering/ids simple.
  enrichMoviesWithTmdb: jest.fn(async (rows: unknown[]) => rows),
}));

import { useInfiniteCefrMovies } from '../useInfiniteCefrMovies';
import { wordwiseApi, enrichMoviesWithTmdb } from '../../services/api';
import { renderHook, flushAsync, act, cleanupHooks } from '../../test-utils/renderHook';
import type { MovieType } from '../../components/home/filterOptions';

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
  beforeEach(() => {
    jest.clearAllMocks();
    (enrichMoviesWithTmdb as jest.Mock).mockImplementation(async (rows: unknown[]) => rows);
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
});
