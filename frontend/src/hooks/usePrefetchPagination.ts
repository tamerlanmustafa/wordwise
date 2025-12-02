import { useEffect, useRef } from 'react';
import { translateBatch } from '../services/scriptService';

interface TranslatedWord {
  word: string;
  lemma: string;
  translation: string;
  confidence?: number;
  cached: boolean;
  provider?: string | null;
}

interface CEFRGroup {
  level: string;
  description: string;
  words: Array<{ word: string; lemma?: string }>;
  translatedWords: Map<string, TranslatedWord>;
  color: string;
  currentPage: number;
  totalPages: number;
}

interface UsePrefetchPaginationOptions {
  groups: CEFRGroup[];
  activeTab: number;
  targetLanguage: string;
  userId?: number;
  isPreview: boolean;
  isAuthenticated: boolean;
  wordsPerPage: number;
  onPrefetchComplete: (tabIndex: number, newTranslations: Map<string, TranslatedWord>) => void;
}

/**
 * Production-ready pagination prefetch hook
 *
 * Automatically prefetches translations for the next page in the background
 * to provide instant pagination experience similar to Instagram/TikTok/YouTube.
 *
 * Features:
 * - Fire-and-forget background prefetch
 * - Smart caching (only fetches missing translations)
 * - Automatic cancellation on unmount/navigation
 * - Zero double loads
 * - No UI changes required
 */
export function usePrefetchPagination({
  groups,
  activeTab,
  targetLanguage,
  userId,
  isPreview,
  isAuthenticated,
  wordsPerPage,
  onPrefetchComplete
}: UsePrefetchPaginationOptions) {
  const abortControllerRef = useRef<AbortController | null>(null);
  const prefetchedPagesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Reset prefetch cache when language changes
    prefetchedPagesRef.current.clear();
  }, [targetLanguage]);

  useEffect(() => {
    // Don't prefetch in preview mode or when not authenticated
    if (isPreview || !isAuthenticated || groups.length === 0) {
      return;
    }

    const activeGroup = groups[activeTab];
    if (!activeGroup) return;

    const { currentPage, totalPages, words, translatedWords } = activeGroup;
    const nextPage = currentPage + 1;

    // Only prefetch if there's a next page
    if (nextPage > totalPages) {
      return;
    }

    // Generate cache key for this prefetch
    const cacheKey = `${activeTab}-${nextPage}-${targetLanguage}`;

    // Skip if already prefetched
    if (prefetchedPagesRef.current.has(cacheKey)) {
      return;
    }

    // Cancel any ongoing prefetch
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller for this prefetch
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Start prefetch in background
    const prefetchNextPage = async () => {
      try {
        // Calculate next page words
        const startIdx = (nextPage - 1) * wordsPerPage;
        const endIdx = startIdx + wordsPerPage;
        const nextPageWords = words.slice(startIdx, endIdx);

        // Filter out words we already have translations for
        const wordsToTranslate = nextPageWords.filter(w =>
          w.word && w.word.trim() && !translatedWords.has(w.word.toLowerCase())
        );

        // If all translations already cached, mark as prefetched and exit
        if (wordsToTranslate.length === 0) {
          prefetchedPagesRef.current.add(cacheKey);
          return;
        }

        // Get unique words to translate
        const uniqueWords = Array.from(new Set(wordsToTranslate.map(w => w.word)))
          .filter(w => w != null && typeof w === 'string' && w.trim().length > 0);

        if (uniqueWords.length === 0) {
          prefetchedPagesRef.current.add(cacheKey);
          return;
        }

        // Fire-and-forget background API call
        const batchResponse = await translateBatch(
          uniqueWords,
          targetLanguage,
          'auto',
          userId
        );

        // Check if prefetch was cancelled
        if (controller.signal.aborted) {
          return;
        }

        // Build new translations map
        const newTranslations = new Map<string, TranslatedWord>();

        batchResponse.results.forEach((result) => {
          const sourceLower = result.source.toLowerCase();
          const translationLower = result.translated.toLowerCase();

          // Skip if source and translation are the same
          if (sourceLower !== translationLower) {
            newTranslations.set(sourceLower, {
              word: sourceLower,
              lemma: sourceLower,
              translation: translationLower,
              confidence: undefined,
              cached: result.cached,
              provider: result.provider
            });
          }
        });

        // Mark as prefetched
        prefetchedPagesRef.current.add(cacheKey);

        // Call callback to update parent state
        onPrefetchComplete(activeTab, newTranslations);

        console.log(`[Prefetch] Successfully prefetched page ${nextPage} for tab ${activeTab} (${newTranslations.size} translations)`);
      } catch (error: any) {
        // Silently ignore errors (fire-and-forget)
        if (error.name !== 'AbortError' && error.name !== 'CanceledError') {
          console.warn('[Prefetch] Background prefetch failed (non-critical):', error.message);
        }
      }
    };

    // Start prefetch
    prefetchNextPage();

    // Cleanup: cancel prefetch on unmount or when dependencies change
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [
    groups,
    activeTab,
    targetLanguage,
    userId,
    isPreview,
    isAuthenticated,
    wordsPerPage,
    onPrefetchComplete
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);
}
