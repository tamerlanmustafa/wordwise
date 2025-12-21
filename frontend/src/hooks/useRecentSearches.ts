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

// Cached snapshot to avoid infinite loops
let cachedSearches: RecentSearch[] = [];
let cachedJson = '';

// Helper to get current value from localStorage (with caching)
function getStoredSearches(): RecentSearch[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) || '[]';
    // Only parse if the string changed
    if (stored !== cachedJson) {
      cachedJson = stored;
      cachedSearches = JSON.parse(stored);
    }
    return cachedSearches;
  } catch {
    return cachedSearches;
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

    // Update cache and persist
    const newJson = JSON.stringify(updated);
    cachedJson = newJson;
    cachedSearches = updated;
    localStorage.setItem(STORAGE_KEY, newJson);
    notifyListeners();
  }, []);

  const clearRecentSearches = useCallback(() => {
    cachedJson = '[]';
    cachedSearches = [];
    localStorage.removeItem(STORAGE_KEY);
    notifyListeners();
  }, []);

  return {
    recentSearches,
    addRecentSearch,
    clearRecentSearches
  };
}
