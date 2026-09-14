/**
 * swrCache's memory copy — what lets a lazily-mounted tab draw its cached data
 * in its first frame instead of one frame after it.
 *
 * Measured before it existed, on the film feed's first tap after a cold start:
 * ~300ms of skeleton rows in front of a page that was already on disk, because
 * a disk read is asynchronous and the tab had painted by the time it answered.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearCacheMemory, peekCache, readCache, writeCache } from '../swrCache';

describe('swrCache memory', () => {
  beforeEach(async () => {
    clearCacheMemory();
    await AsyncStorage.clear();
  });

  it('has nothing to peek until the entry has been read or written', async () => {
    await AsyncStorage.setItem('swr_k', JSON.stringify({ data: [1], savedAt: Date.now() }));
    // On disk is not in memory: a peek must not pretend a read happened.
    expect(peekCache('k')).toBeNull();

    await readCache('k');
    expect(peekCache('k')).toEqual([1]);
  });

  it('holds what was written, synchronously', async () => {
    const pending = writeCache('k', { a: 1 });
    // Before the disk write settles — a page written by the network is
    // peekable at once, not after AsyncStorage answers.
    expect(peekCache('k')).toEqual({ a: 1 });
    await pending;
  });

  it('applies the same lifetime a disk read does', async () => {
    await writeCache('k', 'old');
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 60_000);
    expect(peekCache('k', 30_000)).toBeNull();
    expect(peekCache('k', 120_000)).toBe('old');
    (Date.now as jest.Mock).mockRestore();
  });

  it('is emptied by clearCacheMemory', async () => {
    await writeCache('k', 'mine');
    clearCacheMemory();
    expect(peekCache('k')).toBeNull();
  });

  it('does not let a read begun before a sign-out refill memory after it', async () => {
    // The launch read is racing the sign-out: the previous account's page
    // must not land in memory for the next account to peek.
    await AsyncStorage.setItem('swr_k', JSON.stringify({ data: 'theirs', savedAt: Date.now() }));
    const read = readCache('k');
    clearCacheMemory();
    await read;
    expect(peekCache('k')).toBeNull();
  });

  it('keeps the newer copy when a slow disk read lands after a write', async () => {
    // Launch primes from disk while the feed's request lands and writes a
    // fresh page. Whichever arrives last, memory holds the fresh one.
    await AsyncStorage.setItem('swr_k', JSON.stringify({ data: 'stale', savedAt: Date.now() - 1000 }));
    const read = readCache('k');
    await writeCache('k', 'fresh');
    await read;
    expect(peekCache('k')).toBe('fresh');
  });

  it('still reads entries written without a timestamp', async () => {
    await AsyncStorage.setItem('swr_k', JSON.stringify({ data: 'legacy' }));
    expect(await readCache('k', 1000)).toBe('legacy');
  });
});
