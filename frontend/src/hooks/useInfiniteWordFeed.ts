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
const MIN_VALID_WORDS_THRESHOLD = 8; // If batch yields < 8 words, fetch next batch
const LRU_CACHE_SIZE = 1500;

// Simple LRU Cache implementation
class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;
  private accessOrder: K[];

  constructor(maxSize: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.accessOrder = [];
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.accessOrder = this.accessOrder.filter(k => k !== key);
      this.accessOrder.push(key);
    }
    return value;
  }

  set(key: K, value: V): void {
    // If key exists, remove it first
    if (this.cache.has(key)) {
      this.accessOrder = this.accessOrder.filter(k => k !== key);
    }

    // Add to cache and access order
    this.cache.set(key, value);
    this.accessOrder.push(key);

    // Evict oldest if over size
    if (this.cache.size > this.maxSize) {
      const oldest = this.accessOrder.shift();
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
  }

  has(key: K): boolean {
    return this.cache.get(key) !== undefined;
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  toMap(): Map<K, V> {
    return new Map(this.cache);
  }
}

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

  // LRU cache for translations
  const translationCacheRef = useRef(new LRUCache<string, TranslatedWord>(LRU_CACHE_SIZE));

  const { enqueue, getQueueSize, getPendingCount, reset: resetQueue } = useTranslationQueue(targetLanguage, userId);

  // Track which batches we've already prefetched to prevent duplicates
  const prefetchedBatchesRef = useRef<Set<number>>(new Set());

  // IntersectionObserver ref
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelNodeRef = useRef<HTMLDivElement | null>(null);

  // Double-trigger guard
  const isLoadingRef = useRef(false);

  const hasMore = loadedCount < rawWords.length;

  // Reset state when rawWords, targetLanguage, or auth status changes
  useEffect(() => {
    setVisibleWords([]);
    setTranslations(new Map());
    setLoadedCount(0);
    setIsLoadingMore(false);
    setError(null);
    prefetchedBatchesRef.current = new Set();
    translationCacheRef.current.clear();
    resetQueue();
    isLoadingRef.current = false;
  }, [rawWords, targetLanguage, isAuthenticated, resetQueue]);

  // Load next batch of words
  const loadNextBatch = useCallback(async (autoFetch = false) => {
    // Double-trigger guard
    if (isLoadingRef.current) return;
    if (isLoadingMore || !hasMore || isPreview || !isAuthenticated) return;

    isLoadingRef.current = true;
    setIsLoadingMore(true);
    setError(null);

    try {
      const start = loadedCount;
      const end = Math.min(start + batchSize, rawWords.length);
      const newBatch = rawWords.slice(start, end);

      if (newBatch.length === 0) {
        setIsLoadingMore(false);
        isLoadingRef.current = false;
        return;
      }

      // Extract words that need translation
      const wordsToTranslate = newBatch
        .map(w => w.word.toLowerCase())
        .filter(w => {
          if (!w || !w.trim()) return false;
          const cacheKey = `${w}-${targetLanguage}`;
          return !translationCacheRef.current.has(cacheKey);
        });

      // Translate the batch (queue handles rate limiting and deduplication)
      let updatedTranslations = new Map(translations);
      if (wordsToTranslate.length > 0) {
        const results = await enqueue(wordsToTranslate, 'high');

        // Build updated translations map and LRU cache
        results.forEach(result => {
          const wordLower = result.word.toLowerCase();
          const translationLower = result.translation.toLowerCase();

          const translatedWord: TranslatedWord = {
            word: wordLower,
            lemma: wordLower,
            translation: translationLower,
            confidence: undefined,
            cached: result.cached,
            provider: result.provider || null
          };

          // Store in LRU cache
          const cacheKey = `${wordLower}-${targetLanguage}`;
          translationCacheRef.current.set(cacheKey, translatedWord);

          // Store in state map
          updatedTranslations.set(wordLower, translatedWord);
        });

        // Update state with new translations
        setTranslations(updatedTranslations);
      } else {
        // Use cached translations
        newBatch.forEach(wordFreq => {
          const wordLower = wordFreq.word.toLowerCase();
          const cacheKey = `${wordLower}-${targetLanguage}`;
          const cached = translationCacheRef.current.get(cacheKey);
          if (cached) {
            updatedTranslations.set(wordLower, cached);
          }
        });
        setTranslations(updatedTranslations);
      }

      // Filter out words where translation === source BEFORE adding to visibleWords
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

      // Batch starvation prevention: if filtered batch < threshold, auto-fetch next
      if (filteredBatch.length < MIN_VALID_WORDS_THRESHOLD && end < rawWords.length && !autoFetch) {
        // Recursively fetch next batch
        isLoadingRef.current = false;
        setIsLoadingMore(false);
        setTimeout(() => loadNextBatch(true), 100);
        return;
      }

      // Smart prefetch throttling: only prefetch if queue is small
      const queueSize = getQueueSize();
      const pendingCount = getPendingCount();

      const shouldPrefetch = queueSize <= 5 && pendingCount <= 10;

      if (shouldPrefetch) {
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
              .filter(w => {
                if (!w || !w.trim()) return false;
                const cacheKey = `${w}-${targetLanguage}`;
                return !translationCacheRef.current.has(cacheKey);
              });

            if (prefetchWords.length > 0) {
              // Fire and forget - low priority
              enqueue(prefetchWords, 'low').then(results => {
                setTranslations(prev => {
                  const newMap = new Map(prev);
                  results.forEach(result => {
                    const wordLower = result.word.toLowerCase();
                    const translationLower = result.translation.toLowerCase();

                    const translatedWord: TranslatedWord = {
                      word: wordLower,
                      lemma: wordLower,
                      translation: translationLower,
                      confidence: undefined,
                      cached: result.cached,
                      provider: result.provider || null
                    };

                    // Store in LRU cache
                    const cacheKey = `${wordLower}-${targetLanguage}`;
                    translationCacheRef.current.set(cacheKey, translatedWord);

                    newMap.set(wordLower, translatedWord);
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
      }
    } catch (err: any) {
      console.error('Failed to load batch:', err);
      setError(err.message || 'Failed to load words. Please try again.');
    } finally {
      setIsLoadingMore(false);
      isLoadingRef.current = false;
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
    targetLanguage,
    enqueue,
    getQueueSize,
    getPendingCount
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

    // Don't observe if no more items
    if (!hasMore) {
      return;
    }

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

  // Auto-disconnect observer when hasMore becomes false
  useEffect(() => {
    if (!hasMore && observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
  }, [hasMore]);

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
