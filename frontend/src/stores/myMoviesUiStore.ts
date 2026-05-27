/**
 * myMoviesUiStore — sort + filter UI state for the My Movies page.
 *
 * Mirrors apps/mobile/src/stores/myMoviesStore.ts. Tile data flows
 * through `reelStore`; this is purely UI state. Persisted to
 * localStorage so the user's preference survives reload.
 */

import { create } from 'zustand';

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
  recently_added: 'Recently added',
  title_asc: 'Title (A–Z)',
  year_desc: 'Year (newest)',
  year_asc: 'Year (oldest)',
  comprehension_desc: 'Comprehension (high)',
  comprehension_asc: 'Comprehension (low)',
  cefr_easy_first: 'CEFR (easy → hard)',
  rating_desc: 'Rating (TMDB)',
};

export const SORT_ORDER: MyMoviesSort[] = [
  'recently_added',
  'title_asc',
  'year_desc',
  'year_asc',
  'comprehension_desc',
  'comprehension_asc',
  'cefr_easy_first',
  'rating_desc',
];

/** Static filter chips. CEFR chips are derived from the tiles the user
 *  actually has — appended at render time. */
export type MyMoviesFilter =
  | 'all'
  | 'in_progress'
  | 'mastered'
  | 'not_started'
  | string;

interface MyMoviesUiState {
  sort: MyMoviesSort;
  filter: MyMoviesFilter;
  hydrated: boolean;
  hydrate: () => void;
  setSort: (s: MyMoviesSort) => void;
  setFilter: (f: MyMoviesFilter) => void;
}

const KEY = 'myMovies.ui.v1';

interface PersistShape {
  sort: MyMoviesSort;
  filter: MyMoviesFilter;
}

function load(): PersistShape | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.sort !== 'string' ||
      typeof parsed?.filter !== 'string'
    ) {
      return null;
    }
    return parsed as PersistShape;
  } catch {
    return null;
  }
}

function save(s: PersistShape) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* best-effort */
  }
}

export const useMyMoviesUiStore = create<MyMoviesUiState>((set, get) => ({
  sort: 'recently_added',
  filter: 'all',
  hydrated: false,

  hydrate: () => {
    const persisted = load();
    if (persisted) {
      set({
        sort: persisted.sort,
        filter: persisted.filter,
        hydrated: true,
      });
    } else {
      set({ hydrated: true });
    }
  },

  setSort: (sort) => {
    set({ sort });
    save({ sort, filter: get().filter });
  },

  setFilter: (filter) => {
    set({ filter });
    save({ sort: get().sort, filter });
  },
}));
