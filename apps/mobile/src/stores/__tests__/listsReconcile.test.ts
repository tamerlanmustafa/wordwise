/**
 * The arithmetic behind the Lists tab's numbers.
 *
 * Two bugs lived here, both measured on device before this change:
 *
 *   • The index went stale. It re-read only the reel row on focus, so saving a
 *     word on Home left Favourites at 7 while the server said 8, and a list
 *     created elsewhere never appeared until relaunch. The index now re-reads
 *     everything on focus — which is only affordable if an unchanged refresh
 *     re-renders nothing, hence `reconcileLists`.
 *
 *   • The open list's header never moved. Removing an item decremented the
 *     index row but not the page's own summary: "3 WORDS" above two words,
 *     "1 FILM · 992 WORDS" above an empty list.
 */

import type { ListFilmItem, ListSummary, ListWordItem } from '../../core/types';
import {
  adjustSummaryForRemoval,
  itemKey,
  reconcileLists,
  replaceSummary,
  sameSummary,
} from '../listsReconcile';

const row = (over: Partial<ListSummary> = {}): ListSummary => ({
  id: 1,
  name: 'Travel',
  kind: 'words',
  systemKey: null,
  count: 3,
  totalWords: null,
  preview: { posters: null, words: ['luggage'] },
  updatedAt: '2026-09-14T00:00:00Z',
  ...over,
});

const film = (over: Partial<ListFilmItem> = {}): ListFilmItem => ({
  tmdbId: 381289,
  title: "A Dog's Purpose",
  posterPath: null,
  year: 2017,
  rating: 7.6,
  cefr: 'A1',
  wordCount: 992,
  addedAt: 'x',
  ...over,
});

const word = (w: string): ListWordItem => ({
  word: w, lemmaId: null, pos: null, cefr: null, srsState: 'new', addedAt: 'x',
});

describe('reconcileLists', () => {
  it('returns the SAME array when nothing changed', () => {
    // The whole reason a focus refresh is affordable. A new array here would
    // re-render every row each time the reader backed out of a list.
    const prev = [row({ id: 1 }), row({ id: 2, name: 'Food' })];
    const fresh = [row({ id: 1 }), row({ id: 2, name: 'Food' })];
    expect(reconcileLists(prev, fresh)).toBe(prev);
  });

  it('keeps unchanged rows as the same objects when one row changed', () => {
    const prev = [row({ id: 1 }), row({ id: 2, name: 'Food' })];
    const fresh = [row({ id: 1 }), row({ id: 2, name: 'Food', count: 9 })];
    const out = reconcileLists(prev, fresh);
    expect(out).not.toBe(prev);
    expect(out[0]).toBe(prev[0]);
    expect(out[1].count).toBe(9);
  });

  it('picks up a count that changed elsewhere', () => {
    // Favourites after a save on Home — 7 on screen, 8 on the server.
    const prev = [row({ id: 2, systemKey: 'favourites', count: 7 })];
    const out = reconcileLists(prev, [row({ id: 2, systemKey: 'favourites', count: 8 })]);
    expect(out[0].count).toBe(8);
  });

  it('picks up a list created somewhere else', () => {
    const prev = [row({ id: 1 })];
    const out = reconcileLists(prev, [row({ id: 1 }), row({ id: 441, name: 'Audit Films', kind: 'films' })]);
    expect(out.map((l) => l.id)).toEqual([1, 441]);
    expect(out[0]).toBe(prev[0]);
  });

  it('drops a list deleted somewhere else', () => {
    const prev = [row({ id: 1 }), row({ id: 2 })];
    expect(reconcileLists(prev, [row({ id: 2 })]).map((l) => l.id)).toEqual([2]);
  });

  it('treats a reorder as a change, even with identical rows', () => {
    const a = row({ id: 1 });
    const b = row({ id: 2, name: 'Food' });
    const out = reconcileLists([a, b], [row({ id: 2, name: 'Food' }), row({ id: 1 })]);
    expect(out.map((l) => l.id)).toEqual([2, 1]);
    expect(out[0]).toBe(b);
  });
});

describe('replaceSummary', () => {
  it('returns the same array for an unchanged row', () => {
    const prev = [row()];
    expect(replaceSummary(prev, row())).toBe(prev);
  });

  it('ignores a row the index does not have', () => {
    const prev = [row()];
    expect(replaceSummary(prev, row({ id: 99 }))).toBe(prev);
  });
});

describe('sameSummary', () => {
  it('compares the preview by value', () => {
    expect(sameSummary(row(), row({ preview: { posters: null, words: ['luggage'] } }))).toBe(true);
    expect(sameSummary(row(), row({ preview: { posters: null, words: ['passport'] } }))).toBe(false);
  });
});

describe('adjustSummaryForRemoval', () => {
  it('takes one off a words list', () => {
    expect(adjustSummaryForRemoval(row({ count: 3 }), word('goulash'), -1).count).toBe(2);
  });

  it('takes the film’s vocabulary off a films list with it', () => {
    // "1 FILM · 992 WORDS" above an empty list: the count was never the only
    // number in that header.
    const s = row({ kind: 'films', count: 1, totalWords: 992 });
    const out = adjustSummaryForRemoval(s, film({ wordCount: 992 }), -1);
    expect(out.count).toBe(0);
    expect(out.totalWords).toBe(0);
  });

  it('puts both back on restore', () => {
    const s = row({ kind: 'films', count: 0, totalWords: 0 });
    const out = adjustSummaryForRemoval(s, film({ wordCount: 992 }), 1);
    expect(out.count).toBe(1);
    expect(out.totalWords).toBe(992);
  });

  it('never goes below zero', () => {
    expect(adjustSummaryForRemoval(row({ count: 0 }), word('x'), -1).count).toBe(0);
    const s = row({ kind: 'films', count: 1, totalWords: 10 });
    expect(adjustSummaryForRemoval(s, film({ wordCount: 50 }), -1).totalWords).toBe(0);
  });

  it('treats a film with no known word count as zero words', () => {
    const s = row({ kind: 'films', count: 2, totalWords: 500 });
    expect(adjustSummaryForRemoval(s, film({ wordCount: null }), -1).totalWords).toBe(500);
  });

  it('does not invent a totalWords for a words list', () => {
    expect(adjustSummaryForRemoval(row({ totalWords: null }), word('x'), -1).totalWords).toBeNull();
  });

  it('does not mutate what it was given', () => {
    const s = row({ count: 3 });
    adjustSummaryForRemoval(s, word('x'), -1);
    expect(s.count).toBe(3);
  });
});

describe('itemKey', () => {
  it('addresses a film by TMDB id and a word by the word', () => {
    expect(itemKey(film({ tmdbId: 7 }))).toBe(7);
    expect(itemKey(word('luggage'))).toBe('luggage');
  });
});
