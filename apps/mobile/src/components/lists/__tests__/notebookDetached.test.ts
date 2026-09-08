/**
 * The saved-words notebook is gone, and nothing may quietly reach it again.
 *
 * Tapping a word inside an open list used to navigate to `NotebookScreen`: a
 * flat dump of *every* saved word on the account, unfiltered, with no
 * relationship to the word tapped or the list it was in. It was the last
 * survivor of the old "My Lists" hub that the Lists tab replaced — it still
 * painted from a hardcoded light-only palette (`primary: '#7C5CBF'`,
 * `background: '#FAFAF8'`), predating the theme system, so it rendered as a
 * white screen in dark mode.
 *
 * Deleting a screen is easy; keeping it deleted is the part that needs a test.
 * A discontinued view survives because of the plumbing around it, not because
 * of the file — a route branch, a `Screen` union member, a nav parent, a prop
 * threaded three components deep. Each of those alone looks like harmless
 * dead code, and together they are a working path back to a screen nobody
 * meant to ship. So this asserts the plumbing is gone, not just the file.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

import { PARENT_OF } from '../../../core/navParents';

const SRC = join(__dirname, '..', '..', '..');

function read(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), 'utf8');
}

describe('the saved-words notebook is detached', () => {
  it('has no screen file', () => {
    expect(existsSync(join(SRC, 'components', 'NotebookScreen.tsx'))).toBe(false);
  });

  it('has no route in the app shell', () => {
    const app = read('core', 'App.tsx');
    expect(app).not.toContain('NotebookScreen');
    expect(app).not.toContain("'notebook'");
    // The navigator and the filter state it carried go with it. A leftover
    // `navigateToNotebook` would compile fine and be one prop away from live.
    expect(app).not.toContain('navigateToNotebook');
    expect(app).not.toContain('listFilter');
  });

  it('is not a navigable screen', () => {
    // Not just absent from PARENT_OF — absent from the `Screen` union, so a
    // future `setCurrentScreen('notebook')` fails to typecheck rather than
    // silently rendering nothing.
    expect(Object.keys(PARENT_OF)).not.toContain('notebook');
    expect(read('core', 'types.ts')).not.toContain("'notebook'");
  });

  it('is not reachable from an open list', () => {
    // The actual entry point that prompted this. `onOpenWord` was the only
    // caller, threaded App → ListDetailScreen → WordItemRow.
    const detail = read('components', 'screens', 'ListDetailScreen.tsx');
    expect(detail).not.toContain('onOpenWord');
  });

  it('leaves the word row unpressable rather than pointed somewhere else', () => {
    // A row that still looks tappable and does nothing is worse than one that
    // never offered, so the body is a View. The heart stays a real button —
    // this must not become "the row has no controls at all".
    const rows = read('components', 'lists', 'ListItemRows.tsx');
    const wordRow = rows.slice(rows.indexOf('export function WordItemRow'));

    expect(wordRow).not.toContain('onPress={onPress}');
    expect(wordRow).toContain('<View style={s.wordRow}>');
    expect(wordRow).toContain('onPress={onToggleFavourite}');
  });

  it('drops the copy it was the only user of', () => {
    // Left behind, the `notebook` block would be six strings per locale that
    // no screen renders and every future translator still has to translate.
    // Its siblings under `vocabulary` stay — VocabularyScreen, the learned
    // list and the word deck all read them.
    const en = JSON.parse(read('i18n', 'locales', 'en', 'vocabulary.json'));
    expect(en.notebook).toBeUndefined();
    expect(en.learned).toBeDefined();
    expect(en.savedWords).toBeDefined();
  });
});
