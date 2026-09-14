/**
 * listsReconcile — the pure half of keeping the Lists tab's numbers honest.
 *
 * Pulled out of `listsStore` so the arithmetic the bugs lived in can be tested
 * without a store, a network or a timer. Three things live here:
 *
 * 1. **Identity-preserving refresh.** The index now re-reads the server every
 *    time the tab comes into focus — it used to re-read only the reel row, so
 *    saving a word on Home left Favourites a word short, and a list created on
 *    another device never appeared until the app restarted. A plain
 *    `set({ lists })` on every focus would hand FlatList a brand-new array and
 *    re-render every row each time you backed out of a list, which is the
 *    exact flicker `replaceSummary` was introduced to stop. So the refresh
 *    reuses every summary object that has not changed, and the whole array
 *    when nothing has.
 *
 * 2. **Counts that move with a removal.** Removing an item decremented the
 *    index row but not the open list's own summary, so the header read
 *    "3 WORDS" above two words and "1 FILM · 992 WORDS" above an empty list.
 *    One function now adjusts a summary for a removal, and both copies go
 *    through it.
 *
 * 3. **The undo window.** How long a removal waits before it is sent.
 */

import type { ListFilmItem, ListItem, ListSummary } from '../core/types';

/**
 * How long a removal stays undoable before it reaches the server.
 *
 * The toast shows for exactly this long. Four seconds: long enough to read
 * "Removed from Travel" and reach Undo after a mis-tap, short enough that a
 * deliberate removal is gone before the reader has moved on. The removal is
 * held locally rather than sent and then reversed, so an undo restores the
 * item exactly — its position, its added date — instead of re-adding a copy.
 */
export const REMOVE_UNDO_MS = 4000;

/** The key a list item is addressed by on the wire: TMDB id, or the word. */
export function itemKey(item: ListItem): number | string {
  return 'tmdbId' in item ? item.tmdbId : item.word;
}

function sameStrings(x: string[] | null, y: string[] | null): boolean {
  return x === y || (!!x && !!y && x.length === y.length && x.every((v, i) => v === y[i]));
}

/** Whether two summaries carry the same row content. */
export function sameSummary(a: ListSummary, b: ListSummary): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.kind === b.kind &&
    a.systemKey === b.systemKey &&
    a.count === b.count &&
    a.totalWords === b.totalWords &&
    a.updatedAt === b.updatedAt &&
    sameStrings(a.preview.posters, b.preview.posters) &&
    sameStrings(a.preview.words, b.preview.words)
  );
}

/**
 * Swap one summary into the index, returning the SAME array when the row is
 * unchanged — so a re-read that found nothing new does not re-render the index.
 */
export function replaceSummary(lists: ListSummary[], next: ListSummary): ListSummary[] {
  const i = lists.findIndex((l) => l.id === next.id);
  if (i === -1) return lists;
  if (sameSummary(lists[i], next)) return lists;
  const copy = lists.slice();
  copy[i] = next;
  return copy;
}

/**
 * Merge a fresh index into the one on screen, keeping every object that did
 * not change.
 *
 * Returns `prev` itself when the fresh index is row-for-row identical, so a
 * focus refresh that finds nothing new costs FlatList nothing at all.
 */
export function reconcileLists(prev: ListSummary[], next: ListSummary[]): ListSummary[] {
  const byId = new Map(prev.map((l) => [l.id, l]));
  let changed = prev.length !== next.length;
  const merged = next.map((fresh, i) => {
    const old = byId.get(fresh.id);
    if (old && sameSummary(old, fresh)) {
      if (prev[i] !== old) changed = true; // same row, new position
      return old;
    }
    changed = true;
    return fresh;
  });
  return changed ? merged : prev;
}

/**
 * A summary as it reads once `item` is removed (`direction: -1`) or restored
 * (`direction: +1`).
 *
 * Films lists also carry `totalWords` — the combined vocabulary of their films
 * — so removing a film takes its word count with it. Without that the header
 * kept announcing the vocabulary of a film no longer in the list.
 */
export function adjustSummaryForRemoval(
  summary: ListSummary,
  item: ListItem,
  direction: -1 | 1,
): ListSummary {
  const count = Math.max(0, summary.count + direction);
  let totalWords = summary.totalWords;
  if (totalWords != null && 'tmdbId' in item) {
    const words = (item as ListFilmItem).wordCount ?? 0;
    totalWords = Math.max(0, totalWords + direction * words);
  }
  return { ...summary, count, totalWords };
}
