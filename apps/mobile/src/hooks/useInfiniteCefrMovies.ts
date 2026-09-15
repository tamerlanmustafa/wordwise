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
 * A *reset* starts a new draw — unless it paints a saved page, in which case it
 * keeps that page's draw (see "The shelf never reshuffles on screen").
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
 * Cache-first rather than prefetch-at-boot. An unconditional prefetch spends a
 * request on every app open whether or not the tab is ever opened — on a
 * single-process API where speculative load is not free — and still shows a
 * skeleton on a cold start. Painting from disk removes the skeleton on every
 * launch and works offline. The one launch request this file does send is
 * conditional: only when the saved Recommended draw has rotated (below).
 *
 * The cache never supplies an offset: the live request's page 0 replaces the
 * painted one before anything can append. It does supply the draw.
 *
 * ## Painted on the first frame, not after it
 *
 * Reading that cache when the tab mounted still showed the skeleton first:
 * the read is asynchronous, so the first paint had nothing. Measured on the
 * first tap after a cold start, ~300ms of skeleton rows in front of a page that
 * was on disk all along. {@link primeCefrMoviesCache} reads it at launch
 * instead, and the hook takes it from memory in its initial state — so the
 * list is in the very first frame.
 *
 * ## The shelf never reshuffles on screen
 *
 * Recommended rotates every three hours. A page cached in one window and
 * painted in the next is a different shuffle from the one the live request
 * returns, and while the cache only painted pixels, that answer replaced the
 * painted list about a second after the tab opened: the same kind of shelf,
 * reordered, in front of the reader. Every cold start after a rotation did it.
 *
 * So a cached page carries the draw it came from, and two rules keep that draw
 * from changing on screen:
 *
 * - **At launch, the current draw is fetched behind the tab.** If the saved
 *   page's draw has rotated, {@link primeCefrMoviesCache} requests the current
 *   one and stores it before anyone taps Explore, so the first frame is already
 *   the current shelf. That is a request only when the saved draw has rotated
 *   — at most once per window — and none when it has not.
 * - **A reset that paints a saved page asks for that page's draw.** If the tab
 *   opens before the launch request lands, the reader keeps the shelf they are
 *   looking at for the visit, and the new one is there at the next launch. The
 *   server honours any seed and every page of the scroll sends the same one, so
 *   paging an older draw is exactly as coherent as paging the current one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { classifyFailure, type ConnectionFailure } from '../services/connection';
import { wordwiseApi, enrichMoviesWithTmdb } from '../services/api';
import { cacheGeneration, peekCache, readCache, writeCache } from '../services/swrCache';
import {
  animatedParam,
  DEFAULT_FEED_FILTERS,
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
 * already in flight beside it — so this only decides whether a saved list is
 * better than a skeleton for the ~400ms before the real one lands. A day-old
 * list of films is still a list of films; a skeleton is nothing. What an older
 * Recommended draw may never do is reshuffle on screen — see the docblock.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** One entry per filter combination — a cached page from another level or
 *  sort is the wrong list, not a stale one. */
function cacheKey(level: string, sort: MovieSort, order: SortOrder, movieType: MovieType): string {
  return `movies.byCefr.${level}.${sort}.${order}.${movieType}`;
}

/**
 * A cached page 0, and the Recommended draw it came from.
 *
 * `seed` and `nextRotationAt` are null on the column sorts, and on a page
 * cached before the draw was stored — which counts as a rotated draw, because
 * nothing says it is still current.
 */
interface CachedPage {
  movies: any[];
  seed: number | null;
  nextRotationAt: string | null;
}

/** Only a non-empty list counts: a cache written before a schema change may
 *  hold something that is not one. A bare array is the format from before the
 *  draw was stored. */
function asCachedPage(data: unknown): CachedPage | null {
  if (Array.isArray(data)) {
    return data.length > 0 ? { movies: data, seed: null, nextRotationAt: null } : null;
  }
  const entry = data as Partial<CachedPage> | null;
  if (!entry || !Array.isArray(entry.movies) || entry.movies.length === 0) return null;
  return {
    movies: entry.movies,
    seed: typeof entry.seed === 'number' ? entry.seed : null,
    nextRotationAt: typeof entry.nextRotationAt === 'string' ? entry.nextRotationAt : null,
  };
}

/** A cached page 0 already in memory and young enough to paint, or null. */
function pageInMemory(key: string): CachedPage | null {
  return asCachedPage(peekCache<unknown>(key, CACHE_TTL_MS));
}

/**
 * A cached page this feed may paint for `sort`, or null.
 *
 * Painting a Recommended page is a promise that the live answer will not
 * reshuffle it, kept by asking for the page's draw. A page saved before draws
 * were recorded has none to ask for, so it cannot keep that promise and is not
 * painted. Measured on an iPhone SE: painted on a fast tap, it was swapped for
 * the current shelf 270ms later. Unpainted, that tap sees the skeleton once, on
 * the first launch after the update, and every page saved since carries its draw.
 */
function paintablePage(key: string, sort: MovieSort): CachedPage | null {
  const page = pageInMemory(key);
  if (!page) return null;
  return sort === 'recommended' && page.seed === null ? null : page;
}

/** Whether a Recommended page's draw has rotated out — or was never recorded. */
export function drawHasRotated(
  page: { seed: number | null; nextRotationAt: string | null },
  now: number = Date.now(),
): boolean {
  if (page.seed === null || page.nextRotationAt === null) return true;
  const ends = Date.parse(page.nextRotationAt);
  return !Number.isFinite(ends) || now >= ends;
}

interface PageRequest {
  level: string;
  sort: MovieSort;
  order: SortOrder;
  movieType: MovieType;
  offset: number;
  /** The draw to page through; null asks the server for the current one. */
  seed: number | null;
}

/** One page of `/movies/by-cefr`, enriched with TMDB pictures. The hook and the
 *  launch refresh share it, so the two cannot ask different questions. */
async function requestPage({ level, sort, order, movieType, offset, seed }: PageRequest) {
  const res = await wordwiseApi.getMoviesByCefr(level, PAGE_SIZE, {
    offset,
    sort,
    order,
    animated: animatedParam(movieType),
    // Only Recommended is seeded; the column sorts are already stable and a
    // seed on them would be a param the server has to ignore.
    seed: sort === 'recommended' ? seed ?? undefined : undefined,
  });
  const raw = (res.movies || []).map((m: any) => ({
    ...m,
    id: m.tmdb_id || m.movie_id,
  }));
  return {
    movies: await enrichMoviesWithTmdb(raw),
    count: raw.length,
    hasMore: !!res.has_more,
    seed: res.seed ?? null,
    nextRotationAt: res.next_rotation_at ?? null,
  };
}

/**
 * Store a fetched page 0 — unless memory already holds a newer draw of it.
 *
 * Two writers race for the page the feed opens on: the launch refresh, which
 * fetched the current draw, and a tab opened before that landed, whose own
 * request asked for the older draw it had painted. Whichever answers second
 * must not put the older shelf back, or the next launch would open on it.
 */
async function savePage(key: string, page: CachedPage): Promise<void> {
  const held = asCachedPage(peekCache<unknown>(key));
  if (held?.seed != null && page.seed != null && held.seed > page.seed) return;
  await writeCache(key, page);
}

/** Launch refreshes in flight, per page — priming the same page twice waits on
 *  the first request rather than sending a second. */
const refreshing = new Map<string, Promise<CachedPage | null>>();

function refreshPage(
  key: string,
  filter: Omit<PageRequest, 'offset' | 'seed'>,
): Promise<CachedPage | null> {
  const inFlight = refreshing.get(key);
  if (inFlight) return inFlight;
  const generation = cacheGeneration();
  const run = (async () => {
    try {
      const fresh = await requestPage({ ...filter, offset: 0, seed: null });
      // Signed out while it was in flight: the page is the previous account's.
      if (generation !== cacheGeneration() || fresh.movies.length === 0) return null;
      const page: CachedPage = {
        movies: fresh.movies,
        seed: fresh.seed,
        nextRotationAt: fresh.nextRotationAt,
      };
      await savePage(key, page);
      return page;
    } catch {
      // Offline, or the server is down: the saved page still paints.
      return null;
    } finally {
      refreshing.delete(key);
    }
  })();
  refreshing.set(key, run);
  return run;
}

/**
 * Load the page the film feed will open on into memory before its tab is
 * tapped — and, if that page's Recommended draw has rotated since it was
 * saved, fetch the current one behind it.
 *
 * The screen opens on the default filters at the reader's level (see
 * `FilmFeedScreen`), so that is the one page worth this. The disk read is what
 * puts a list in the tab's first frame; the refresh is what makes that list the
 * current shelf instead of one swapped for it a second later. It sends a
 * request only when a saved draw has rotated — never when the saved draw is
 * current, and never when nothing was saved.
 *
 * `onPage` is called with each page this puts in memory — the saved one, then
 * the refreshed one — so the caller can warm its pictures. Resolves to the
 * saved page without waiting for the refresh.
 */
export async function primeCefrMoviesCache(
  level: string,
  onPage?: (movies: any[]) => void,
): Promise<any[] | null> {
  const filter = {
    level,
    sort: DEFAULT_FEED_FILTERS.sort,
    order: (DEFAULT_FEED_FILTERS.sortAsc ? 'asc' : 'desc') as SortOrder,
    movieType: DEFAULT_FEED_FILTERS.movieType,
  };
  const key = cacheKey(filter.level, filter.sort, filter.order, filter.movieType);
  // No age limit on this read: a page too old to paint still answers whether
  // its draw has rotated. It is also what fills memory for `pageInMemory`.
  const saved = asCachedPage(await readCache<unknown>(key));
  const paintable = pageInMemory(key);
  if (paintable) onPage?.(paintable.movies);
  if (saved && filter.sort === 'recommended' && drawHasRotated(saved)) {
    void refreshPage(key, filter).then((fresh) => {
      if (fresh) onPage?.(fresh.movies);
    });
  }
  return paintable?.movies ?? null;
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
  // Whatever launch already read, so the first render is the list rather than
  // a skeleton that the list replaces a moment later.
  const [initialPage] = useState(() =>
    paintablePage(cacheKey(level, sort, order, movieType), sort),
  );
  const [movies, setMovies] = useState<any[]>(initialPage?.movies ?? []);
  // Mirror of `movies` for synchronous reads (removeMovie needs the current
  // index before the async state update commits).
  const moviesRef = useRef<any[]>(movies);
  useEffect(() => {
    moviesRef.current = movies;
  }, [movies]);
  const [loading, setLoading] = useState(initialPage === null); // initial / filter-reset load
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** The same failure, classified. `error` is a message for logs; this is what
   *  decides which sentence the reader gets, and it has to be captured HERE —
   *  by the time the string exists the thrown object is gone, and with it the
   *  only reliable way to tell "no network" from "our server". */
  const [failure, setFailure] = useState<ConnectionFailure | null>(null);

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
  // The request id whose network request failed. Once it has, a saved page is
  // worth showing whatever its draw: there is no answer left to reshuffle it.
  const failedRef = useRef(0);

  /**
   * Show the last page 0 we stored for this filter, if it beats the network.
   *
   * Four guards, each for a different way this could show the wrong thing:
   * the filter may have changed since the read started; the live page may have
   * already landed; a cache written before a schema change may hold something
   * that is not a list; and a Recommended page from an older draw would be
   * reshuffled by the answer this request is already waiting for.
   */
  const paintFromCache = useCallback(async (reqId: number, key: string, seeded: boolean) => {
    const cached = asCachedPage(await readCache<unknown>(key, CACHE_TTL_MS));
    if (!cached) return;
    if (reqId !== reqIdRef.current || answeredRef.current === reqId) return;
    // This request went out before the disk answered, so it asked for the
    // current draw. An older draw painted now would be swapped the moment that
    // answer lands, so the skeleton stays and the list arrives once.
    if (seeded && drawHasRotated(cached) && failedRef.current !== reqId) return;
    paintedRef.current = reqId;
    setMovies(cached.movies);
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
        const inMemory = paintablePage(key, sort);
        // A reset is a new draw — unless it paints a saved page. Then it asks
        // for that page's draw, so the answer replaces the list with the same
        // films in the same order instead of reshuffling it in front of the
        // reader. With nothing to paint the seed is cleared and the server
        // picks the current window, which is how a level change reaches the
        // screen as a new draw.
        seedRef.current = inMemory?.seed ?? null;
        if (inMemory) {
          // Already read this session: paint it in this same render, so the
          // skeleton never shows at all rather than showing for one frame.
          paintedRef.current = reqId;
          setMovies(inMemory.movies);
          setLoading(false);
        } else {
          setLoading(true);
          // Paint last session's page while this request is in flight. Not
          // awaited: the whole point is that the disk read and the network
          // request race, and whichever arrives first shows something.
          void paintFromCache(reqId, key, sort === 'recommended');
        }
      } else {
        setLoadingMore(true);
      }

      try {
        const fresh = await requestPage({
          level,
          sort,
          order,
          movieType,
          offset: offsetRef.current,
          seed: seedRef.current,
        });

        // A newer filter/reset started while we were awaiting — drop this page.
        if (reqId !== reqIdRef.current) return;
        // Claim this request before writing, so a slower cache read for the
        // same request knows it has been beaten and stays quiet.
        answeredRef.current = reqId;

        // Adopt the draw the server answered with, before anything appends to
        // it. Only on a reset: an append echoes back the seed it was sent, and
        // re-adopting it every page would hide a bug where it did not.
        if (reset) {
          seedRef.current = fresh.seed;
          setNextRotationAt(fresh.nextRotationAt);
          // Store the enriched page, posters and all, so the next launch
          // paints a finished list rather than one that fills in.
          // Fire-and-forget: caching is an optimisation, never a step the
          // user waits behind.
          void savePage(key, {
            movies: fresh.movies,
            seed: fresh.seed,
            nextRotationAt: fresh.nextRotationAt,
          });
        }

        offsetRef.current += fresh.count;
        hasMoreRef.current = fresh.hasMore;
        setHasMore(fresh.hasMore);
        setMovies((prev) => (reset ? fresh.movies : [...prev, ...fresh.movies]));
        setError(null);
        setFailure(null);
      } catch (e: any) {
        if (reqId !== reqIdRef.current) return;
        failedRef.current = reqId;
        setError(e?.message || 'Failed to load movies');
        setFailure(classifyFailure(e));
        // Empty the list only when there is nothing better to show. If the
        // cache painted, the user keeps last session's films — which is the
        // whole point of caching a read: on a plane or a bad connection, a
        // slightly stale list beats an empty screen. A page held back because
        // its draw had rotated counts too, now that nothing can reshuffle it.
        if (reset && paintedRef.current !== reqId) {
          const saved = pageInMemory(key);
          setMovies(saved ? saved.movies : []);
        }
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
    failure,
    loadMore,
    reload: () => fetchPage(true),
    removeMovie,
    insertMovie,
    /** ISO instant this recommendation draw expires. Null on the column
     *  sorts, and null until the first page lands. */
    nextRotationAt,
  };
}
