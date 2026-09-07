/**
 * useAdminWordList — one CEFR band of the lemma registry, paged.
 *
 * Backs the level tabs on the admin Words page. Selecting a tab is a *reset*
 * (page 0 of a different list); scrolling to the end is an *append*.
 *
 * ## Why the guards look like this
 *
 * Nothing here is novel — it is the shape `useInfiniteCefrMovies` already
 * uses, for the same three reasons, and the reasons are worth restating
 * because each one is a bug you only see on a slow connection:
 *
 *  - **A request-id guard.** Tapping A1 then C2 before A1 lands must not paint
 *    A1's words under a C2 tab. Only the newest request may write state, so a
 *    superseded response is dropped rather than raced.
 *  - **Offset from a ref, not from state.** `words.length` inside a callback
 *    is the value from the render that created it, so two quick end-reaches
 *    would both compute the same offset and fetch the same page twice —
 *    appending it twice. The ref is written in the same tick the page lands.
 *  - **An in-flight lock that only appends respect.** A reset always
 *    supersedes what is in flight; an append defers to it, because appending
 *    onto a list that is about to be replaced is wasted work at best and a
 *    mixed-level list at worst.
 *
 * `level = null` means no tab is selected: the hook holds no list and issues
 * no request. That is the page's default, so opening Words still costs exactly
 * the one panel call it costs today.
 *
 * Not cached to disk, unlike the film feed. This is an admin diagnostic read
 * where a stale answer is worse than a spinner — the whole reason to open it
 * is to see what a backfill just did.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminApi, type AdminWord, type AdminWordSort } from '../services/api';

export const WORD_PAGE_SIZE = 40;

export function useAdminWordList(level: string | null, sort: AdminWordSort = 'frequency') {
  const [words, setWords] = useState<AdminWord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // How many rows we hold. Read synchronously as the next page's offset —
  // see the docblock.
  const countRef = useRef(0);
  const hasMoreRef = useRef(false);
  const loadingRef = useRef(false);
  // Bumped on every request; only the latest may write state.
  const reqIdRef = useRef(0);

  const fetchPage = useCallback(
    async (reset: boolean) => {
      if (!level) return;
      // A reset always supersedes whatever is in flight; an append defers.
      if (!reset && (loadingRef.current || !hasMoreRef.current)) return;

      const reqId = ++reqIdRef.current;
      loadingRef.current = true;
      const offset = reset ? 0 : countRef.current;
      if (reset) {
        countRef.current = 0;
        hasMoreRef.current = false;
        setWords([]);
        setLoading(true);
      } else {
        setLoadingMore(true);
      }

      try {
        const page = await adminApi.wordList({
          level,
          sort,
          offset,
          limit: WORD_PAGE_SIZE,
        });
        // A newer tab or sort started while this was awaiting — drop it.
        if (reqId !== reqIdRef.current) return;

        countRef.current = offset + page.words.length;
        hasMoreRef.current = page.has_more;
        setHasMore(page.has_more);
        setWords((prev) => (reset ? page.words : [...prev, ...page.words]));
        setError(null);
      } catch (e: any) {
        if (reqId !== reqIdRef.current) return;
        setError(e?.message || 'Failed to load words');
        // Only a reset clears the list. An append that fails leaves the rows
        // already on screen alone — losing a list you were reading because
        // page 4 timed out is a worse outcome than a short list.
        if (reset) {
          setWords([]);
          setHasMore(false);
          hasMoreRef.current = false;
        }
      } finally {
        if (reqId === reqIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
          loadingRef.current = false;
        }
      }
    },
    [level, sort],
  );

  // Reset whenever the tab or the sort changes. Deselecting clears the list
  // rather than leaving the last band's words behind the closed tab.
  useEffect(() => {
    if (!level) {
      reqIdRef.current++;
      countRef.current = 0;
      hasMoreRef.current = false;
      loadingRef.current = false;
      setWords([]);
      setHasMore(false);
      setLoading(false);
      setLoadingMore(false);
      setError(null);
      return;
    }
    void fetchPage(true);
  }, [level, fetchPage]);

  const loadMore = useCallback(() => {
    void fetchPage(false);
  }, [fetchPage]);

  return {
    words,
    loading,
    loadingMore,
    hasMore,
    error,
    loadMore,
    reload: useCallback(() => fetchPage(true), [fetchPage]),
  };
}
