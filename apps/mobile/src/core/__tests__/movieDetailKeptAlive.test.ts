/**
 * A tab detour must not rebuild the film you left open.
 *
 * Tabs remember the screen they were on (`core/tabMemory`), and the movie
 * detail is the one deep screen a tab tap comes back to. It was rendered by
 * the deep-screen ternary, though, which unmounts whatever it is not
 * currently showing — so the two-second trip to Practice threw the whole
 * screen away and coming back re-read the offline cache, re-ran the sentence
 * batch and rebuilt the deck from the bookmark. What the user saw was the film
 * blink and its cards refill.
 *
 * The splash skip (`splashResume.test.ts`) covered the *ceremony* of that
 * remount. This covers the remount itself: the film now lives on its own
 * layer, hidden rather than unmounted, exactly as the tab screens do.
 *
 * Source-reading, because there is no component-render library in this suite
 * by project rule — the same shape as `splashResume.test.ts` next door.
 */

import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', '..');
const app = () => fs.readFileSync(path.join(SRC, 'core', 'App.tsx'), 'utf8');
const host = () =>
  fs.readFileSync(path.join(SRC, 'components', 'common', 'SwipeBackView.tsx'), 'utf8');

describe('the open film is mounted once and kept', () => {
  it('is out of the deep-screen ternary', () => {
    // The ternary's contract is "render exactly the current screen"; anything
    // left in it is unmounted the moment `currentScreen` moves on. A film put
    // back into it would silently reintroduce the refetch.
    expect(app()).not.toMatch(/currentScreen === 'movieDetail' && selectedMovie \?/);
  });

  it('renders on a host that is told when to stand down', () => {
    // `showing` is the whole mechanism: without it the host reads emptiness off
    // its children, and a child kept alive on purpose is never empty — so the
    // layer would sit over the live tab and swallow every tap.
    expect(app()).toMatch(
      /showing=\{currentScreen === 'movieDetail' && !!selectedMovie\}/,
    );
  });

  it('keys the screen on the film', () => {
    // Props change on a mounted component without its mount-time fetch running
    // again. Without the key, opening a second film would show the first one's
    // vocabulary — the exact failure mode keeping it alive creates.
    expect(app()).toMatch(/<MovieDetailScreen\s*\n\s*key=\{selectedMovie\.id\}/);
  });

  it('unmounts the layer when no film is selected', () => {
    // `selectedMovie` is the lifetime. A film the user backed out of has to be
    // gone rather than hidden, or the next visit resumes a screen they closed.
    expect(app()).toMatch(/\{selectedMovie \? \(\s*\n\s*<MovieDetailScreen/);
  });

  it('clears the film on every way back out of it', () => {
    // Both branches of Back, not just the one that happens to call
    // `navigateToFilms`. The hub branch used to leave `selectedMovie` set,
    // which was harmless while the screen was unmounted anyway and is not any
    // more.
    const back = app().match(/const handleMovieDetailBack = \(\) => \{[\s\S]*?\n  \};/);
    expect(back).not.toBeNull();
    expect(back![0]).toMatch(/setSelectedMovie\(null\)/);
    expect(back![0]).toMatch(/navigateToFilms\(\)/);
  });

  it('still routes its Back through the one resolver', () => {
    // Chevron, Android hardware back and the edge swipe all answer to
    // `resolveBack`. A second host is a second chance for them to disagree.
    expect(app()).toMatch(
      /onBack=\{currentScreen === 'movieDetail' \? resolveBack\('movieDetail'\) : null\}/,
    );
  });
});

describe('SwipeBackView stands down without unmounting', () => {
  it('takes an explicit `showing`, defaulting to the old reading', () => {
    // Defaulting matters: the deep-screen host does not pass it, and must keep
    // behaving exactly as it did.
    const s = host();
    expect(s).toMatch(/showing\?: boolean;/);
    expect(s).toMatch(/const empty = showing != null \? !showing : children == null;/);
  });

  it('unmounts when there is genuinely nothing to keep', () => {
    // A host holding nothing should leave the tree, as it always has — an
    // inert full-screen View over the tab layer is what `empty` exists to
    // avoid.
    expect(host()).toMatch(/if \(children == null\) return null;/);
  });

  it('renders ONE tree, styled two ways', () => {
    // The regression this file was written for and then shipped anyway. React
    // reconciles by position and type: a hidden branch that returned
    // `<View>{children}</View>` while the shown branch returned
    // `<View><Animated.View>{children}</Animated.View></View>` puts the screen
    // at a different depth in the two, so every toggle unmounts and remounts
    // it — a "kept-alive" screen that quietly rebuilds from scratch, which
    // looks identical to a working one and is the whole bug.
    const body = host().slice(host().indexOf('if (children == null) return null;'));
    expect(body.match(/return \(/g) ?? []).toHaveLength(1);
    expect(body).toMatch(/style=\{empty \? styles\.hidden : styles\.fill\}/);
    expect(body).toMatch(/pointerEvents=\{empty \? 'none' : 'auto'\}/);
  });

  it('hides with display:none, which is out of layout and out of hit testing', () => {
    // These siblings are flex children of one column, not overlays. A hidden
    // host that still took part in layout would halve the height of the tab
    // showing through.
    expect(host()).toMatch(/hidden: \{ display: 'none' \}/);
  });

  it('keeps the native views alive while hidden', () => {
    // The point of not unmounting is the state inside — including the scroll
    // offset of the film's ScrollView, which only survives if the native view
    // is not collapsed away.
    expect(host()).toMatch(/collapsable=\{false\}/);
  });
});
