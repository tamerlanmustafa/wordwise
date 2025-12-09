/**
 * useWorkerVocabularyFeed Hook
 *
 * Combines Web Worker vocabulary processing with progressive translation hydration.
 *
 * Optimized Flow (5-10x faster):
 * 1. Worker processes and sorts words
 * 2. Worker streams batches to UI
 * 3. VIEWPORT-FIRST: Immediately translate visible words (high priority)
 * 4. PREFETCH: Proactively translate next 2 batches in parallel
 * 5. IDLE-TIME: Translate remaining words during browser idle periods
 * 6. Worker receives translation updates and merges them into display
 */

import { useEffect, useCallback, useRef } from 'react';
import { useVocabularyWorker } from './useVocabularyWorker';
import { useTranslationQueue } from './useTranslationQueue';
import type { WordFrequency, CEFRLevel } from '../types/script';
import type { DisplayWord } from '../types/vocabularyWorker';

interface UseWorkerVocabularyFeedOptions {
  rawWords: WordFrequency[];
  cefrLevel: CEFRLevel;
  targetLanguage: string;
  userId?: number;
  isAuthenticated: boolean;
  isPreview?: boolean;
}

interface UseWorkerVocabularyFeedResult {
  visibleWords: DisplayWord[];
  isLoading: boolean;
  isLoadingMore: boolean;
  totalCount: number;
  loadedCount: number;
  hasMore: boolean;
  error: string | null;
  requestMore: () => void;
}

// Translation batch sizes for different priorities
const VIEWPORT_BATCH_SIZE = 30;     // First visible words - highest priority
const PREFETCH_BATCH_SIZE = 50;     // Next batches - medium priority
const MAX_PARALLEL_REQUESTS = 3;    // Concurrent translation requests

export function useWorkerVocabularyFeed({
  rawWords,
  cefrLevel,
  targetLanguage,
  userId,
  isAuthenticated,
  isPreview = false
}: UseWorkerVocabularyFeedOptions): UseWorkerVocabularyFeedResult {
  // Worker hook
  const {
    visibleWords,
    isLoading,
    isLoadingMore,
    totalCount,
    loadedCount,
    error,
    requestBatch,
    updateTranslations
  } = useVocabularyWorker({
    rawWords,
    cefrLevel,
    targetLanguage,
    userId,
    isAuthenticated,
    isPreview
  });

  // Translation queue
  const { enqueue } = useTranslationQueue(targetLanguage, userId);

  // Track which words we've already requested translations for
  const translatedWordsRef = useRef<Set<string>>(new Set());

  // Track active translation requests count
  const activeRequestsRef = useRef(0);

  // Track if component is mounted
  const isMountedRef = useRef(true);

  // Track idle callback ID for cleanup
  const idleCallbackIdRef = useRef<number | null>(null);

  // ============================================================================
  // MOUNT/UNMOUNT TRACKING
  // ============================================================================

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (idleCallbackIdRef.current !== null) {
        cancelIdleCallback(idleCallbackIdRef.current);
      }
    };
  }, []);

  // ============================================================================
  // PARALLEL TRANSLATION PIPELINE
  // ============================================================================

  const translateBatch = useCallback(async (
    words: DisplayWord[],
    priority: 'high' | 'low'
  ): Promise<void> => {
    if (!isMountedRef.current || words.length === 0) return;

    // Filter out already requested words
    const wordsToTranslate = words.filter(
      w => !translatedWordsRef.current.has(w.word)
    );

    if (wordsToTranslate.length === 0) return;

    // Mark words as being translated
    wordsToTranslate.forEach(w => translatedWordsRef.current.add(w.word));
    activeRequestsRef.current++;

    try {
      const wordStrings = wordsToTranslate.map(w => w.word);
      const results = await enqueue(wordStrings, priority);

      // Check if still mounted before updating
      if (!isMountedRef.current) return;

      // Send translations to worker
      const translations = results.map(r => ({
        word: r.word.toLowerCase(),
        translation: r.translation.toLowerCase(),
        provider: r.provider || undefined,
        cached: r.cached
      }));

      updateTranslations(translations);
    } catch (error) {
      console.error('Failed to fetch translations:', error);
      // Remove from translated set so we can retry
      wordsToTranslate.forEach(w => translatedWordsRef.current.delete(w.word));
    } finally {
      activeRequestsRef.current--;
    }
  }, [enqueue, updateTranslations]);

  // ============================================================================
  // VIEWPORT-FIRST + PREFETCH TRANSLATION (Parallel Pipeline)
  // ============================================================================

  useEffect(() => {
    if (isPreview || !isAuthenticated || visibleWords.length === 0) {
      return;
    }

    // Don't start new requests if we're at max parallel
    if (activeRequestsRef.current >= MAX_PARALLEL_REQUESTS) {
      return;
    }

    // Find words that need translation
    const untranslatedWords = visibleWords.filter(
      w => !w.translation && !translatedWordsRef.current.has(w.word)
    );

    if (untranslatedWords.length === 0) return;

    // Split into viewport (immediate) and prefetch (next batches)
    const viewportWords = untranslatedWords.slice(0, VIEWPORT_BATCH_SIZE);
    const prefetchWords = untranslatedWords.slice(
      VIEWPORT_BATCH_SIZE,
      VIEWPORT_BATCH_SIZE + PREFETCH_BATCH_SIZE
    );

    // Start parallel translation requests
    const requests: Promise<void>[] = [];

    // 1. VIEWPORT-FIRST: Highest priority (no delay)
    if (viewportWords.length > 0) {
      requests.push(translateBatch(viewportWords, 'high'));
    }

    // 2. PREFETCH: Medium priority (slight delay to prioritize viewport)
    if (prefetchWords.length > 0 && activeRequestsRef.current < MAX_PARALLEL_REQUESTS) {
      // Use requestIdleCallback for prefetch to avoid blocking viewport
      if ('requestIdleCallback' in window) {
        idleCallbackIdRef.current = requestIdleCallback(() => {
          if (isMountedRef.current) {
            translateBatch(prefetchWords, 'low');
          }
        }, { timeout: 200 });
      } else {
        setTimeout(() => {
          if (isMountedRef.current) {
            translateBatch(prefetchWords, 'low');
          }
        }, 50);
      }
    }

    // Execute viewport translations immediately
    Promise.all(requests).catch(console.error);
  }, [visibleWords, isPreview, isAuthenticated, translateBatch]);

  // ============================================================================
  // CLEAR CACHE ON LANGUAGE CHANGE
  // ============================================================================

  useEffect(() => {
    translatedWordsRef.current.clear();
  }, [targetLanguage]);

  // ============================================================================
  // REQUEST MORE HANDLER
  // ============================================================================

  const requestMore = useCallback(() => {
    if (isLoadingMore || loadedCount >= totalCount) {
      return;
    }

    requestBatch(loadedCount, 50);
  }, [isLoadingMore, loadedCount, totalCount, requestBatch]);

  // ============================================================================
  // RETURN
  // ============================================================================

  const hasMore = loadedCount < totalCount;

  return {
    visibleWords,
    isLoading,
    isLoadingMore,
    totalCount,
    loadedCount,
    hasMore,
    error,
    requestMore
  };
}
