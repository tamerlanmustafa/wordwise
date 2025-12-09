/**
 * useWorkerVocabularyFeed Hook
 *
 * Combines Web Worker vocabulary processing with progressive translation hydration.
 *
 * This hook bridges the gap between:
 * - useVocabularyWorker (manages worker communication)
 * - useTranslationQueue (handles translation API calls)
 *
 * Flow:
 * 1. Worker processes and sorts words
 * 2. Worker streams batches to UI
 * 3. UI requests translations for visible words
 * 4. Translations hydrate rows progressively using requestIdleCallback
 * 5. Worker receives translation updates and merges them into future batches
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
  // Display words
  visibleWords: DisplayWord[];

  // Loading states
  isLoading: boolean;
  isLoadingMore: boolean;
  totalCount: number;
  loadedCount: number;
  hasMore: boolean;

  // Error
  error: string | null;

  // Actions
  requestMore: () => void;
}

const TRANSLATION_BATCH_SIZE = 20;

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

  // Track pending translation request
  const translationPendingRef = useRef(false);

  // ============================================================================
  // PROGRESSIVE TRANSLATION HYDRATION
  // ============================================================================

  useEffect(() => {
    if (isPreview || !isAuthenticated || visibleWords.length === 0) {
      return;
    }

    // Find words that need translation
    const wordsNeedingTranslation = visibleWords
      .filter(w => !w.translation && !translatedWordsRef.current.has(w.word))
      .slice(0, TRANSLATION_BATCH_SIZE);

    if (wordsNeedingTranslation.length === 0 || translationPendingRef.current) {
      return;
    }

    // Mark words as being translated
    wordsNeedingTranslation.forEach(w => translatedWordsRef.current.add(w.word));
    translationPendingRef.current = true;

    // Request translations using requestIdleCallback
    const requestTranslations = async () => {
      try {
        const words = wordsNeedingTranslation.map(w => w.word);
        const results = await enqueue(words, 'high');

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
        wordsNeedingTranslation.forEach(w => translatedWordsRef.current.delete(w.word));
      } finally {
        translationPendingRef.current = false;
      }
    };

    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(() => requestTranslations(), { timeout: 100 });
      return () => cancelIdleCallback(id);
    } else {
      const timer = setTimeout(() => requestTranslations(), 0);
      return () => clearTimeout(timer);
    }
  }, [visibleWords, isPreview, isAuthenticated, enqueue, updateTranslations]);

  // Clear translated words cache when language changes
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
