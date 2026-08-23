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

const page = (movies: Array<{ tmdb_id?: number; movie_id?: number; title: string }>, has_more: boolean) => ({
  level: 'B1',
  total: 99,
  offset: 0,
  has_more,
  movies,
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
});
