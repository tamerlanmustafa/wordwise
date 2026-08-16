/**
 * listsStore — the Lists tab's index and open-list state.
 *
 * Follows `reelStore`: optimistic writes with rollback, AsyncStorage for the
 * one piece of state that must survive a relaunch (`activeKind`, the selected
 * segment), and a `loadError` flag so an empty array after a failed fetch is
 * never mistaken for "you have no lists".
 *
 * Cross-store consistency: `Saved from Home` is backed server-side by the
 * reel, so a Home + tap writes through `reelStore` and this store's cached
 * summary for that row goes stale. `syncFromReel` re-reads the affected row;
 * App calls it on tab focus and `subscribeToReel` keeps it live while the
 * user is already sitting on the tab. The two must never disagree on screen.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ListApiError,
  listsApi,
} from '../services/api';
import type {
  ListDetail,
  ListKind,
  ListSort,
  ListSummary,
} from '../core/types';
import { useReelStore } from './reelStore';
import { showToast } from './toastStore';

const ACTIVE_KIND_KEY = 'lists.activeKind.v1';

/** Temp ids for optimistic rows are negative so they can never collide with
 *  a real server id, and so a stray render keys cleanly. */
let tempIdCounter = -1;

type Status = 'idle' | 'loading' | 'ready';

interface ListsState {
  lists: ListSummary[];
  byId: Record<number, ListDetail>;
  status: Status;
  /** True when the last fetch couldn't reach the server. An empty `lists`
   *  here means "we don't know", not "you have none". */
  loadError: boolean;
  error: string | null;
  activeKind: ListKind;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  fetchLists: () => Promise<void>;
  fetchDetail: (id: number, sort?: ListSort) => Promise<void>;
  create: (name: string, kind: ListKind) => Promise<ListSummary>;
  rename: (id: number, name: string) => Promise<void>;
  destroy: (id: number) => Promise<void>;
  addItems: (
    id: number,
    payload: Parameters<typeof listsApi.addItems>[1],
  ) => Promise<void>;
  removeItem: (id: number, key: number | string) => Promise<void>;
  reorder: (ids: number[]) => Promise<void>;
  setActiveKind: (kind: ListKind) => void;
  syncFromReel: () => Promise<void>;
  reset: () => void;
}

/** Drop one list's cached detail page. */
function omit(byId: Record<number, ListDetail>, id: number): Record<number, ListDetail> {
  const next = { ...byId };
  delete next[id];
  return next;
}

function replaceSummary(lists: ListSummary[], next: ListSummary): ListSummary[] {
  return lists.map((l) => (l.id === next.id ? next : l));
}

export const useListsStore = create<ListsState>((set, get) => ({
  lists: [],
  byId: {},
  status: 'idle',
  loadError: false,
  error: null,
  activeKind: 'films',
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    let activeKind: ListKind = 'films';
    try {
      const stored = await AsyncStorage.getItem(ACTIVE_KIND_KEY);
      if (stored === 'films' || stored === 'words') activeKind = stored;
    } catch {
      // A lost preference just reopens on Films — not worth surfacing.
    }
    set({ activeKind, hydrated: true });
    await get().fetchLists();
  },

  fetchLists: async () => {
    // Keep whatever is cached on screen while refetching (§8): a failed
    // refresh must never blank a populated list.
    set({ status: get().lists.length ? 'ready' : 'loading', loadError: false });
    try {
      const lists = await listsApi.list();
      set({ lists, status: 'ready', loadError: false, error: null });
    } catch (e) {
      console.warn('[listsStore] fetchLists failed:', e);
      set({ status: 'ready', loadError: true });
    }
  },

  fetchDetail: async (id, sort) => {
    try {
      const detail = await listsApi.detail(id, { sort });
      set({
        byId: { ...get().byId, [id]: detail },
        // The detail response carries a fresh summary — fold it back into
        // the index so a count changed elsewhere doesn't linger.
        lists: replaceSummary(get().lists, detail.summary),
        loadError: false,
      });
    } catch (e) {
      console.warn('[listsStore] fetchDetail failed:', e);
      set({ loadError: true });
    }
  },

  create: async (name, kind) => {
    // Optimistic row with a negative id, swapped for the real one on 201.
    const tempId = tempIdCounter--;
    const optimistic: ListSummary = {
      id: tempId,
      name,
      kind,
      systemKey: null,
      count: 0,
      dueCount: kind === 'words' ? 0 : null,
      totalWords: kind === 'films' ? 0 : null,
      preview: { posters: kind === 'films' ? [] : null, words: kind === 'words' ? [] : null },
      updatedAt: new Date().toISOString(),
    };
    set({ lists: [...get().lists, optimistic] });

    try {
      const created = await listsApi.create(name, kind);
      set({ lists: get().lists.map((l) => (l.id === tempId ? created : l)) });
      return created;
    } catch (e) {
      // Drop the temp row and rethrow. A duplicate name belongs on the
      // sheet's name field, not in a toast, so the sheet handles the error
      // rather than this store showing one.
      set({ lists: get().lists.filter((l) => l.id !== tempId) });
      throw e;
    }
  },

  rename: async (id, name) => {
    const before = get().lists;
    set({ lists: before.map((l) => (l.id === id ? { ...l, name } : l)) });
    try {
      const updated = await listsApi.rename(id, name);
      set({ lists: replaceSummary(get().lists, updated) });
    } catch (e) {
      set({ lists: before });
      throw e;
    }
  },

  destroy: async (id) => {
    const before = get().lists;
    set({ lists: before.filter((l) => l.id !== id) });
    try {
      await listsApi.remove(id);
      set({ byId: omit(get().byId, id) });
    } catch (e) {
      console.warn('[listsStore] destroy failed, rolling back:', e);
      set({ lists: before });
      showToast({
        message: e instanceof ListApiError ? e.message : "Couldn't delete that list",
        tone: 'error',
      });
    }
  },

  addItems: async (id, payload) => {
    const added = (payload.films?.length ?? 0) + (payload.words?.length ?? 0);
    const before = get().lists;
    set({
      lists: before.map((l) => (l.id === id ? { ...l, count: l.count + added } : l)),
    });
    try {
      const updated = await listsApi.addItems(id, payload);
      set({
        lists: replaceSummary(get().lists, updated),
        // The cached page no longer matches the server's ordering.
        byId: omit(get().byId, id),
      });
    } catch (e) {
      console.warn('[listsStore] addItems failed, rolling back:', e);
      set({ lists: before });
      showToast({
        message: e instanceof ListApiError ? e.message : "Couldn't add that",
        tone: 'error',
      });
    }
  },

  removeItem: async (id, key) => {
    const beforeLists = get().lists;
    const beforeDetail = get().byId[id];

    const detail = beforeDetail
      ? {
          ...beforeDetail,
          items: beforeDetail.items.filter((item) =>
            'tmdbId' in item ? item.tmdbId !== key : item.word !== key,
          ),
        }
      : undefined;

    set({
      lists: beforeLists.map((l) =>
        l.id === id ? { ...l, count: Math.max(0, l.count - 1) } : l,
      ),
      byId: detail ? { ...get().byId, [id]: detail } : get().byId,
    });

    try {
      await listsApi.removeItem(id, key);
    } catch (e) {
      console.warn('[listsStore] removeItem failed, rolling back:', e);
      set({
        lists: beforeLists,
        byId: beforeDetail
          ? { ...get().byId, [id]: beforeDetail }
          : get().byId,
      });
      showToast({
        message: e instanceof ListApiError ? e.message : "Couldn't remove that",
        tone: 'error',
      });
    }
  },

  reorder: async (ids) => {
    const before = get().lists;
    const rank = new Map(ids.map((id, i) => [id, i]));
    set({
      lists: [...before].sort(
        (a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0),
      ),
    });
    try {
      await listsApi.reorder(ids);
    } catch (e) {
      console.warn('[listsStore] reorder failed, rolling back:', e);
      set({ lists: before });
    }
  },

  setActiveKind: (kind) => {
    set({ activeKind: kind });
    AsyncStorage.setItem(ACTIVE_KIND_KEY, kind).catch(() => {});
  },

  syncFromReel: async () => {
    // Only the reel-backed row can drift, so refresh just that one rather
    // than the whole index.
    const reelList = get().lists.find((l) => l.systemKey === 'reel');
    if (!reelList) return;
    try {
      const detail = await listsApi.detail(reelList.id);
      set({
        lists: replaceSummary(get().lists, detail.summary),
        byId: { ...get().byId, [reelList.id]: detail },
      });
    } catch {
      // A stale count is better than a blanked row.
    }
  },

  reset: () =>
    set({
      lists: [],
      byId: {},
      status: 'idle',
      loadError: false,
      error: null,
      hydrated: false,
    }),
}));

/**
 * Keep `Saved from Home` in step with the reel while the user is on the tab.
 * Returns the zustand unsubscribe so callers can tear it down.
 *
 * Subscribing to the tile count rather than the array identity means a
 * refetch that returns identical tiles doesn't trigger a pointless request.
 */
export function subscribeToReel(): () => void {
  return useReelStore.subscribe((state, prev) => {
    if (state.tiles.length === prev.tiles.length) return;
    void useListsStore.getState().syncFromReel();
  });
}
