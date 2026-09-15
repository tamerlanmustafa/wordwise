import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * swrCache — generic stale-while-revalidate cache on AsyncStorage.
 *
 * Render last-known data instantly from disk, then refresh from the network in
 * the background. Two playbook wins in one primitive:
 *   • §7 perceived speed — screens that re-open show their data immediately
 *     instead of a spinner while the request is in flight.
 *   • §9 offline resilience — if the network fails, the cached data stays put
 *     rather than collapsing to an error/empty state.
 *
 * Mirrors the AsyncStorage style of services/offlineCache.ts (which is
 * vocab-specific); this one is type-generic and reusable for any read.
 *
 * ## "Instantly from disk" is one frame late
 *
 * A disk read is asynchronous, so a screen that reads its cache when it mounts
 * has already painted its loading state by the time the answer arrives. On a
 * lazily-mounted tab that is the first tap after every cold start: measured on
 * the film feed, ~300ms of skeleton rows in front of a list that was sitting
 * on disk the whole time.
 *
 * So entries this module has read or written are also held in memory, and
 * {@link peekCache} answers from there synchronously — inside a `useState`
 * initialiser, before the first paint. A {@link readCache} at launch loads an
 * entry ahead of the tab that will ask for it. Memory is a copy of disk, not
 * a second source of truth: it is only ever filled from a read or a write, and
 * {@link clearCacheMemory} empties it on sign-out alongside the disk wipe.
 */

const PREFIX = 'swr_';

interface Wrapped<T> {
  data: T;
  savedAt: number;
}

const memory = new Map<string, Wrapped<unknown>>();
/** Bumped by {@link clearCacheMemory}. A disk read that began before a
 *  sign-out must not write the previous account's data back into memory. */
let generation = 0;

function unexpired<T>(entry: Wrapped<T> | undefined, maxAgeMs?: number): T | null {
  if (!entry) return null;
  if (maxAgeMs != null && Date.now() - entry.savedAt > maxAgeMs) return null;
  return entry.data;
}

/** Keep the newer of two copies — a slow launch read must not overwrite a
 *  page the network wrote while it was in flight. */
function remember(key: string, entry: Wrapped<unknown>): void {
  const held = memory.get(key);
  if (!held || held.savedAt <= entry.savedAt) memory.set(key, entry);
}

/**
 * Read cached data for `key`. Returns null if missing, unparseable, or stale.
 * Also loads it into memory, which is how a launch-time read primes the
 * {@link peekCache} a screen makes later.
 */
export async function readCache<T>(key: string, maxAgeMs?: number): Promise<T | null> {
  const startedAt = generation;
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Wrapped<T>;
    if (typeof parsed?.savedAt === 'number' && startedAt === generation) remember(key, parsed);
    return unexpired(parsed, maxAgeMs);
  } catch {
    return null;
  }
}

/**
 * The cached data for `key`, synchronously, if this session has already read
 * or written it. Null does not mean "not cached" — only "not in memory"; a
 * caller that gets null still does its async {@link readCache}.
 */
export function peekCache<T>(key: string, maxAgeMs?: number): T | null {
  return unexpired(memory.get(key) as Wrapped<T> | undefined, maxAgeMs);
}

/** Forget everything held in memory. Disk is `clearAccountStorage`'s. */
export function clearCacheMemory(): void {
  memory.clear();
  generation += 1;
}

/** Which sign-in the memory belongs to. Bumped by {@link clearCacheMemory}, so
 *  a request that started under one value can tell it must not store its
 *  answer under another — the page would be the previous account's. */
export function cacheGeneration(): number {
  return generation;
}

/** Write data to the cache. Best-effort — never throws. */
export async function writeCache<T>(key: string, data: T): Promise<void> {
  const wrapped: Wrapped<T> = { data, savedAt: Date.now() };
  remember(key, wrapped);
  try {
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify(wrapped));
  } catch {
    // ignore — caching is an optimization, not a requirement
  }
}

export interface SwrCallbacks<T> {
  /** Called with cached data immediately (if any), then again with fresh data. */
  onData: (data: T, source: 'cache' | 'network') => void;
  /** Called only when the network fails *and* there was no cached data to show. */
  onError?: (err: unknown) => void;
}

/**
 * Emit cached data right away (if present), then revalidate over the network and
 * emit the fresh result. On network failure with a cache hit we stay silent and
 * keep showing the cached data (offline-resilient).
 */
export async function swr<T>(
  key: string,
  fetcher: () => Promise<T>,
  cb: SwrCallbacks<T>,
  opts?: { maxAgeMs?: number },
): Promise<void> {
  const cached = await readCache<T>(key, opts?.maxAgeMs);
  if (cached != null) cb.onData(cached, 'cache');
  try {
    const fresh = await fetcher();
    await writeCache(key, fresh);
    cb.onData(fresh, 'network');
  } catch (err) {
    if (cached == null) cb.onError?.(err);
  }
}
