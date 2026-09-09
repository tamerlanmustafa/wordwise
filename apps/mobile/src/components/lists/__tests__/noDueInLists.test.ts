/**
 * A list is a collection, not a chore sheet.
 *
 * Word lists used to surface the SRS schedule in four places at once: a
 * "· 4 DUE" count on the row and in the detail header, a gold button that
 * renamed itself "Practice 4 due", a "Soonest due" sort that was the *default*
 * for every words list, and a per-word "due today" state. Between them they
 * turned a set of words the reader had chosen to keep into a backlog with a
 * number on it that went up while they weren't looking.
 *
 * The schedule still exists and still runs — it is what the Practice tab is
 * for. What changed is that a list stopped reporting it.
 *
 * This guards the removal the way `notebookDetached` guards its own: against
 * the plumbing, not just the visible string. The type, the sort option, the
 * wire field and the default sort are each individually harmless-looking, and
 * together they are the feature.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import type { ListSort, ListWordSrsState } from '../../../core/types';

const SRC = join(__dirname, '..', '..', '..');

function read(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), 'utf8');
}

describe('word lists do not report the review schedule', () => {
  it('has no `due` sort to choose', () => {
    // Typed, so `sort: 'due'` fails to compile rather than reaching a server
    // that now answers 422 for it.
    const sorts: ListSort[] = ['added', 'title', 'rating', 'alpha'];
    expect(sorts).toHaveLength(4);
    expect(read('components', 'lists', 'SortSheet.tsx')).not.toContain("'due'");
  });

  it('opens a words list in the order its owner built it', () => {
    // It defaulted to 'due', which handed the reader their own collection in
    // whatever order the algorithm wanted. "Recently added" is the order they
    // would recognise.
    const detail = read('components', 'screens', 'ListDetailScreen.tsx');
    expect(detail).toContain("useState<ListSort>('added')");
    expect(detail).not.toContain("'words' ? 'due'");
  });

  it('has no due count on a row or in a header', () => {
    expect(read('components', 'lists', 'ListRow.tsx')).not.toContain('dueCount');
    expect(read('components', 'screens', 'ListDetailScreen.tsx')).not.toContain('dueCount');
  });

  it('gives the practice button one name', () => {
    // "Practice 6 due" / "Practice this list" meant the button renamed itself
    // as the schedule moved, and said "0 due" was a reason not to press it.
    const detail = read('components', 'screens', 'ListDetailScreen.tsx');
    expect(detail).toContain("t('practice.none')");
    expect(detail).not.toContain("practice.due");
  });

  it('has no `due` word state', () => {
    const states: ListWordSrsState[] = ['new', 'learning', 'learned'];
    expect(states).toHaveLength(3);
  });

  it('drops the copy nothing renders any more', () => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const lists = require('../../../i18n/locales/en/lists.json');
    expect(lists.meta.dueCount_one).toBeUndefined();
    expect(lists.practice.due_one).toBeUndefined();
    expect(lists.sort.due).toBeUndefined();
    expect(lists.srs.due).toBeUndefined();

    // The states that survive still need their words, and the button still
    // needs its one label — this must not become "the copy is all gone".
    expect(lists.srs.new).toBeTruthy();
    expect(lists.srs.learning).toBeTruthy();
    expect(lists.srs.learned).toBeTruthy();
    expect(lists.practice.none).toBeTruthy();
  });

  it('no longer models a next-review date it never showed', () => {
    // `nextReviewAt` was mapped off the wire, typed onto every word, and
    // rendered by nothing. Dead weight in the shape of a feature.
    expect(read('core', 'types.ts')).not.toContain('nextReviewAt');
    expect(read('services', 'api.ts')).not.toContain('next_review_at');
  });
});

/**
 * The "Did you know?" spacing-effect popup, removed in the same change.
 *
 * `TipPopup` and `tipDismissalsStore` are deliberately left in place — they
 * are the machinery for one-shot tips, and one tip being retired is not the
 * same as retiring tips. What must not survive is this tip: its key, its
 * trigger, and the three strings it rendered.
 */
describe('the spacing-effect tip is gone', () => {
  const review = read('components', 'ReviewScreen.tsx');

  it('has no tip key, state or trigger left in the review screen', () => {
    expect(review).not.toContain('SPACING_TIP_KEY');
    expect(review).not.toContain('spacingTip');
    expect(review).not.toContain('TipPopup');
  });

  it('drops its copy', () => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const quiz = require('../../../i18n/locales/en/quiz.json');
    expect(quiz.review.tipEyebrow).toBeUndefined();
    expect(quiz.review.tipTitle).toBeUndefined();
    expect(quiz.review.tipBody).toBeUndefined();
  });
});
