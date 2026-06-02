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
 */

const PREFIX = 'swr_';

interface Wrapped<T> {
  data: T;
  savedAt: number;
}

/** Read cached data for `key`. Returns null if missing, unparseable, or stale. */
export async function readCache<T>(key: string, maxAgeMs?: number): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Wrapped<T>;
    if (maxAgeMs != null && Date.now() - parsed.savedAt > maxAgeMs) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/** Write data to the cache. Best-effort — never throws. */
export async function writeCache<T>(key: string, data: T): Promise<void> {
  try {
    const wrapped: Wrapped<T> = { data, savedAt: Date.now() };
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
