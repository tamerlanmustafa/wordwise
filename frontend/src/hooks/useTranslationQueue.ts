import { useRef, useCallback } from 'react';
import { translateBatch } from '../services/scriptService';

interface TranslationResult {
  word: string;
  translation: string;
  cached: boolean;
  provider?: string | null;
}

interface QueueItem {
  words: string[];
  resolve: (results: TranslationResult[]) => void;
  reject: (error: Error) => void;
  retryCount?: number;
  priority: 'high' | 'low'; // high = viewport, low = prefetch
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [300, 500, 1000]; // Exponential backoff: 300ms -> 500ms -> 1s
const BATCH_WINDOW_MS = 30; // Group words entering viewport within 30ms

export function useTranslationQueue(targetLanguage: string, userId?: number) {
  const queueRef = useRef<QueueItem[]>([]);
  const processingRef = useRef(false);
  const pendingWordsRef = useRef<Set<string>>(new Set()); // Dedupe
  const translatedWordsRef = useRef<Set<string>>(new Set()); // Already translated
  const batchTimerRef = useRef<number | null>(null);
  const pendingBatchRef = useRef<{
    words: string[];
    priority: 'high' | 'low';
    resolvers: Array<(results: TranslationResult[]) => void>;
    rejecters: Array<(error: Error) => void>;
  } | null>(null);

  const processQueue = useCallback(async () => {
    if (processingRef.current || queueRef.current.length === 0) return;

    processingRef.current = true;

    // Sort queue: high priority first
    queueRef.current.sort((a, b) => {
      if (a.priority === 'high' && b.priority === 'low') return -1;
      if (a.priority === 'low' && b.priority === 'high') return 1;
      return 0;
    });

    const item = queueRef.current.shift()!;
    const retryCount = item.retryCount || 0;

    try {
      // Rate limiting: 200ms delay between requests
      await new Promise(resolve => setTimeout(resolve, 200));

      // Translate batch
      const response = await translateBatch(
        item.words,
        targetLanguage,
        'auto',
        userId
      );

      const results: TranslationResult[] = response.results.map(r => ({
        word: r.source.toLowerCase(),
        translation: r.translated.toLowerCase(),
        cached: r.cached,
        provider: r.provider
      }));

      // Mark words as translated and remove from pending
      results.forEach(r => {
        translatedWordsRef.current.add(r.word);
        pendingWordsRef.current.delete(r.word);
      });

      item.resolve(results);
    } catch (error: any) {
      // Check if it's a 429 rate limit error
      const is429Error = error?.message?.includes('429') ||
                         error?.response?.status === 429 ||
                         error?.toString().includes('rate limit');

      // Retry on 429 with exponential backoff
      if (is429Error && retryCount < MAX_RETRIES) {
        const retryDelay = RETRY_DELAYS[retryCount];
        console.warn(`Rate limit hit, retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);

        // Wait for exponential backoff delay
        await new Promise(resolve => setTimeout(resolve, retryDelay));

        // Re-queue with incremented retry count
        queueRef.current.unshift({
          ...item,
          retryCount: retryCount + 1
        });
      } else {
        // Max retries reached or non-429 error
        if (is429Error && retryCount >= MAX_RETRIES) {
          console.error('Max retries reached for rate limit error');
          item.reject(new Error('Translation failed after multiple retries due to rate limiting'));
        } else {
          item.reject(error as Error);
        }

        // Remove failed words from pending
        item.words.forEach(w => pendingWordsRef.current.delete(w));
      }
    } finally {
      processingRef.current = false;
      // Process next item in queue
      if (queueRef.current.length > 0) {
        processQueue();
      }
    }
  }, [targetLanguage, userId]);

  const flushBatch = useCallback(() => {
    if (!pendingBatchRef.current || pendingBatchRef.current.words.length === 0) {
      pendingBatchRef.current = null;
      return;
    }

    const batch = pendingBatchRef.current;
    pendingBatchRef.current = null;

    // Create single queue item that resolves all promises
    const queueItem: QueueItem = {
      words: batch.words,
      priority: batch.priority,
      resolve: (results) => {
        // Resolve all waiting promises with the same results
        batch.resolvers.forEach(resolve => resolve(results));
      },
      reject: (error) => {
        batch.rejecters.forEach(reject => reject(error));
      }
    };

    queueRef.current.push(queueItem);
    processQueue();
  }, [processQueue]);

  const enqueue = useCallback((words: string[], priority: 'high' | 'low' = 'high'): Promise<TranslationResult[]> => {
    return new Promise((resolve, reject) => {
      // Filter out duplicates: already translated or already pending
      const uniqueWords = words.filter(w => {
        const wordLower = w.toLowerCase();
        return !translatedWordsRef.current.has(wordLower) &&
               !pendingWordsRef.current.has(wordLower);
      });

      if (uniqueWords.length === 0) {
        // All words already translated or pending - return empty
        resolve([]);
        return;
      }

      // Mark as pending
      uniqueWords.forEach(w => pendingWordsRef.current.add(w.toLowerCase()));

      // Batch words entering viewport within 30ms window
      if (!pendingBatchRef.current) {
        pendingBatchRef.current = {
          words: [...uniqueWords],
          priority,
          resolvers: [resolve],
          rejecters: [reject]
        };

        // Set timer to flush batch after 30ms
        batchTimerRef.current = setTimeout(flushBatch, BATCH_WINDOW_MS);
      } else {
        // Add to existing batch
        pendingBatchRef.current.words.push(...uniqueWords);
        pendingBatchRef.current.resolvers.push(resolve);
        pendingBatchRef.current.rejecters.push(reject);
        // Priority escalation: if any item is high priority, entire batch becomes high
        if (priority === 'high') {
          pendingBatchRef.current.priority = 'high';
        }
      }
    });
  }, [flushBatch]);

  const getQueueSize = useCallback(() => {
    return queueRef.current.length;
  }, []);

  const getPendingCount = useCallback(() => {
    return pendingWordsRef.current.size;
  }, []);

  const reset = useCallback(() => {
    queueRef.current = [];
    pendingWordsRef.current.clear();
    translatedWordsRef.current.clear();
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
      batchTimerRef.current = null;
    }
    pendingBatchRef.current = null;
  }, []);

  return {
    enqueue,
    getQueueSize,
    getPendingCount,
    reset
  };
}
