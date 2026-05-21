/**
 * myMoviesStore — sort + filter UI state for the My Movies tab.
 *
 * Tile data still flows through the existing `reelStore` (the backend
 * route is `/reel` and the records live in `user_reel_movies`). This
 * store is purely the UI state for the new flat list: which sort is
 * picked, which filter chip is active. Persisted to AsyncStorage so
 * the user's preference survives reinstalls.
 *
 * The eventual rename of `reelStore` → `myMoviesStore` is a separate
 * commit per CLAUDE_PROMPT.md §2 ("alias for now"). For now we re-export
 * the existing hook so callers can `import { useReelStore } from
 * 'stores/myMoviesStore'` and not break when we flip the underlying file.
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

export { useReelStore } from './reelStore';

/** The 8 sort options on the My Movies tab. Order matters — this is
 *  also the order shown in the ActionSheet. Persisted as the string
 *  value (not an enum index) so renaming/adding doesn't corrupt state. */
export type MyMoviesSort =
  | 'recently_added'
  | 'title_asc'
  | 'year_desc'
  | 'year_asc'
  | 'comprehension_desc'
  | 'comprehension_asc'
  | 'cefr_easy_first'
  | 'rating_desc';

export const SORT_LABELS: Record<MyMoviesSort, string> = {
  recently_added:     'Recently added',
  title_asc:          'Title (A–Z)',
  year_desc:          'Year (newest)',
  year_asc:           'Year (oldest)',
  comprehension_desc: 'Comprehension (high)',
  comprehension_asc:  'Comprehension (low)',
  cefr_easy_first:    'CEFR (easy → hard)',
  rating_desc:        'Rating (TMDB)',
};

export const SORT_ORDER: MyMoviesSort[] = [
  'recently_added', 'title_asc', 'year_desc', 'year_asc',
  'comprehension_desc', 'comprehension_asc', 'cefr_easy_first', 'rating_desc',
];

/** Static filter chips. CEFR chips are derived dynamically from the
 *  tiles the user actually has — they're appended at render time. */
export type MyMoviesFilter = 'all' | 'in_progress' | 'mastered' | 'not_started' | string;

interface MyMoviesUiState {
  sort: MyMoviesSort;
  filter: MyMoviesFilter;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setSort: (s: MyMoviesSort) => void;
  setFilter: (f: MyMoviesFilter) => void;
}

const KEY = 'myMovies.ui.v1';

interface PersistShape {
  sort: MyMoviesSort;
  filter: MyMoviesFilter;
}

async function load(): Promise<PersistShape | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.sort !== 'string' || typeof parsed?.filter !== 'string') return null;
    return parsed as PersistShape;
  } catch {
    return null;
  }
}

async function save(s: PersistShape): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* best-effort */
  }
}

export const useMyMoviesUiStore = create<MyMoviesUiState>((set, get) => ({
  sort: 'recently_added',
  filter: 'all',
  hydrated: false,

  hydrate: async () => {
    const persisted = await load();
    if (persisted) {
      set({ sort: persisted.sort, filter: persisted.filter, hydrated: true });
    } else {
      set({ hydrated: true });
    }
  },

  setSort: (sort) => {
    set({ sort });
    void save({ sort, filter: get().filter });
  },

  setFilter: (filter) => {
    set({ filter });
    void save({ sort: get().sort, filter });
  },
}));
