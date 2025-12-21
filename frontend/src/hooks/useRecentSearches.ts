import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'wordwise_recent_searches';
const MAX_RECENT = 5;

export interface RecentSearch {
  id: number;
  title: string;
  year: number | null;
  poster: string | null;
  searchedAt: number;
}

// Helper to get current value from localStorage
function getStoredSearches(): RecentSearch[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

// Subscribers for cross-component sync
let listeners: Array<() => void> = [];

function subscribe(listener: () => void) {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter(l => l !== listener);
  };
}

function notifyListeners() {
  listeners.forEach(listener => listener());
}

export function useRecentSearches() {
  // Use useSyncExternalStore for cross-component synchronization
  const recentSearches = useSyncExternalStore(
    subscribe,
    getStoredSearches,
    getStoredSearches
  );

  const addRecentSearch = useCallback((movie: Omit<RecentSearch, 'searchedAt'>) => {
    const current = getStoredSearches();

    // Remove if already exists
    const filtered = current.filter(s => s.id !== movie.id);

    // Add to front with timestamp
    const updated = [
      { ...movie, searchedAt: Date.now() },
      ...filtered
    ].slice(0, MAX_RECENT);

    // Persist to localStorage and notify all subscribers
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    notifyListeners();
  }, []);

  const clearRecentSearches = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    notifyListeners();
  }, []);

  return {
    recentSearches,
    addRecentSearch,
    clearRecentSearches
  };
}
