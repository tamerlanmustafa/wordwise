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
 * summary for that row goes stale. The index re-reads the server whenever the
 * tab comes into focus (`fetchLists`, reconciled so unchanged rows keep their
 * identity), and `subscribeToReel` keeps the reel row live while the user is
 * already sitting on the tab. The two must never disagree on screen.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { classifyFailure, type ConnectionFailure } from '../services/connection';
import { listsApi } from '../services/api';
import type {
  ListDetail,
  ListItem,
  ListKind,
  ListSort,
  ListSummary,
} from '../core/types';
import { readCache, writeCache } from '../services/swrCache';
import { t } from '../i18n';
import { useReelStore } from './reelStore';
import { showToast } from './toastStore';
import {
  adjustSummaryForRemoval,
  itemKey,
  REMOVE_UNDO_MS,
  reconcileLists,
  replaceSummary,
} from './listsReconcile';

export { REMOVE_UNDO_MS };

const ACTIVE_KIND_KEY = 'lists.activeKind.v1';

/**
 * The index, kept on disk so opening the tab shows lists instead of skeleton
 * rows while a request is in flight.
 *
 * The tab is lazily mounted, so before this the first tap of every cold start
 * bought a full round trip of grey rectangles. `fetchLists` already refused to
 * blank a populated list on a failed refresh — this simply gives it something
 * to be populated *with* on the first load, which is the one time it had
 * nothing.
 *
 * Longer-lived than the film feed's 24h cache, because this is the user's own
 * data rather than a server draw that rotates: their lists are almost always
 * exactly what they were when they last looked, and the refresh lands moments
 * later either way.
 */
const LISTS_CACHE_KEY = 'lists.index.v1';
const LISTS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
  /** WHY the last load failed, for the error view. `loadError` says something
   *  went wrong; this says whether it is the reader's network or our server,
   *  which are different sentences and different advice. */
  failure: ConnectionFailure | null;
  /**
   * Why an open list's page could not load, per list.
   *
   * Separate from `failure`, which belongs to the INDEX. A failed detail used
   * to set the index's flag and nothing of its own — so the open list sat on
   * its skeleton forever (its "loading" test is simply "no page yet"), while
   * the index behind it grew a connection strip for a request it never made.
   */
  detailFailure: Record<number, ConnectionFailure>;
  error: string | null;
  activeKind: ListKind;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  fetchLists: () => Promise<void>;
  fetchDetail: (id: number, sort?: ListSort) => Promise<void>;
  create: (name: string, kind: ListKind) => Promise<ListSummary>;
  rename: (id: number, name: string) => Promise<void>;
  /** Resolves true once the server has deleted it, false if it was restored. */
  destroy: (id: number) => Promise<boolean>;
  addItems: (
    id: number,
    payload: Parameters<typeof listsApi.addItems>[1],
  ) => Promise<void>;
  /** Immediate removal, for a control that is itself the undo — the word
   *  feed's add-to-list checkbox, which the user can simply tick again. */
  removeItem: (id: number, key: number | string) => Promise<void>;
  /**
   * Remove now, delete on the server after `REMOVE_UNDO_MS`. Returns the undo.
   *
   * For the open list, where a removal used to be one silent tap with no way
   * back: the item vanished, and on a custom words list the control that did
   * it was drawn as an empty heart — "favourite this" — so people deleted the
   * words they were trying to keep.
   */
  removeItemWithUndo: (id: number, key: number | string) => () => void;
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

/**
 * Removals the user can still undo, keyed `${listId}:${itemKey}`.
 *
 * Module-level rather than store state: a timer is not something a component
 * renders, and holding it in zustand would re-render every subscriber each
 * time one started or stopped. What IS rendered — the item gone, the counts
 * down — is applied to the store immediately.
 *
 * If the app dies inside the window, the delete was never sent and the item is
 * simply still there on next launch. That is the safe direction to fail in:
 * an undo window that loses a removal is a nuisance, one that loses an item
 * the user meant to keep is the bug this exists to prevent.
 */
interface PendingRemoval {
  listId: number;
  key: number | string;
  item: ListItem;
  index: number;
  timer: ReturnType<typeof setTimeout>;
}
const pendingRemovals = new Map<string, PendingRemoval>();
const pendingId = (listId: number, key: number | string) => `${listId}:${String(key)}`;

/** Items of `listId` that are hidden but not yet deleted on the server. */
function pendingFor(listId: number): PendingRemoval[] {
  return [...pendingRemovals.values()].filter((p) => p.listId === listId);
}

/** A summary with its pending removals already subtracted — the server still
 *  counts them, so a refresh mid-window would otherwise tick the count back up. */
function summaryWithoutPending(summary: ListSummary): ListSummary {
  let out = summary;
  for (const p of pendingFor(summary.id)) out = adjustSummaryForRemoval(out, p.item, -1);
  return out;
}

/** A detail page with pending removals taken out, and its summary to match —
 *  so a refresh landing mid-window cannot bring a removed item back. */
function withoutPending(detail: ListDetail): ListDetail {
  const pending = pendingFor(detail.summary.id);
  if (pending.length === 0) return detail;
  const hidden = new Set(pending.map((p) => String(p.key)));
  return {
    ...detail,
    summary: summaryWithoutPending(detail.summary),
    items: detail.items.filter((item) => !hidden.has(String(itemKey(item)))),
  };
}

/** The error a list mutation shows, in the user's language. */
function mutationError(fallbackKey: string): string {
  return t(fallbackKey);
}

export const useListsStore = create<ListsState>((set, get) => ({
  lists: [],
  byId: {},
  status: 'idle',
  loadError: false,
  failure: null,
  detailFailure: {},
  error: null,
  // Words, not films. The Lists tab is where saved vocabulary lives — the
  // film lists are a way of grouping the words, not the point of the screen.
  activeKind: 'words',
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    let activeKind: ListKind = 'words';
    try {
      const stored = await AsyncStorage.getItem(ACTIVE_KIND_KEY);
      if (stored === 'films' || stored === 'words') activeKind = stored;
    } catch {
      // A lost preference just reopens on the default — not worth surfacing.
    }
    // Note the storage key is NOT bumped along with this default. It is only
    // ever written by `setActiveKind`, i.e. when the user taps a segment, so
    // a stored 'films' is a deliberate choice and keeps working; anyone who
    // never touched the switch has nothing stored and gets the new default.
    // Bumping the key would overwrite a real preference to win an argument
    // about a default.
    // Paint the last known index before the request goes out. Guarded on
    // `lists.length` so a cache read that loses a race to the network — the
    // store is a singleton and `hydrate` is not the only caller of
    // `fetchLists` — cannot repaint stale rows over fresh ones.
    const cached = await readCache<ListSummary[]>(LISTS_CACHE_KEY, LISTS_CACHE_TTL_MS);
    const paint =
      Array.isArray(cached) && cached.length > 0 && get().lists.length === 0
        ? { lists: cached, status: 'ready' as Status }
        : {};

    set({ activeKind, hydrated: true, ...paint });
    await get().fetchLists();
  },

  fetchLists: async () => {
    // Keep whatever is cached on screen while refetching (§8): a failed
    // refresh must never blank a populated list.
    set({ status: get().lists.length ? 'ready' : 'loading', loadError: false });
    try {
      const fresh = (await listsApi.list()).map(summaryWithoutPending);
      // Reconciled, not replaced. This runs on every focus of the tab now, and
      // a new array each time would re-render every row on the way back out of
      // a list — see listsReconcile.
      set({
        lists: reconcileLists(get().lists, fresh),
        status: 'ready',
        loadError: false,
        failure: null,
        error: null,
      });
      // Fire-and-forget: caching is an optimisation, never a step the user
      // waits behind.
      void writeCache(LISTS_CACHE_KEY, fresh);
    } catch (e) {
      console.warn('[listsStore] fetchLists failed:', e);
      set({ status: 'ready', loadError: true, failure: classifyFailure(e) });
    }
  },

  fetchDetail: async (id, sort) => {
    try {
      // Pending removals filtered out, so a sort change or a refresh inside the
      // undo window cannot bring a removed item back.
      const detail = withoutPending(await listsApi.detail(id, { sort }));
      const otherFailures = { ...get().detailFailure };
      delete otherFailures[id];
      set({
        byId: { ...get().byId, [id]: detail },
        // The detail response carries a fresh summary — fold it back into
        // the index so a count changed elsewhere doesn't linger.
        lists: replaceSummary(get().lists, detail.summary),
        detailFailure: otherFailures,
      });
    } catch (e) {
      console.warn('[listsStore] fetchDetail failed:', e);
      // This list's failure, not the index's. See `detailFailure`.
      set({ detailFailure: { ...get().detailFailure, [id]: classifyFailure(e) } });
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
    const beforeDetail = get().byId[id];
    // Both copies. The open list's header reads its own summary, so renaming
    // only the index row left the screen you renamed it from showing the old
    // name until you backed out and in again.
    const renameIn = (d: ListDetail | undefined) =>
      d ? { ...d, summary: { ...d.summary, name } } : d;
    set({
      lists: before.map((l) => (l.id === id ? { ...l, name } : l)),
      byId: beforeDetail ? { ...get().byId, [id]: renameIn(beforeDetail)! } : get().byId,
    });
    try {
      const updated = await listsApi.rename(id, name);
      const current = get().byId[id];
      set({
        lists: replaceSummary(get().lists, updated),
        byId: current
          ? { ...get().byId, [id]: { ...current, summary: summaryWithoutPending(updated) } }
          : get().byId,
      });
    } catch (e) {
      set({
        lists: before,
        byId: beforeDetail ? { ...get().byId, [id]: beforeDetail } : get().byId,
      });
      // Rethrown, not toasted: a duplicate name belongs on the sheet's field.
      throw e;
    }
  },

  destroy: async (id) => {
    // Nothing still waiting to be removed from a list that is about to stop
    // existing — those deletes would 404 and roll "back" into nothing.
    for (const p of pendingFor(id)) {
      clearTimeout(p.timer);
      pendingRemovals.delete(pendingId(p.listId, p.key));
    }
    const before = get().lists;
    set({ lists: before.filter((l) => l.id !== id) });
    try {
      await listsApi.remove(id);
      set({ byId: omit(get().byId, id) });
      return true;
    } catch (e) {
      console.warn('[listsStore] destroy failed, rolling back:', e);
      set({ lists: before });
      showToast({ message: mutationError('lists:error.deleteFailed'), tone: 'error' });
      return false;
    }
  },

  addItems: async (id, payload) => {
    // Adding back something that is waiting to be removed is an undo, not an
    // add: it is still on the server. Sending the add and then letting the
    // timer fire would delete the thing the user just put back.
    const keys = [
      ...(payload.films ?? []).map((f) => f.tmdb_id as number | string),
      ...(payload.words ?? []).map((w) => w.word),
    ];
    const undone = new Set<string>();
    for (const key of keys) {
      const p = pendingRemovals.get(pendingId(id, key));
      if (p) {
        restorePending(p);
        undone.add(String(key));
      }
    }
    // Filtered on what was undone, not on the pending map — `restorePending`
    // has already taken those keys out of it, so asking the map would send the
    // restored item to the server as a fresh add as well.
    const films = (payload.films ?? []).filter((f) => !undone.has(String(f.tmdb_id)));
    const words = (payload.words ?? []).filter((w) => !undone.has(w.word));
    const remaining = { ...(films.length ? { films } : {}), ...(words.length ? { words } : {}) };
    const added = films.length + words.length;
    if (added === 0) return;

    const before = get().lists;
    set({
      lists: before.map((l) => (l.id === id ? { ...l, count: l.count + added } : l)),
    });
    try {
      const updated = await listsApi.addItems(id, remaining);
      set({
        lists: replaceSummary(get().lists, summaryWithoutPending(updated)),
        // The cached page no longer matches the server's ordering.
        byId: omit(get().byId, id),
      });
    } catch (e) {
      console.warn('[listsStore] addItems failed, rolling back:', e);
      set({ lists: before });
      showToast({ message: mutationError('lists:error.addFailed'), tone: 'error' });
    }
  },

  removeItem: async (id, key) => {
    // A removal already waiting in an undo window is superseded by this one.
    const waiting = pendingRemovals.get(pendingId(id, key));
    if (waiting) {
      clearTimeout(waiting.timer);
      pendingRemovals.delete(pendingId(id, key));
    }
    const beforeLists = get().lists;
    const beforeDetail = get().byId[id];
    const removed = beforeDetail?.items.find((item) => itemKey(item) === key);

    set(hideItem(get(), id, key, removed));

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
      showToast({ message: mutationError('lists:error.removeFailed'), tone: 'error' });
    }
  },

  removeItemWithUndo: (id, key) => {
    const pid = pendingId(id, key);
    const detail = get().byId[id];
    const index = detail?.items.findIndex((item) => itemKey(item) === key) ?? -1;
    const item = index >= 0 ? detail!.items[index] : undefined;
    // Nothing on screen to remove, or already waiting: a second tap on a row
    // that is mid-fade must not schedule a second delete.
    if (!item || pendingRemovals.has(pid)) return () => {};

    set(hideItem(get(), id, key, item));

    let committed = false;
    const timer = setTimeout(() => {
      pendingRemovals.delete(pid);
      committed = true;
      listsApi.removeItem(id, key).catch((e) => {
        console.warn('[listsStore] deferred remove failed, restoring:', e);
        restoreItem(id, item, index);
        showToast({ message: mutationError('lists:error.removeFailed'), tone: 'error' });
      });
    }, REMOVE_UNDO_MS);

    pendingRemovals.set(pid, { listId: id, key, item, index, timer });

    return () => {
      const p = pendingRemovals.get(pid);
      if (p) {
        restorePending(p);
        return;
      }
      if (committed) {
        // Reached Undo in the last instant, after the delete had already gone
        // out. Put it back for real rather than let the button do nothing.
        //
        // The API directly, NOT the store's `addItems`: that one throws away
        // the cached page on success (right for an add from the word feed,
        // whose list is not open) — and here the list IS open, showing that
        // page, with nothing to re-fetch it. The screen would fall back to its
        // skeleton the moment the undo succeeded.
        restoreItem(id, item, index);
        listsApi
          .addItems(id, addPayloadFor(item))
          .then((updated) => {
            useListsStore.setState({
              lists: replaceSummary(useListsStore.getState().lists, summaryWithoutPending(updated)),
            });
          })
          .catch((e) => {
            console.warn('[listsStore] late undo failed, removing again:', e);
            useListsStore.setState(hideItem(useListsStore.getState(), id, key, item));
            showToast({ message: mutationError('lists:error.addFailed'), tone: 'error' });
          });
      }
    };
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

  reset: () => {
    // Dropped, not flushed. Sign-out clears the tokens before this runs, so a
    // delete sent now would go out as nobody — and a timer left running would
    // fire under the NEXT account's session. The items are still on the
    // server; the signed-out account simply keeps them.
    for (const p of pendingRemovals.values()) clearTimeout(p.timer);
    pendingRemovals.clear();
    set({
      lists: [],
      byId: {},
      status: 'idle',
      loadError: false,
      failure: null,
      detailFailure: {},
      error: null,
      hydrated: false,
    });
  },
}));

/** The index and detail with one item hidden, both counts adjusted together. */
function hideItem(
  state: ListsState,
  listId: number,
  key: number | string,
  item: ListItem | undefined,
): Partial<ListsState> {
  const detail = state.byId[listId];
  return {
    lists: state.lists.map((l) =>
      l.id !== listId
        ? l
        : item
          ? adjustSummaryForRemoval(l, item, -1)
          : { ...l, count: Math.max(0, l.count - 1) },
    ),
    byId: detail
      ? {
          ...state.byId,
          [listId]: {
            ...detail,
            items: detail.items.filter((i) => itemKey(i) !== key),
            // The header's own copy of the count. This is the line that was
            // missing: "3 WORDS" above two words.
            summary: item ? adjustSummaryForRemoval(detail.summary, item, -1) : detail.summary,
          },
        }
      : state.byId,
  };
}

/** Put an item back where it was, and both counts with it. */
function restoreItem(listId: number, item: ListItem, index: number): void {
  const state = useListsStore.getState();
  const detail = state.byId[listId];
  const key = itemKey(item);
  const already = detail?.items.some((i) => itemKey(i) === key);
  useListsStore.setState({
    lists: state.lists.map((l) => (l.id === listId ? adjustSummaryForRemoval(l, item, 1) : l)),
    byId:
      detail && !already
        ? {
            ...state.byId,
            [listId]: {
              ...detail,
              items: [
                ...detail.items.slice(0, Math.min(index, detail.items.length)),
                item,
                ...detail.items.slice(Math.min(index, detail.items.length)),
              ],
              summary: adjustSummaryForRemoval(detail.summary, item, 1),
            },
          }
        : state.byId,
  });
}

/** Cancel a pending removal and restore what it hid. */
function restorePending(p: PendingRemoval): void {
  clearTimeout(p.timer);
  pendingRemovals.delete(pendingId(p.listId, p.key));
  restoreItem(p.listId, p.item, p.index);
}

/** The body that adds an item back, for the rare undo that lands after commit. */
function addPayloadFor(item: ListItem): Parameters<typeof listsApi.addItems>[1] {
  return 'tmdbId' in item
    ? { films: [{ tmdb_id: item.tmdbId, title: item.title, poster_path: item.posterPath, year: item.year }] }
    : { words: [{ word: item.word, lemma_id: item.lemmaId }] };
}

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
