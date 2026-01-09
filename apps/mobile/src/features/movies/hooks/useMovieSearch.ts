import { useState, useEffect, useCallback, useRef } from 'react';
import type { MovieSearchResult } from '../../../types';
import { api } from '../../../services/api/client';

interface UseMovieSearchResult {
  data: MovieSearchResult[];
  isLoading: boolean;
  error: string | null;
  fetchMore: () => void;
  hasMore: boolean;
}

export function useMovieSearch(query: string, debounceMs = 300): UseMovieSearchResult {
  const [data, setData] = useState<MovieSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const debounceRef = useRef<NodeJS.Timeout>();
  const isFetchingMore = useRef(false);

  // Reset when query changes
  useEffect(() => {
    setData([]);
    setPage(1);
    setHasMore(true);
    setError(null);
  }, [query]);

  // Debounced search
  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      setData([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const response = await api.client.searchMovies(query, 1);
        setData(response.results);
        setHasMore(response.page < response.total_pages);
        setPage(1);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed');
      } finally {
        setIsLoading(false);
      }
    }, debounceMs);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, debounceMs]);

  const fetchMore = useCallback(async () => {
    if (!hasMore || isLoading || isFetchingMore.current || !query.trim()) return;

    isFetchingMore.current = true;
    const nextPage = page + 1;

    try {
      const response = await api.client.searchMovies(query, nextPage);
      setData((prev) => [...prev, ...response.results]);
      setHasMore(response.page < response.total_pages);
      setPage(nextPage);
    } catch (err) {
      console.error('Failed to fetch more:', err);
    } finally {
      isFetchingMore.current = false;
    }
  }, [hasMore, isLoading, query, page]);

  return { data, isLoading, error, fetchMore, hasMore };
}
