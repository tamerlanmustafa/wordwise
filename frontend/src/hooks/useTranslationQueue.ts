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
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [300, 500, 1000]; // Exponential backoff: 300ms -> 500ms -> 1s

export function useTranslationQueue(targetLanguage: string, userId?: number) {
  const queueRef = useRef<QueueItem[]>([]);
  const processingRef = useRef(false);

  const processQueue = useCallback(async () => {
    if (processingRef.current || queueRef.current.length === 0) return;

    processingRef.current = true;
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
      }
    } finally {
      processingRef.current = false;
      // Process next item in queue
      if (queueRef.current.length > 0) {
        processQueue();
      }
    }
  }, [targetLanguage, userId]);

  const enqueue = useCallback((words: string[]): Promise<TranslationResult[]> => {
    return new Promise((resolve, reject) => {
      queueRef.current.push({ words, resolve, reject });
      processQueue();
    });
  }, [processQueue]);

  return { enqueue };
}
