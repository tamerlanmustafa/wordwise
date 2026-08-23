/**
 * useInfiniteCefrMovies — paginated, server-sorted CEFR movie feed for the
 * home RankedMovieList.
 *
 * The backend (`/movies/by-cefr`) does the sorting and pagination, so each
 * filter/sort combination returns a globally-correct ordering rather than a
 * client-side reshuffle of a fixed page. Each page is enriched with TMDB
 * poster/backdrop data as it arrives (never the whole catalog up front).
 *
 * Changing `level`, `sort`, `order`, or `movieType` resets the feed to page 0.
 * A request-id guard discards responses from a superseded filter so a slow
 * in-flight page can't clobber a newer one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { wordwiseApi, enrichMoviesWithTmdb } from '../services/api';
import { animatedParam, type MovieType } from '../components/home/filterOptions';

export type MovieSort = 'rating' | 'popularity' | 'level';
export type SortOrder = 'asc' | 'desc';

const PAGE_SIZE = 10;

export function useInfiniteCefrMovies(
  level: string,
  sort: MovieSort,
  order: SortOrder,
  /** Animation vs live action (#114). Filtered server-side: the feed is
   *  paginated, so narrowing a page here would return short pages and skip
   *  every match past the page boundary. */
  movieType: MovieType = 'all',
) {
  const [movies, setMovies] = useState<any[]>([]);
  // Mirror of `movies` for synchronous reads (removeMovie needs the current
  // index before the async state update commits).
  const moviesRef = useRef<any[]>([]);
  useEffect(() => {
    moviesRef.current = movies;
  }, [movies]);
  const [loading, setLoading] = useState(true);       // initial / filter-reset load
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const offsetRef = useRef(0);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);
  // Bumped on every request; only the latest request is allowed to write state.
  const reqIdRef = useRef(0);

  const fetchPage = useCallback(
    async (reset: boolean) => {
      // A reset always supersedes whatever is in flight; an append defers to it.
      if (!reset && (loadingRef.current || !hasMoreRef.current)) return;

      const reqId = ++reqIdRef.current;
      loadingRef.current = true;
      if (reset) {
        offsetRef.current = 0;
        hasMoreRef.current = true;
        setLoading(true);
      } else {
        setLoadingMore(true);
      }

      try {
        const res = await wordwiseApi.getMoviesByCefr(level, PAGE_SIZE, {
          offset: offsetRef.current,
          sort,
          order,
          animated: animatedParam(movieType),
        });
        const raw = (res.movies || []).map((m: any) => ({
          ...m,
          id: m.tmdb_id || m.movie_id,
        }));
        const enriched = await enrichMoviesWithTmdb(raw);

        // A newer filter/reset started while we were awaiting — drop this page.
        if (reqId !== reqIdRef.current) return;

        offsetRef.current += raw.length;
        hasMoreRef.current = !!res.has_more;
        setHasMore(!!res.has_more);
        setMovies((prev) => (reset ? enriched : [...prev, ...enriched]));
        setError(null);
      } catch (e: any) {
        if (reqId !== reqIdRef.current) return;
        setError(e?.message || 'Failed to load movies');
        if (reset) setMovies([]);
      } finally {
        // Only the current request owns the loading flags / lock.
        if (reqId === reqIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
          loadingRef.current = false;
        }
      }
    },
    [level, sort, order, movieType],
  );

  // Reset to page 0 whenever the filter or sort changes.
  useEffect(() => {
    fetchPage(true);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    fetchPage(false);
  }, [fetchPage]);

  // Optimistic removal for the home-feed swipe actions (watched / not
  // interested). Returns the removed item's index so the caller can restore it
  // in the same spot if the user taps Undo, or -1 if it wasn't in the feed.
  // Reads from moviesRef (kept in sync below) so the index is available
  // synchronously — the setMovies updater does not run inline.
  const removeMovie = useCallback((tmdbId: number): number => {
    const idx = moviesRef.current.findIndex((m) => (m.tmdb_id ?? m.id) === tmdbId);
    if (idx === -1) return -1;
    setMovies((prev) => prev.filter((m) => (m.tmdb_id ?? m.id) !== tmdbId));
    return idx;
  }, []);

  const insertMovie = useCallback((movie: any, index: number) => {
    setMovies((prev) => {
      const next = prev.slice();
      next.splice(Math.max(0, Math.min(index, next.length)), 0, movie);
      return next;
    });
  }, []);

  return {
    movies,
    loading,
    loadingMore,
    hasMore,
    error,
    loadMore,
    reload: () => fetchPage(true),
    removeMovie,
    insertMovie,
  };
}
