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

import { useCallback, useMemo } from 'react';
import { useVocabularyWorker } from './useVocabularyWorker';
import type { WordFrequency, CEFRLevel } from '../types/script';
import type { DisplayWord } from '../types/vocabularyWorker';
import type { IdiomInfo } from '../services/scriptService';

// Stable empty array reference to prevent infinite re-renders
const EMPTY_IDIOMS: IdiomInfo[] = [];

interface UseWorkerVocabularyFeedOptions {
  rawWords: WordFrequency[];
  cefrLevel: CEFRLevel;
  targetLanguage: string;
  userId?: number;
  isAuthenticated: boolean;
  isPreview?: boolean;
  idioms?: IdiomInfo[];
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
  getIdiomsForWord: (word: string) => Promise<IdiomInfo[]>;
}

export function useWorkerVocabularyFeed({
  rawWords,
  cefrLevel,
  targetLanguage,
  userId,
  isAuthenticated,
  isPreview = false,
  idioms
}: UseWorkerVocabularyFeedOptions): UseWorkerVocabularyFeedResult {
  // Use stable empty array if idioms is undefined/empty to prevent infinite re-renders
  const stableIdioms = useMemo(
    () => (idioms && idioms.length > 0 ? idioms : EMPTY_IDIOMS),
    [idioms]
  );

  // Worker hook
  const {
    visibleWords,
    isLoading,
    isLoadingMore,
    totalCount,
    loadedCount,
    error,
    requestBatch,
    getIdiomsForWord
  } = useVocabularyWorker({
    rawWords,
    cefrLevel,
    targetLanguage,
    userId,
    isAuthenticated,
    isPreview,
    idioms: stableIdioms
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
    requestMore,
    getIdiomsForWord
  };
}
