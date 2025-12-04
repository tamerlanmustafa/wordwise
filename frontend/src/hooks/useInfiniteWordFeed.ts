import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslationQueue } from './useTranslationQueue';
import type { WordFrequency } from '../types/script';

export interface TranslatedWord {
  word: string;
  lemma: string;
  translation: string;
  confidence?: number;
  cached: boolean;
  provider?: string | null;
}

interface UseInfiniteWordFeedOptions {
  rawWords: WordFrequency[];
  targetLanguage: string;
  userId?: number;
  isAuthenticated: boolean;
  isPreview?: boolean;
  batchSize?: number;
}

interface UseInfiniteWordFeedResult {
  visibleWords: WordFrequency[];
  translations: Map<string, TranslatedWord>;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  sentinelRef: (node: HTMLDivElement | null) => void;
}

const DEFAULT_BATCH_SIZE = 20;

export function useInfiniteWordFeed({
  rawWords,
  targetLanguage,
  userId,
  isAuthenticated,
  isPreview = false,
  batchSize = DEFAULT_BATCH_SIZE
}: UseInfiniteWordFeedOptions): UseInfiniteWordFeedResult {
  const [visibleWords, setVisibleWords] = useState<WordFrequency[]>([]);
  const [translations, setTranslations] = useState<Map<string, TranslatedWord>>(new Map());
  const [loadedCount, setLoadedCount] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { enqueue } = useTranslationQueue(targetLanguage, userId);

  // Track which batches we've already prefetched to prevent duplicates
  const prefetchedBatchesRef = useRef<Set<number>>(new Set());

  // IntersectionObserver ref
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelNodeRef = useRef<HTMLDivElement | null>(null);

  const hasMore = loadedCount < rawWords.length;

  // Reset state when rawWords, targetLanguage, or auth status changes
  useEffect(() => {
    setVisibleWords([]);
    setTranslations(new Map());
    setLoadedCount(0);
    setIsLoadingMore(false);
    setError(null);
    prefetchedBatchesRef.current = new Set();
  }, [rawWords, targetLanguage, isAuthenticated]);

  // Load next batch of words
  const loadNextBatch = useCallback(async () => {
    if (isLoadingMore || !hasMore || isPreview || !isAuthenticated) return;

    setIsLoadingMore(true);
    setError(null);

    try {
      const start = loadedCount;
      const end = Math.min(start + batchSize, rawWords.length);
      const newBatch = rawWords.slice(start, end);

      if (newBatch.length === 0) {
        setIsLoadingMore(false);
        return;
      }

      // Extract words that need translation
      const wordsToTranslate = newBatch
        .map(w => w.word.toLowerCase())
        .filter(w => w && w.trim() && !translations.has(w));

      // Translate the batch (queue handles rate limiting)
      let updatedTranslations = new Map(translations);
      if (wordsToTranslate.length > 0) {
        const results = await enqueue(wordsToTranslate);

        // Build updated translations map
        results.forEach(result => {
          const wordLower = result.word.toLowerCase();
          const translationLower = result.translation.toLowerCase();

          // Store all translations (including source === translation)
          updatedTranslations.set(wordLower, {
            word: wordLower,
            lemma: wordLower,
            translation: translationLower,
            confidence: undefined,
            cached: result.cached,
            provider: result.provider || null
          });
        });

        // Update state with new translations
        setTranslations(updatedTranslations);
      }

      // Filter out words where translation === source BEFORE adding to visibleWords
      // Use updatedTranslations (not old translations state)
      const filteredBatch = newBatch.filter(wordFreq => {
        const wordLower = wordFreq.word.toLowerCase();
        const translation = updatedTranslations.get(wordLower);

        // Skip words where translation === source (no actual translation)
        if (translation && translation.translation === wordLower) {
          return false;
        }

        return true;
      });

      // Add filtered batch to visible words
      setVisibleWords(prev => [...prev, ...filteredBatch]);
      setLoadedCount(end);

      // Prefetch next batch in background (fire-and-forget)
      const nextBatchIndex = Math.floor(end / batchSize);
      if (!prefetchedBatchesRef.current.has(nextBatchIndex)) {
        prefetchedBatchesRef.current.add(nextBatchIndex);

        const prefetchStart = end;
        const prefetchEnd = Math.min(prefetchStart + batchSize, rawWords.length);
        const prefetchBatch = rawWords.slice(prefetchStart, prefetchEnd);

        if (prefetchBatch.length > 0) {
          const prefetchWords = prefetchBatch
            .map(w => w.word.toLowerCase())
            .filter(w => w && w.trim() && !translations.has(w));

          if (prefetchWords.length > 0) {
            // Fire and forget - don't await
            enqueue(prefetchWords).then(results => {
              setTranslations(prev => {
                const newMap = new Map(prev);
                results.forEach(result => {
                  const wordLower = result.word.toLowerCase();
                  const translationLower = result.translation.toLowerCase();

                  newMap.set(wordLower, {
                    word: wordLower,
                    lemma: wordLower,
                    translation: translationLower,
                    confidence: undefined,
                    cached: result.cached,
                    provider: result.provider || null
                  });
                });
                return newMap;
              });
            }).catch(err => {
              console.error('Prefetch failed:', err);
              // Don't show error to user for background prefetch failures
            });
          }
        }
      }
    } catch (err: any) {
      console.error('Failed to load batch:', err);
      setError(err.message || 'Failed to load words. Please try again.');
    } finally {
      setIsLoadingMore(false);
    }
  }, [
    isLoadingMore,
    hasMore,
    isPreview,
    isAuthenticated,
    loadedCount,
    batchSize,
    rawWords,
    translations,
    enqueue
  ]);

  // Load initial batch on mount
  useEffect(() => {
    if (loadedCount === 0 && rawWords.length > 0 && isAuthenticated && !isPreview) {
      loadNextBatch();
    }
  }, [loadedCount, rawWords.length, isAuthenticated, isPreview, loadNextBatch]);

  // Set up IntersectionObserver for sentinel
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    // Clean up previous observer
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    sentinelNodeRef.current = node;

    if (!node) return;

    // Create new observer
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting && hasMore && !isLoadingMore && !isPreview && isAuthenticated) {
          loadNextBatch();
        }
      },
      {
        root: null,
        rootMargin: '200px', // Trigger 200px before reaching the sentinel
        threshold: 0.1
      }
    );

    observerRef.current.observe(node);
  }, [hasMore, isLoadingMore, isPreview, isAuthenticated, loadNextBatch]);

  // Cleanup observer on unmount
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);

  return {
    visibleWords,
    translations,
    isLoadingMore,
    hasMore,
    error,
    sentinelRef
  };
}
