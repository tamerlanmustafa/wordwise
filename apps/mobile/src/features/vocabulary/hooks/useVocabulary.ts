import { useState, useEffect, useCallback, useRef } from 'react';
import type { Word } from '../../../types';
import { api } from '../../../services/api/client';

interface UseVocabularyOptions {
  contentId: number;
  contentType: 'movie' | 'book';
  level?: string;
  limit?: number;
}

interface UseVocabularyResult {
  words: Word[];
  isLoading: boolean;
  error: string | null;
  fetchMore: () => void;
  hasMore: boolean;
  total: number;
}

export function useVocabulary(options: UseVocabularyOptions): UseVocabularyResult {
  const { contentId, contentType, level, limit = 50 } = options;

  const [words, setWords] = useState<Word[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const isFetchingMore = useRef(false);

  // Initial fetch
  useEffect(() => {
    const fetchVocabulary = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response =
          contentType === 'movie'
            ? await api.client.getMovieVocabulary(contentId, { level, page: 1, limit })
            : await api.client.getBookVocabulary(contentId, { level, page: 1, limit });

        setWords(response.words);
        setHasMore(response.has_more);
        setTotal(response.total);
        setPage(1);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load vocabulary');
      } finally {
        setIsLoading(false);
      }
    };

    fetchVocabulary();
  }, [contentId, contentType, level, limit]);

  const fetchMore = useCallback(async () => {
    if (!hasMore || isLoading || isFetchingMore.current) return;

    isFetchingMore.current = true;
    const nextPage = page + 1;

    try {
      const response =
        contentType === 'movie'
          ? await api.client.getMovieVocabulary(contentId, { level, page: nextPage, limit })
          : await api.client.getBookVocabulary(contentId, { level, page: nextPage, limit });

      setWords((prev) => [...prev, ...response.words]);
      setHasMore(response.has_more);
      setPage(nextPage);
    } catch (err) {
      console.error('Failed to fetch more vocabulary:', err);
    } finally {
      isFetchingMore.current = false;
    }
  }, [hasMore, isLoading, page, contentId, contentType, level, limit]);

  return { words, isLoading, error, fetchMore, hasMore, total };
}
