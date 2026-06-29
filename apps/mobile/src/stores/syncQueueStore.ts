/**
 * syncQueueStore — durable queue of mutations made while offline (States §D).
 *
 * When the device can't reach the server, user actions (add/remove a reel
 * tile, etc.) are enqueued here instead of lost. On reconnect the caller runs
 * `flush(executor)` to replay them in order; succeeded items drop off, failed
 * ones stay for the next attempt.
 *
 * Connectivity: the app has no continuous NetInfo listener and netinfo isn't a
 * dependency, so this store is deliberately connectivity-agnostic — it owns the
 * queue + replay, and whoever knows the device came back online (e.g. authStore
 * flipping out of `offline_authenticated`) calls `flush`. Modelled on
 * dailyGoalStore.ts: zustand + AsyncStorage behind `hydrate()`, key
 * `sync.queue.v1`.
 *
 * Idempotency: every mutation carries a stable `id`. Enqueuing an id already in
 * the queue is a no-op, so a double-tap (or a retry that re-enqueues) never
 * duplicates the action.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'sync.queue.v1';

export interface SyncMutation {
  /** Stable identity — dedupes enqueues and drives idempotency. */
  id: string;
  /** Caller-defined discriminator (e.g. 'reel.add'). */
  kind: string;
  payload?: unknown;
  createdAt: number;
}

/** Runs one queued mutation. Resolve = done (drop it); reject = keep for retry. */
export type SyncExecutor = (m: SyncMutation) => Promise<void>;

interface SyncQueueState {
  queue: SyncMutation[];
  hydrated: boolean;
  flushing: boolean;
  hydrate: () => Promise<void>;
  /** Add a mutation. No-op if an item with the same id is already queued. */
  enqueue: (m: Omit<SyncMutation, 'createdAt'> & { createdAt?: number }) => void;
  /** Replay the queue oldest-first; drop succeeded, keep failed. */
  flush: (executor: SyncExecutor) => Promise<{ flushed: number; remaining: number }>;
  clear: () => void;
}

async function persist(queue: SyncMutation[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    /* best-effort */
  }
}

export const useSyncQueueStore = create<SyncQueueState>((set, get) => ({
  queue: [],
  hydrated: false,
  flushing: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const queue = raw ? (JSON.parse(raw) as SyncMutation[]) : [];
      set({ queue: Array.isArray(queue) ? queue : [], hydrated: true });
    } catch {
      set({ queue: [], hydrated: true });
    }
  },

  enqueue: (m) => {
    const existing = get().queue;
    if (existing.some((q) => q.id === m.id)) return; // idempotent
    const next = [...existing, { ...m, createdAt: m.createdAt ?? Date.now() }];
    set({ queue: next });
    void persist(next);
  },

  flush: async (executor) => {
    if (get().flushing) return { flushed: 0, remaining: get().queue.length };
    set({ flushing: true });
    let flushed = 0;
    try {
      // Snapshot oldest-first; run sequentially so server-side order is kept.
      const items = [...get().queue];
      for (const item of items) {
        try {
          await executor(item);
          // Drop just this item; re-read so a concurrent enqueue isn't lost.
          const remaining = get().queue.filter((q) => q.id !== item.id);
          set({ queue: remaining });
          void persist(remaining);
          flushed += 1;
        } catch {
          // Stop on first failure — likely still offline; keep the rest.
          break;
        }
      }
    } finally {
      set({ flushing: false });
    }
    return { flushed, remaining: get().queue.length };
  },

  clear: () => {
    set({ queue: [] });
    void persist([]);
  },
}));
