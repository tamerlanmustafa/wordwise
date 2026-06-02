import AsyncStorage from '@react-native-async-storage/async-storage';

// Mock just the reel slice of the API surface. The store only touches reelApi.
jest.mock('../../services/api', () => ({
  reelApi: {
    list: jest.fn(),
    seed: jest.fn(),
    add: jest.fn(),
    remove: jest.fn(),
  },
}));

import { useReelStore } from '../reelStore';
import { reelApi, type ReelTile } from '../../services/api';

const SEED_DONE_KEY = 'journey.reelSeedDone.v1';
const flush = () => new Promise<void>((r) => setImmediate(r));

const mockList = reelApi.list as jest.Mock;
const mockSeed = reelApi.seed as jest.Mock;
const mockAdd = reelApi.add as jest.Mock;
const mockRemove = reelApi.remove as jest.Mock;

const tile = (id: number, source: 'user' | 'suggested' = 'user'): ReelTile => ({
  tmdb_id: id,
  title: `Movie ${id}`,
  poster_path: `/p${id}.jpg`,
  year: 2020,
  source,
});

describe('reelStore', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    useReelStore.getState().reset();
  });

  describe('hydrate — first launch seeding', () => {
    it('seeds a starter reel when the server reel is empty and never seeded before', async () => {
      mockList.mockResolvedValue({ tiles: [], has_more: false });
      mockSeed.mockResolvedValue({ tiles: [tile(1, 'suggested')], seeded: 1 });

      await useReelStore.getState().hydrate();

      expect(mockSeed).toHaveBeenCalledTimes(1);
      expect(useReelStore.getState().tiles).toHaveLength(1);
      expect(useReelStore.getState().hydrated).toBe(true);
      expect(await AsyncStorage.getItem(SEED_DONE_KEY)).toBe('1');
    });

    it('does NOT re-seed an empty reel the user deliberately emptied', async () => {
      await AsyncStorage.setItem(SEED_DONE_KEY, '1');
      mockList.mockResolvedValue({ tiles: [], has_more: false });

      await useReelStore.getState().hydrate();

      expect(mockSeed).not.toHaveBeenCalled();
      expect(useReelStore.getState().tiles).toEqual([]);
      expect(useReelStore.getState().loadError).toBe(false);
    });

    it('marks an existing pre-flag user as seeded so we never seed over their reel', async () => {
      mockList.mockResolvedValue({ tiles: [tile(1)], has_more: false });

      await useReelStore.getState().hydrate();
      await flush();

      expect(mockSeed).not.toHaveBeenCalled();
      expect(await AsyncStorage.getItem(SEED_DONE_KEY)).toBe('1');
      expect(useReelStore.getState().userPickCount).toBe(1);
    });

    it('flags loadError (not "empty") when the server is unreachable', async () => {
      mockList.mockRejectedValue(new Error('network'));

      await useReelStore.getState().hydrate();

      expect(useReelStore.getState().loadError).toBe(true);
      expect(useReelStore.getState().hydrated).toBe(true);
      expect(useReelStore.getState().loading).toBe(false);
    });
  });

  describe('add', () => {
    it('optimistically inserts at the top of the reel, then reconciles with the server', async () => {
      mockAdd.mockResolvedValue(tile(7));
      mockList.mockResolvedValue({ tiles: [tile(7), tile(3)], has_more: false });

      const p = useReelStore.getState().add({
        tmdb_id: 7,
        title: 'Movie 7',
        poster_path: '/p7.jpg',
        year: 2020,
      });
      // Optimistic state is visible before the await settles.
      expect(useReelStore.getState().tiles[0].tmdb_id).toBe(7);
      await p;

      expect(mockAdd).toHaveBeenCalledTimes(1);
      expect(useReelStore.getState().tiles.map((t) => t.tmdb_id)).toEqual([7, 3]);
      expect(useReelStore.getState().userPickCount).toBe(2);
    });

    it('does nothing if the movie is already in the reel', async () => {
      useReelStore.setState({ tiles: [tile(7)], userPickCount: 1 });
      await useReelStore.getState().add({
        tmdb_id: 7,
        title: 'Movie 7',
        poster_path: null,
        year: null,
      });
      expect(mockAdd).not.toHaveBeenCalled();
    });

    it('rolls back the optimistic insert when the server rejects', async () => {
      mockAdd.mockRejectedValue(new Error('500'));
      useReelStore.setState({ tiles: [tile(3)], userPickCount: 1 });

      await useReelStore.getState().add({
        tmdb_id: 7,
        title: 'Movie 7',
        poster_path: null,
        year: null,
      });

      expect(useReelStore.getState().tiles.map((t) => t.tmdb_id)).toEqual([3]);
      expect(useReelStore.getState().userPickCount).toBe(1);
    });
  });

  describe('remove', () => {
    it('optimistically removes the tile and reconciles with the server', async () => {
      mockRemove.mockResolvedValue(undefined);
      mockList.mockResolvedValue({ tiles: [tile(3)], has_more: false });
      useReelStore.setState({ tiles: [tile(7), tile(3)], userPickCount: 2 });

      await useReelStore.getState().remove(7);

      expect(mockRemove).toHaveBeenCalledWith(7);
      expect(useReelStore.getState().tiles.map((t) => t.tmdb_id)).toEqual([3]);
    });

    it('rolls back when the server rejects the removal', async () => {
      mockRemove.mockRejectedValue(new Error('500'));
      useReelStore.setState({ tiles: [tile(7), tile(3)], userPickCount: 2 });

      await useReelStore.getState().remove(7);

      expect(useReelStore.getState().tiles.map((t) => t.tmdb_id)).toEqual([7, 3]);
      expect(useReelStore.getState().userPickCount).toBe(2);
    });
  });

  describe('has', () => {
    it('is true only for a user-sourced tile', () => {
      useReelStore.setState({ tiles: [tile(7, 'user'), tile(9, 'suggested')] });
      expect(useReelStore.getState().has(7)).toBe(true);
      expect(useReelStore.getState().has(9)).toBe(false); // suggested doesn't count
      expect(useReelStore.getState().has(123)).toBe(false);
    });
  });

  describe('reset', () => {
    it('clears all state back to the empty defaults', () => {
      useReelStore.setState({ tiles: [tile(7)], userPickCount: 1, hydrated: true, loadError: true });
      useReelStore.getState().reset();
      expect(useReelStore.getState()).toMatchObject({
        tiles: [],
        userPickCount: 0,
        hydrated: false,
        loading: false,
        loadError: false,
      });
    });
  });
});
