import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'wordwise_recent_searches';
const MAX_RECENT = 5;

export interface RecentSearch {
  id: number;
  title: string;
  year: number | null;
  poster: string | null;
  searchedAt: number;
}

export function useRecentSearches() {
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setRecentSearches(JSON.parse(stored));
      }
    } catch {
      // Invalid data, reset
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const addRecentSearch = useCallback((movie: Omit<RecentSearch, 'searchedAt'>) => {
    setRecentSearches(prev => {
      // Remove if already exists
      const filtered = prev.filter(s => s.id !== movie.id);

      // Add to front with timestamp
      const updated = [
        { ...movie, searchedAt: Date.now() },
        ...filtered
      ].slice(0, MAX_RECENT);

      // Persist to localStorage
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));

      return updated;
    });
  }, []);

  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return {
    recentSearches,
    addRecentSearch,
    clearRecentSearches
  };
}
