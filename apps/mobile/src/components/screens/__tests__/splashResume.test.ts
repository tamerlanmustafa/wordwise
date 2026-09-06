/**
 * The wordmark plays when you open a film, and not when you come back to one.
 *
 * The splash masks a cold vocabulary fetch and sets the tone on the way in. It
 * earns that second on a first open. It does not earn it again on the way back
 * from a tab detour, where the data is already in the offline cache and the
 * screen is ready in well under 100ms — there the animation is a second of
 * ceremony in front of a screen that has nothing left to wait for.
 *
 * This became reachable the moment tabs started remembering their screens
 * (`core/tabMemory`): MovieDetail is not in the KeepAlive layer, so returning
 * to it is a genuine remount, and every mount-time animation fires again.
 *
 * No component-render library in this suite by project rule, so this pins the
 * source contract: the holds start cleared on a resume, and App marks its
 * entry points honestly.
 */

import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', '..', '..');
const screen = () =>
  fs.readFileSync(path.join(SRC, 'components', 'screens', 'MovieDetailScreen.tsx'), 'utf8');
const app = () => fs.readFileSync(path.join(SRC, 'core', 'App.tsx'), 'utf8');

describe('MovieDetailScreen skips the splash on a resume', () => {
  it('takes a `resumed` prop that defaults to off', () => {
    // The default is the load-bearing half: a navigation path added later and
    // not thought about keeps today's behaviour rather than silently dropping
    // the animation from a genuine first open.
    const s = screen();
    expect(s).toMatch(/resumed\?: boolean;/);
    expect(s).toMatch(/resumed = false,/);
  });

  it('starts every splash hold cleared rather than hiding it in the render', () => {
    // Hiding it would still run the pulse loop and the door animation behind
    // a screen nobody can see — two animations a frame budget does not need
    // during the one moment the list is being built.
    const s = screen();
    expect(s).toMatch(/useState\(resumed\)/);
    expect(s).toMatch(/useState\(!resumed\)/);
    expect(s).toMatch(/useRef\(resumed\)/);
  });

  it('does not start the minimum-hold timer on a resume', () => {
    // That timer exists so a fast cache hit cannot flash the wordmark. With no
    // wordmark there is nothing to flash, and it would clear a hold that is
    // already clear.
    expect(screen()).toMatch(/if \(resumed\) return;\s*\n\s*const id = setTimeout/);
  });
});

describe('App marks openings and returns apart', () => {
  it('passes the flag to the screen', () => {
    expect(app()).toMatch(/resumed=\{movieDetailResumed\}/);
  });

  it('clears it wherever a film is chosen', () => {
    // Both fresh-open paths set `selectedMovie` first: the feed card, and the
    // reel preview hub's Study button. Choosing a film is the definition of a
    // first open, so the flag is cleared next to the choice, not far from it.
    //
    // Matched line-wise rather than with one regex across the call: the hub
    // passes `reelTileToMovieData(...)`, and a `[^)]*` argument pattern stops
    // at that inner bracket and quietly matches only one of the two.
    const opens = app()
      .split('\n')
      .filter((line, i, lines) => /setSelectedMovie\(/.test(line)
        && /setMovieDetailResumed\(false\)/.test(lines[i + 1] ?? ''));
    expect(opens).toHaveLength(2);
  });

  it('sets it on every way back into a film already open', () => {
    // The quiz-journey backs go through one helper so they cannot disagree,
    // and the tab-memory restore sets it inline because it is deciding a
    // target for any tab, not only this screen.
    const s = app();
    expect(s).toMatch(/const returnToMovieDetail = \(\) => \{\s*\n\s*setMovieDetailResumed\(true\);/);
    expect(s).toMatch(/if \(target === 'movieDetail'\) setMovieDetailResumed\(true\);/);
  });

  it('leaves no unmarked jump straight to the screen', () => {
    // An entry that never says which kind it is inherits whatever the last one
    // set, so the splash would depend on where the user had been earlier —
    // the least predictable behaviour available. Every jump must be preceded
    // by the flag, either value.
    //
    // Asserted as "each one is marked" rather than "there are N of them": a
    // count is a number to update every time a route is added, and updating it
    // is indistinguishable from noticing the new route is unmarked.
    const lines = app().split('\n');
    const unmarked = lines
      .map((line, i) => ({ line, prev: lines[i - 1] ?? '' }))
      .filter(({ line }) => /setCurrentScreen\('movieDetail'\)/.test(line))
      .filter(({ prev }) => !/setMovieDetailResumed\((true|false)\)/.test(prev));
    expect(unmarked).toEqual([]);
  });
});
