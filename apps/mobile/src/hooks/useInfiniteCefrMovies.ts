/**
 * useInfiniteCefrMovies — paginated, server-sorted CEFR movie feed for the
 * home RankedMovieList.
 *
 * The backend (`/movies/by-cefr`) does the sorting and pagination, so each
 * filter/sort combination returns a globally-correct ordering rather than a
 * client-side reshuffle of a fixed page. Each page is enriched with TMDB
 * poster/backdrop data as it arrives (never the whole catalog up front).
 *
 * Changing `level`, `sort`, or `order` resets the feed to page 0. A request-id
 * guard discards responses from a superseded filter so a slow in-flight page
 * can't clobber a newer one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { wordwiseApi, enrichMoviesWithTmdb } from '../services/api';

export type MovieSort = 'rating' | 'popularity' | 'level';
export type SortOrder = 'asc' | 'desc';

const PAGE_SIZE = 10;

export function useInfiniteCefrMovies(
  level: string,
  sort: MovieSort,
  order: SortOrder,
) {
  const [movies, setMovies] = useState<any[]>([]);
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
    [level, sort, order],
  );

  // Reset to page 0 whenever the filter or sort changes.
  useEffect(() => {
    fetchPage(true);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    fetchPage(false);
  }, [fetchPage]);

  return { movies, loading, loadingMore, hasMore, error, loadMore, reload: () => fetchPage(true) };
}
