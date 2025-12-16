/**
 * useVocabularyWorker Hook
 *
 * Manages the lifecycle and communication with the vocabulary Web Worker.
 * Provides a clean React interface for worker-based vocabulary processing.
 *
 * Features:
 * - Initializes and manages worker lifecycle
 * - Sends word data to worker with CEFR filtering
 * - Requests batches for virtualized rendering
 * - Merges streaming translation updates
 * - Batches state updates using requestAnimationFrame
 * - Maintains stable references for optimal rendering performance
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { WordFrequency, CEFRLevel } from '../types/script';
import type {
  WorkerInboundMessage,
  WorkerOutboundMessage,
  DisplayWord
} from '../types/vocabularyWorker';
import type { IdiomInfo } from '../services/scriptService';

// Stable empty array reference to prevent infinite re-renders
const EMPTY_IDIOMS: IdiomInfo[] = [];

interface UseVocabularyWorkerOptions {
  rawWords: WordFrequency[];
  cefrLevel: CEFRLevel;
  targetLanguage: string;
  userId?: number;
  isAuthenticated: boolean;
  isPreview?: boolean;
  idioms?: IdiomInfo[];
}

interface UseVocabularyWorkerResult {
  // Visible words (display-ready)
  visibleWords: DisplayWord[];

  // Loading states
  isLoading: boolean;
  isLoadingMore: boolean;
  totalCount: number;
  loadedCount: number;

  // Error state
  error: string | null;

  // Actions
  requestBatch: (startIndex: number, count: number) => void;
  updateTranslations: (translations: Array<{ word: string; translation: string; provider?: string; cached?: boolean }>) => void;
  applyFilter: (options: {
    searchQuery?: string;
    sortBy?: 'frequency' | 'alphabetical' | 'confidence';
    showOnlySaved?: boolean;
    savedWords?: Set<string>;
  }) => void;
  reset: () => void;
  getIdiomsForWord: (word: string) => Promise<IdiomInfo[]>;
}

const BATCH_SIZE = 50;

export function useVocabularyWorker({
  rawWords,
  cefrLevel,
  targetLanguage: _targetLanguage,  // Reserved for future translation integration
  userId: _userId,                   // Reserved for future personalization
  isAuthenticated,
  isPreview = false,
  idioms
}: UseVocabularyWorkerOptions): UseVocabularyWorkerResult {
  // Use stable empty array if idioms is undefined/empty to prevent infinite re-renders
  const stableIdioms = idioms && idioms.length > 0 ? idioms : EMPTY_IDIOMS;
  // Worker instance
  const workerRef = useRef<Worker | null>(null);

  // Mounted guard to prevent state updates after unmount
  const isMountedRef = useRef(true);

  // State
  const [visibleWords, setVisibleWords] = useState<DisplayWord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [loadedCount, setLoadedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Pending state updates (batched via RAF)
  const pendingUpdatesRef = useRef<{
    visibleWords?: DisplayWord[];
    isLoading?: boolean;
    isLoadingMore?: boolean;
    totalCount?: number;
    loadedCount?: number;
    error?: string | null;
  }>({});
  const rafIdRef = useRef<number | null>(null);

  // Pending idiom lookup promises (for async getIdiomsForWord)
  const pendingIdiomLookupsRef = useRef<Map<string, {
    resolve: (idioms: IdiomInfo[]) => void;
    reject: (error: Error) => void;
  }>>(new Map());

  // ============================================================================
  // BATCHED STATE UPDATES
  // ============================================================================

  const scheduleUpdate = useCallback((updates: typeof pendingUpdatesRef.current) => {
    // Guard: Don't schedule updates if unmounted
    if (!isMountedRef.current) return;

    // Merge updates
    Object.assign(pendingUpdatesRef.current, updates);

    // Cancel existing RAF
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }

    // Schedule new RAF
    rafIdRef.current = requestAnimationFrame(() => {
      // Guard: Check mounted before applying updates
      if (!isMountedRef.current) {
        pendingUpdatesRef.current = {};
        rafIdRef.current = null;
        return;
      }

      const pending = pendingUpdatesRef.current;

      // Apply all pending updates at once
      if (pending.visibleWords !== undefined) setVisibleWords(pending.visibleWords);
      if (pending.isLoading !== undefined) setIsLoading(pending.isLoading);
      if (pending.isLoadingMore !== undefined) setIsLoadingMore(pending.isLoadingMore);
      if (pending.totalCount !== undefined) setTotalCount(pending.totalCount);
      if (pending.loadedCount !== undefined) setLoadedCount(pending.loadedCount);
      if (pending.error !== undefined) setError(pending.error);

      // Clear pending updates
      pendingUpdatesRef.current = {};
      rafIdRef.current = null;
    });
  }, []);

  // ============================================================================
  // WORKER MESSAGE HANDLER
  // ============================================================================

  const handleWorkerMessage = useCallback((event: MessageEvent<WorkerOutboundMessage>) => {
    const message = event.data;

    switch (message.type) {
      case 'BATCH_READY': {
        const { batch, startIndex, endIndex, totalCount } = message.payload;

        // Merge batch into existing words array
        // Worker returns batches that may overlap or extend the current array
        setVisibleWords(prevWords => {
          // If this is the first batch or a reset (startIndex = 0), replace entirely
          if (startIndex === 0) {
            return batch;
          }

          // Otherwise, append new words to existing array
          // Create a new array that includes all words up to endIndex
          const newWords = [...prevWords];

          // Insert/update words at their correct positions
          batch.forEach((word, i) => {
            const targetIndex = startIndex + i;
            newWords[targetIndex] = word;
          });

          return newWords;
        });

        scheduleUpdate({
          loadedCount: endIndex,
          totalCount,
          isLoadingMore: false,
          isLoading: false
        });
        break;
      }

      case 'ALL_LOADED': {
        const { totalCount } = message.payload;

        scheduleUpdate({
          totalCount,
          isLoading: false
        });
        break;
      }

      case 'ERROR': {
        const { message: errorMessage } = message.payload;
        console.error('[VocabularyWorker]', errorMessage);

        scheduleUpdate({
          error: errorMessage,
          isLoading: false,
          isLoadingMore: false
        });
        break;
      }

      case 'IDIOMS_RESULT': {
        const { requestId, idioms } = message.payload;
        const pending = pendingIdiomLookupsRef.current.get(requestId);
        if (pending) {
          pending.resolve(idioms);
          pendingIdiomLookupsRef.current.delete(requestId);
        }
        break;
      }
    }
  }, [scheduleUpdate]);

  // ============================================================================
  // WORKER INITIALIZATION
  // ============================================================================

  useEffect(() => {
    // Mark as mounted
    isMountedRef.current = true;

    // Create worker
    const worker = new Worker(
      new URL('../workers/vocabulary.worker.ts', import.meta.url),
      { type: 'module' }
    );

    worker.addEventListener('message', handleWorkerMessage);

    workerRef.current = worker;

    // Cleanup
    return () => {
      // Mark as unmounted FIRST to prevent any new state updates
      isMountedRef.current = false;

      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      worker.terminate();
      workerRef.current = null;
    };
  }, [handleWorkerMessage]);

  // ============================================================================
  // INIT WORDS
  // ============================================================================

  useEffect(() => {
    if (!workerRef.current || !isAuthenticated || isPreview) {
      return;
    }

    // Reset state
    setVisibleWords([]);
    setTotalCount(0);
    setLoadedCount(0);
    setError(null);
    setIsLoading(true);

    // Send words to worker (include idioms for context-aware translation)
    const message: WorkerInboundMessage = {
      type: 'INIT_WORDS',
      payload: {
        words: rawWords,
        cefrLevel,
        idioms: stableIdioms
      }
    };

    workerRef.current.postMessage(message);
  }, [rawWords, cefrLevel, isAuthenticated, isPreview, stableIdioms]);

  // ============================================================================
  // REQUEST INITIAL BATCH
  // ============================================================================

  useEffect(() => {
    if (!workerRef.current || !isAuthenticated || isPreview) {
      return;
    }

    if (totalCount > 0 && loadedCount === 0) {
      // Request first batch IMMEDIATELY (no delay) for instant tab switching
      const message: WorkerInboundMessage = {
        type: 'REQUEST_BATCH',
        payload: {
          startIndex: 0,
          count: BATCH_SIZE
        }
      };

      workerRef.current.postMessage(message);
      setIsLoadingMore(true);
    }
  }, [totalCount, loadedCount, isAuthenticated, isPreview]);

  // ============================================================================
  // ACTIONS
  // ============================================================================

  const requestBatch = useCallback((startIndex: number, count: number) => {
    if (!workerRef.current || isLoadingMore) {
      return;
    }

    const message: WorkerInboundMessage = {
      type: 'REQUEST_BATCH',
      payload: {
        startIndex,
        count
      }
    };

    workerRef.current.postMessage(message);
    setIsLoadingMore(true);
  }, [isLoadingMore]);

  const updateTranslations = useCallback((translations: Array<{
    word: string;
    translation: string;
    provider?: string;
    cached?: boolean;
  }>) => {
    if (!workerRef.current) {
      return;
    }

    const message: WorkerInboundMessage = {
      type: 'TRANSLATION_UPDATE',
      payload: {
        translations
      }
    };

    workerRef.current.postMessage(message);
  }, []);

  const applyFilter = useCallback((options: {
    searchQuery?: string;
    sortBy?: 'frequency' | 'alphabetical' | 'confidence';
    showOnlySaved?: boolean;
    savedWords?: Set<string>;
  }) => {
    if (!workerRef.current) {
      return;
    }

    const message: WorkerInboundMessage = {
      type: 'APPLY_FILTER',
      payload: options
    };

    workerRef.current.postMessage(message);
    setIsLoading(true);
  }, []);

  const reset = useCallback(() => {
    if (!workerRef.current) {
      return;
    }

    const message: WorkerInboundMessage = {
      type: 'RESET'
    };

    workerRef.current.postMessage(message);

    setVisibleWords([]);
    setTotalCount(0);
    setLoadedCount(0);
    setError(null);
    setIsLoading(true);
  }, []);

  const getIdiomsForWord = useCallback((word: string): Promise<IdiomInfo[]> => {
    return new Promise((resolve, reject) => {
      if (!workerRef.current) {
        resolve([]);
        return;
      }

      // Generate unique request ID
      const requestId = `${word}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Store the promise handlers
      pendingIdiomLookupsRef.current.set(requestId, { resolve, reject });

      // Send message to worker
      const message: WorkerInboundMessage = {
        type: 'GET_IDIOMS_FOR_WORD',
        payload: {
          word,
          requestId
        }
      };

      workerRef.current.postMessage(message);

      // Timeout after 5 seconds
      setTimeout(() => {
        const pending = pendingIdiomLookupsRef.current.get(requestId);
        if (pending) {
          pending.resolve([]); // Return empty on timeout
          pendingIdiomLookupsRef.current.delete(requestId);
        }
      }, 5000);
    });
  }, []);

  // ============================================================================
  // RETURN STABLE REFERENCES
  // ============================================================================

  return useMemo(() => ({
    visibleWords,
    isLoading,
    isLoadingMore,
    totalCount,
    loadedCount,
    error,
    requestBatch,
    updateTranslations,
    applyFilter,
    reset,
    getIdiomsForWord
  }), [
    visibleWords,
    isLoading,
    isLoadingMore,
    totalCount,
    loadedCount,
    error,
    requestBatch,
    updateTranslations,
    applyFilter,
    reset,
    getIdiomsForWord
  ]);
}
