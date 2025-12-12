/**
 * useWorkerVocabularyFeed Hook
 *
 * Combines Web Worker vocabulary processing with on-demand translation.
 *
 * Flow:
 * 1. Worker processes and sorts words
 * 2. Worker streams batches to UI
 * 3. UI displays words without translations (click-to-expand pattern)
 * 4. Translations fetched on-demand when user clicks a word row
 *
 * Note: Batch translation has been removed in favor of click-to-expand.
 * This eliminates rate limiting issues with translation APIs.
 */

import { useCallback } from 'react';
import { useVocabularyWorker } from './useVocabularyWorker';
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
    requestBatch
  } = useVocabularyWorker({
    rawWords,
    cefrLevel,
    targetLanguage,
    userId,
    isAuthenticated,
    isPreview
  });

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
