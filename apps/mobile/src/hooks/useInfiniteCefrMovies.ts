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
 *
 * ## The recommendation seed
 *
 * `sort=recommended` is a seeded shuffle, not a column order, and OFFSET
 * pagination over a shuffle is only coherent if every page is drawn from the
 * *same* shuffle. The server hands back the `seed` it used on the first page;
 * every append must send that seed back. Let an append re-derive it — by
 * omitting it, or by reading the clock again — and page 2 is a slice of a
 * different ordering than page 1, which silently duplicates some films and
 * skips others. That is the one rule here that corrupts the feed rather than
 * erroring, so it is pinned by a test.
 *
 * A *reset* clears the seed, because a reset is a new draw by definition.
 * Pull-to-refresh is not a reset — it re-reads the same draw.
 *
 * ## Why page 0 is cached
 *
 * This tab is lazily mounted, so nothing happens until the user taps it — and
 * then they watch a skeleton while a request goes out and every film in the
 * page is enriched from TMDB. The word feed has not had that problem for
 * months because it keeps its last cards on disk and paints them before its
 * request is sent; this is the same trick, through the generic `swrCache`.
 *
 * Cache-first rather than prefetch-at-boot, deliberately. A prefetch removes
 * the wait only on the first tap of a *warm* session, spends a request on
 * every app open whether or not the tab is ever opened — on a single-process
 * API where speculative load is not free — and still shows a skeleton on a
 * cold start. Painting from disk removes the skeleton on every launch, works
 * offline, and costs the backend nothing: it is the same one request, just
 * issued behind the pixels instead of in front of them.
 *
 * The cache is **paint only**. It never advances `offset` and never supplies a
 * seed, so the pagination state stays owned by the live request — restoring a
 * seed from disk would page through a draw the server has since rotated away
 * from, which is the one failure mode here that corrupts the feed silently
 * rather than erroring.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { wordwiseApi, enrichMoviesWithTmdb } from '../services/api';
import { readCache, writeCache } from '../services/swrCache';
import {
  animatedParam,
  type LevelSort,
  type MovieType,
} from '../components/filmFeed/filterOptions';

/** The sort values `/movies/by-cefr` accepts. Same union the picker uses —
 *  a second copy is how a picker and a query drift apart. */
export type MovieSort = LevelSort;
export type SortOrder = 'asc' | 'desc';

const PAGE_SIZE = 10;

/**
 * How old a cached page may be and still be worth painting.
 *
 * Generous on purpose. The cache is never the answer — a fresh request is
 * already in flight beside it — so this only decides whether a stale list is
 * better than a skeleton for the ~400ms before the real one lands. A day-old
 * list of films is still a list of films; a skeleton is nothing. The
 * `recommended` draw rotates every 3 hours, and showing an older draw for a
 * moment is a far smaller cost than showing a grey rectangle every time.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** One entry per filter combination — a cached page from another level or
 *  sort is the wrong list, not a stale one. */
function cacheKey(level: string, sort: MovieSort, order: SortOrder, movieType: MovieType): string {
  return `movies.byCefr.${level}.${sort}.${order}.${movieType}`;
}

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

  const [nextRotationAt, setNextRotationAt] = useState<string | null>(null);

  const offsetRef = useRef(0);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);
  // Bumped on every request; only the latest request is allowed to write state.
  const reqIdRef = useRef(0);
  // The recommendation draw this feed is paging through — see the docblock.
  // A ref, not state: an append reads it in the same tick it was written by
  // the reset, and a state update would not have committed yet.
  const seedRef = useRef<number | null>(null);
  // The request id whose *network* answer has landed. A cache read that
  // resolves after it must not repaint the stale list over the fresh one —
  // disk is usually faster than the network, but not always.
  const answeredRef = useRef(0);
  // The request id the cache has painted for. On a failed load this is what
  // decides between "show the list we had" and "show nothing": without it the
  // outcome depends on whether the disk read or the network error arrived
  // first, which is the definition of a flaky screen.
  const paintedRef = useRef(0);

  /**
   * Show the last page 0 we stored for this filter, if it beats the network.
   *
   * Three guards, each for a different way this could show the wrong thing:
   * the filter may have changed since the read started; the live page may have
   * already landed; and a cache written before a schema change may hold
   * something that is not a list.
   */
  const paintFromCache = useCallback(async (reqId: number, key: string) => {
    const cached = await readCache<any[]>(key, CACHE_TTL_MS);
    if (!Array.isArray(cached) || cached.length === 0) return;
    if (reqId !== reqIdRef.current || answeredRef.current === reqId) return;
    paintedRef.current = reqId;
    setMovies(cached);
    // The skeleton goes away, but `loadingRef` stays set, so an append cannot
    // start against a draw whose seed and offset the live request still owns.
    setLoading(false);
  }, []);

  const fetchPage = useCallback(
    async (reset: boolean) => {
      // A reset always supersedes whatever is in flight; an append defers to it.
      if (!reset && (loadingRef.current || !hasMoreRef.current)) return;

      const key = cacheKey(level, sort, order, movieType);
      const reqId = ++reqIdRef.current;
      loadingRef.current = true;
      if (reset) {
        offsetRef.current = 0;
        hasMoreRef.current = true;
        // A reset is a new draw. Clearing it is what lets a level change (or a
        // rotation boundary crossed while Home was mounted) actually reshuffle.
        seedRef.current = null;
        setLoading(true);
        // Paint last session's page while this request is in flight. Not
        // awaited: the whole point is that the disk read and the network
        // request race, and whichever arrives first shows something.
        void paintFromCache(reqId, key);
      } else {
        setLoadingMore(true);
      }

      try {
        const res = await wordwiseApi.getMoviesByCefr(level, PAGE_SIZE, {
          offset: offsetRef.current,
          sort,
          order,
          animated: animatedParam(movieType),
          // Only Recommended is seeded; the column sorts are already stable
          // and a seed on them would be a param the server has to ignore.
          seed: sort === 'recommended' ? seedRef.current ?? undefined : undefined,
        });
        const raw = (res.movies || []).map((m: any) => ({
          ...m,
          id: m.tmdb_id || m.movie_id,
        }));
        const enriched = await enrichMoviesWithTmdb(raw);

        // A newer filter/reset started while we were awaiting — drop this page.
        if (reqId !== reqIdRef.current) return;
        // Claim this request before writing, so a slower cache read for the
        // same request knows it has been beaten and stays quiet.
        answeredRef.current = reqId;

        // Adopt the draw the server picked, before anything appends to it.
        // Only on a reset: an append echoes back the seed it was sent, and
        // re-adopting it every page would hide a bug where it did not.
        if (reset) {
          seedRef.current = res.seed ?? null;
          setNextRotationAt(res.next_rotation_at ?? null);
          // Store the enriched page, posters and all, so the next launch
          // paints a finished list rather than one that fills in.
          // Fire-and-forget: caching is an optimisation, never a step the
          // user waits behind.
          void writeCache(key, enriched);
        }

        offsetRef.current += raw.length;
        hasMoreRef.current = !!res.has_more;
        setHasMore(!!res.has_more);
        setMovies((prev) => (reset ? enriched : [...prev, ...enriched]));
        setError(null);
      } catch (e: any) {
        if (reqId !== reqIdRef.current) return;
        setError(e?.message || 'Failed to load movies');
        // Empty the list only when there is nothing better to show. If the
        // cache painted, the user keeps last session's films — which is the
        // whole point of caching a read: on a plane or a bad connection, a
        // slightly stale list beats an empty screen. `paintedRef` makes that
        // independent of whether the disk or the error arrived first.
        if (reset && paintedRef.current !== reqId) setMovies([]);
      } finally {
        // Only the current request owns the loading flags / lock.
        if (reqId === reqIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
          loadingRef.current = false;
        }
      }
    },
    [level, sort, order, movieType, paintFromCache],
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
    /** ISO instant this recommendation draw expires. Null on the column
     *  sorts, and null until the first page lands. */
    nextRotationAt,
  };
}
