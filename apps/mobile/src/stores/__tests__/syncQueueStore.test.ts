import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncQueueStore, type SyncMutation } from '../syncQueueStore';

const KEY = 'sync.queue.v1';
const flush = () => Promise.resolve();

const mut = (id: string, kind = 'reel.add'): Omit<SyncMutation, 'createdAt'> => ({ id, kind, payload: { id } });

describe('syncQueueStore', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useSyncQueueStore.setState({ queue: [], hydrated: false, flushing: false });
  });

  describe('enqueue', () => {
    it('adds mutations and persists them', async () => {
      useSyncQueueStore.getState().enqueue(mut('a'));
      useSyncQueueStore.getState().enqueue(mut('b'));
      expect(useSyncQueueStore.getState().queue.map((q) => q.id)).toEqual(['a', 'b']);

      await flush();
      const raw = await AsyncStorage.getItem(KEY);
      expect(JSON.parse(raw!).map((q: SyncMutation) => q.id)).toEqual(['a', 'b']);
    });

    it('is idempotent — re-enqueuing the same id is a no-op', () => {
      useSyncQueueStore.getState().enqueue(mut('a'));
      useSyncQueueStore.getState().enqueue(mut('a'));
      expect(useSyncQueueStore.getState().queue).toHaveLength(1);
    });
  });

  describe('hydrate', () => {
    it('restores a persisted queue', async () => {
      await AsyncStorage.setItem(KEY, JSON.stringify([{ id: 'x', kind: 'reel.add', createdAt: 1 }]));
      await useSyncQueueStore.getState().hydrate();
      expect(useSyncQueueStore.getState().queue.map((q) => q.id)).toEqual(['x']);
      expect(useSyncQueueStore.getState().hydrated).toBe(true);
    });

    it('tolerates malformed storage', async () => {
      await AsyncStorage.setItem(KEY, 'garbage');
      await useSyncQueueStore.getState().hydrate();
      expect(useSyncQueueStore.getState().queue).toEqual([]);
    });
  });

  describe('flush', () => {
    it('replays all mutations in order and empties the queue on success', async () => {
      const seen: string[] = [];
      useSyncQueueStore.getState().enqueue(mut('a'));
      useSyncQueueStore.getState().enqueue(mut('b'));
      useSyncQueueStore.getState().enqueue(mut('c'));

      const res = await useSyncQueueStore.getState().flush(async (m) => { seen.push(m.id); });
      expect(seen).toEqual(['a', 'b', 'c']);
      expect(res).toEqual({ flushed: 3, remaining: 0 });
      expect(useSyncQueueStore.getState().queue).toHaveLength(0);
    });

    it('stops at the first failure and keeps the rest for retry', async () => {
      useSyncQueueStore.getState().enqueue(mut('a'));
      useSyncQueueStore.getState().enqueue(mut('b'));
      useSyncQueueStore.getState().enqueue(mut('c'));

      const res = await useSyncQueueStore.getState().flush(async (m) => {
        if (m.id === 'b') throw new Error('still offline');
      });
      expect(res.flushed).toBe(1);
      // 'a' drained; 'b' and 'c' remain (order preserved).
      expect(useSyncQueueStore.getState().queue.map((q) => q.id)).toEqual(['b', 'c']);
    });

    it('a second flush resumes the remaining items', async () => {
      useSyncQueueStore.getState().enqueue(mut('a'));
      useSyncQueueStore.getState().enqueue(mut('b'));
      let online = false;
      const exec = async (m: SyncMutation) => { if (!online && m.id === 'b') throw new Error('offline'); };

      await useSyncQueueStore.getState().flush(exec); // a drains, b fails
      expect(useSyncQueueStore.getState().queue.map((q) => q.id)).toEqual(['b']);

      online = true;
      const res = await useSyncQueueStore.getState().flush(exec);
      expect(res.flushed).toBe(1);
      expect(useSyncQueueStore.getState().queue).toHaveLength(0);
    });

    it('persists the drained queue', async () => {
      useSyncQueueStore.getState().enqueue(mut('a'));
      await useSyncQueueStore.getState().flush(async () => {});
      await flush();
      expect(JSON.parse((await AsyncStorage.getItem(KEY))!)).toEqual([]);
    });
  });
});
