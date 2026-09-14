/**
 * Source guards for the open list's controls — each one a measured bug.
 *
 * All of these were reproduced on the simulator and against the server before
 * the fix, and none of them can be caught at runtime by the logic suite (there
 * is no component-render library here, by project rule):
 *
 *  1. On a list the user made, the trailing control was an EMPTY heart — which
 *     reads as "favourite this" — and its tap deleted the word from the list.
 *     Tapped on `goulash` in "Audit Travel": gone from the list on the server,
 *     still in Favourites, no confirmation, no undo, no way to add it back.
 *  2. The film's ✓ promised in a comment to become "an outlined plus, so the
 *     removal is reversible in place". It vanished instead.
 *  3. "⋯" went straight to "Delete this list?". Renaming existed in the store,
 *     the API and all six locales, and in no screen.
 *  4. A list opened offline showed its skeleton for 15s and counting.
 *  5. "List deleted" was announced before the server had answered.
 *  6. The index re-read only the reel row on focus, so Favourites read 7 while
 *     the server said 8.
 */

import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', '..', '..');

/** Source with comments removed — the fixes are described in comments right
 *  next to the code, and a guard that fires on its own explanation teaches
 *  people to stop explaining. */
const code = (...parts: string[]) =>
  fs
    .readFileSync(path.join(SRC, ...parts), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const DETAIL = ['components', 'screens', 'ListDetailScreen.tsx'];
const ROWS = ['components', 'lists', 'ListItemRows.tsx'];
const INDEX = ['components', 'screens', 'ListsIndexScreen.tsx'];

describe('1. a heart only where it means Favourites', () => {
  it('picks the control from the list, not a boolean every list shares', () => {
    expect(code(...DETAIL)).toMatch(
      /control=\{summary\.systemKey === 'favourites' \? 'favourite' : 'member'\}/,
    );
  });

  it('draws no empty heart at all', () => {
    // The lie itself: `filled={favourite}` on a list where favourite was false.
    const rows = code(...ROWS);
    expect(rows).not.toMatch(/filled=\{favourite\}/);
    expect(rows).not.toMatch(/onToggleFavourite/);
  });
});

describe('every removal on the open list can be undone', () => {
  it('removes through the undo path, never the immediate one', () => {
    const detail = code(...DETAIL);
    expect(detail).toContain('removeItemWithUndo(');
    expect(detail).not.toMatch(/\bremoveItem\(/);
  });

  it('offers Undo in the toast for exactly the undo window', () => {
    const detail = code(...DETAIL);
    expect(detail).toMatch(/actionLabel:\s*t\('delete\.undo'\)/);
    expect(detail).toMatch(/duration:\s*REMOVE_UNDO_MS/);
  });
});

describe('2. the film check says what it does', () => {
  it('no longer takes an `inList` flag it never varied', () => {
    expect(code(...DETAIL)).not.toMatch(/\binList\b/);
    expect(code(...ROWS)).not.toMatch(/inList \?/);
  });
});

describe('small controls on a pressable row', () => {
  it('pad both item controls out to a 44pt target', () => {
    const rows = code(...ROWS);
    expect(rows).toMatch(/hitSlop=\{hitSlopFor\(28\)\}/);
    expect(rows).toMatch(/hitSlop=\{hitSlopFor\(34\)\}/);
  });

  it('name them for VoiceOver, as their own buttons', () => {
    const rows = code(...ROWS);
    expect(rows).toMatch(/accessibilityLabel=\{label\}/);
    expect(rows).toMatch(/accessibilityLabel=\{t\('a11y\.unfavourite'/);
  });
});

describe('3. "⋯" opens options', () => {
  it('opens the actions sheet rather than the delete dialog', () => {
    const detail = code(...DETAIL);
    expect(detail).toMatch(/onPress=\{withTap\(\(\) => setActionsOpen\(true\)\)\}/);
    expect(detail).not.toMatch(/onPress=\{confirmDelete\}/);
  });

  it('offers rename, through the shared list sheet', () => {
    const detail = code(...DETAIL);
    expect(detail).toContain('<ListActionsSheet');
    expect(detail).toMatch(/<NewListSheet\s+mode="rename"/);
  });

  it('labels the glyph controls', () => {
    const detail = code(...DETAIL);
    expect(detail).toMatch(/accessibilityLabel=\{t\('a11y\.options'\)\}/);
    expect(detail).toMatch(/accessibilityLabel=\{t\('a11y\.sort'\)\}/);
  });
});

describe('4. a list that cannot load says so', () => {
  it('reads its own failure, and renders the error view instead of the skeleton', () => {
    const detail = code(...DETAIL);
    expect(detail).toContain('st.detailFailure[list.id]');
    expect(detail).toMatch(/!detail && failure \?\s*\(\s*<ConnectionError/);
    // "Loading" can no longer be simply "no page yet".
    expect(detail).toMatch(/const loading = !detail && !failure/);
  });
});

describe('5. "List deleted" only once it is', () => {
  it('announces the delete after destroy resolves, and only if it succeeded', () => {
    const detail = code(...DETAIL);
    expect(detail).toMatch(/destroy\(list\.id\)\.then\(\(deleted\)/);
    expect(detail).toMatch(/if \(!deleted\) return;/);
  });
});

describe('6. the index is re-read on focus', () => {
  it('refreshes everything, not just the reel row', () => {
    const index = code(...INDEX);
    expect(index).toMatch(/void fetchLists\(\)/);
    expect(index).not.toMatch(/void syncFromReel\(\)/);
  });
});
