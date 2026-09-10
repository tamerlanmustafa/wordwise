/**
 * A lazily-mounted screen must not get its top inset from a native view.
 *
 * `SafeAreaView` (react-native-safe-area-context) applies its edge padding
 * during *native* layout, a frame or more after the JS render that created it.
 * On a screen that is already mounted nobody sees that — the padding was
 * applied long ago. But the tab screens are mounted lazily by `KeepAlive`, so
 * the first tap on a tab after a cold start is the one time that screen is laid
 * out from scratch, and it paints once with zero top padding: tucked under the
 * status bar, search bar drawn over the clock, then snapping down.
 *
 * Measured on an iPhone 17 Pro simulator (top inset 62pt), first tap on
 * Explore after a cold start:
 *
 *     before   +158ms over the clock, +291ms still over it, +423ms corrected
 *     after    +148ms already correct
 *
 * The reason it is worth a guard rather than a comment: it is invisible on
 * every subsequent tap, invisible in any test that renders the screen already
 * mounted, and invisible to whoever adds the next tab screen by copying the
 * shape of an existing one. `SafeAreaView` is also the *obvious* thing to
 * reach for, which is exactly why it comes back.
 *
 * Source-reading, because there is no component-render library in this suite by
 * project rule.
 */

import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

/** The screens App mounts lazily through `KeepAlive`. */
const LAZY_TAB_SCREENS: [string, string[]][] = [
  ['FilmFeedScreen', ['components', 'screens', 'FilmFeedScreen.tsx']],
  ['PracticeScreen', ['components', 'PracticeScreen.tsx']],
  ['ListsIndexScreen', ['components', 'screens', 'ListsIndexScreen.tsx']],
  ['WordFeedScreen', ['components', 'WordFeedScreen.tsx']],
];

describe('lazily-mounted tab screens pad in the same commit as their content', () => {
  it.each(LAZY_TAB_SCREENS)('%s does not use SafeAreaView for the top edge', (_name, file) => {
    const src = read(...file);
    expect(src).not.toMatch(/<SafeAreaView[^>]*edges=\{\[\s*'top'/);
  });

  it.each(LAZY_TAB_SCREENS)('%s gets its top inset from the JS hook', (_name, file) => {
    // Either directly via `useSafeAreaInsets` (WordFeedScreen does the maths
    // itself for its card geometry) or through the shared component, which is
    // the same hook with the padding already applied.
    const src = read(...file);
    const viaHook = /useSafeAreaInsets\(\)/.test(src);
    const viaComponent = /<TopInsetView/.test(src);
    expect(viaHook || viaComponent).toBe(true);
  });
});

describe('TopInsetView', () => {
  const src = () => read('components', 'common', 'TopInsetView.tsx');

  it('reads the inset from context rather than measuring natively', () => {
    // The whole fix. `useSafeAreaInsets` was verified by logging to return the
    // correct 62 on the very FIRST render — which is what ruled out "the
    // provider has not measured yet" and left the native view's own layout
    // pass as the only remaining explanation.
    expect(src()).toMatch(/useSafeAreaInsets\(\)/);
  });

  it('applies it as an ordinary style on a plain View', () => {
    // A plain View means the padding is part of the same commit as the
    // children. Anything that defers it to native layout reintroduces the bug.
    expect(src()).toMatch(/paddingTop: insets\.top/);
    // Deliberately no "does not contain SafeAreaView" assertion here: this
    // file's docblock quotes the JSX it replaces, so a text scan would fail on
    // the explanation rather than on a mistake. The screens are where that
    // guard belongs, and it is in the describe block above.
    expect(src()).toMatch(/<View style=/);
  });

  it('puts the caller style first, so the inset cannot be overridden by it', () => {
    // `[style, { paddingTop }]` and not the reverse: a screen root that happens
    // to set its own paddingTop would otherwise silently win and put the
    // content back under the status bar.
    expect(src()).toMatch(/\[style, \{ paddingTop: insets\.top \}\]/);
  });
});
