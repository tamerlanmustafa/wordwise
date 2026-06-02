import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useMyMoviesUiStore,
  SORT_LABELS,
  SORT_ORDER,
} from '../myMoviesStore';

const KEY = 'myMovies.ui.v1';
const flush = () => new Promise<void>((r) => setImmediate(r));

describe('myMoviesStore (sort/filter UI state)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useMyMoviesUiStore.setState({ sort: 'recently_added', filter: 'all', hydrated: false });
  });

  describe('static metadata', () => {
    it('every sort in SORT_ORDER has a human label', () => {
      SORT_ORDER.forEach((s) => {
        expect(SORT_LABELS[s]).toBeTruthy();
      });
    });

    it('SORT_ORDER and SORT_LABELS describe the same set of sorts', () => {
      expect(new Set(SORT_ORDER)).toEqual(new Set(Object.keys(SORT_LABELS)));
    });

    it('defaults to "recently added" as the first option', () => {
      expect(SORT_ORDER[0]).toBe('recently_added');
    });
  });

  describe('hydrate', () => {
    it('uses defaults when nothing persisted', async () => {
      await useMyMoviesUiStore.getState().hydrate();
      expect(useMyMoviesUiStore.getState()).toMatchObject({
        sort: 'recently_added',
        filter: 'all',
        hydrated: true,
      });
    });

    it('restores a persisted sort + filter', async () => {
      await AsyncStorage.setItem(KEY, JSON.stringify({ sort: 'title_asc', filter: 'mastered' }));
      await useMyMoviesUiStore.getState().hydrate();
      expect(useMyMoviesUiStore.getState()).toMatchObject({ sort: 'title_asc', filter: 'mastered' });
    });

    it('ignores malformed persisted shape', async () => {
      await AsyncStorage.setItem(KEY, JSON.stringify({ sort: 42 }));
      await useMyMoviesUiStore.getState().hydrate();
      expect(useMyMoviesUiStore.getState().sort).toBe('recently_added');
    });
  });

  describe('setSort / setFilter', () => {
    it('updates and persists the chosen sort', async () => {
      useMyMoviesUiStore.getState().setSort('rating_desc');
      expect(useMyMoviesUiStore.getState().sort).toBe('rating_desc');
      await flush();
      expect(JSON.parse((await AsyncStorage.getItem(KEY))!)).toMatchObject({ sort: 'rating_desc' });
    });

    it('updates and persists the chosen filter without clobbering the sort', async () => {
      useMyMoviesUiStore.getState().setSort('year_desc');
      useMyMoviesUiStore.getState().setFilter('in_progress');
      await flush();
      expect(JSON.parse((await AsyncStorage.getItem(KEY))!)).toMatchObject({
        sort: 'year_desc',
        filter: 'in_progress',
      });
    });

    it('accepts a dynamic CEFR filter chip (arbitrary string)', () => {
      useMyMoviesUiStore.getState().setFilter('B2');
      expect(useMyMoviesUiStore.getState().filter).toBe('B2');
    });
  });
});
