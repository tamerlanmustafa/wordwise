/**
 * A screen that is never unmounted must not re-render for navigation it has
 * nothing to do with.
 *
 * The four tab screens live under `KeepAlive` for the whole session, so they
 * are children of App on every render — and App re-renders on every
 * `setCurrentScreen` anywhere in the app. Measured on the simulator before this
 * was fixed: backing out of a *list* re-rendered the *film feed*, and backing
 * out of a film re-rendered the film feed twice, the second time 106ms after
 * the swipe animation had already finished. That late, isolated second render
 * is what the user reported as the feed "glitching" right after the gesture.
 *
 * `memo` is the fix, but it is only as good as the props: a handler rebuilt on
 * every App render makes the comparison fail every time and the memo becomes a
 * no-op that looks like it is working. So both halves are guarded here — the
 * wrapper and the stable callbacks it depends on.
 *
 * Source-reading, because there is no component-render library in this suite by
 * project rule — the same shape as `movieDetailKeptAlive.test.ts` next door.
 */

import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(SRC, ...p), 'utf8');
const app = () => read('core', 'App.tsx');

describe('the kept-alive tab screens are memoized', () => {
  const screens: [string, string[]][] = [
    ['FilmFeedScreen', ['components', 'screens', 'FilmFeedScreen.tsx']],
    ['ListsIndexScreen', ['components', 'screens', 'ListsIndexScreen.tsx']],
    ['WordFeedScreen', ['components', 'WordFeedScreen.tsx']],
    ['PracticeScreen', ['components', 'PracticeScreen.tsx']],
  ];

  it.each(screens)('%s is exported through memo', (name, file) => {
    const src = read(...file);
    // Either shape is fine — `memo(Inner)` or `memo((props) => …)` — but the
    // export the app imports has to be the memoized one, not the raw function.
    const memoized =
      new RegExp(`export const ${name} = (React\\.)?memo\\(`).test(src);
    expect(memoized).toBe(true);
  });

  it.each(screens)('%s does not also export the bare component', (name, file) => {
    // A second, unmemoized export is how this regresses silently: App keeps
    // importing the same name, someone "fixes an import" and the memo is gone.
    const src = read(...file);
    expect(src).not.toMatch(new RegExp(`export function ${name}\\b`));
  });
});

describe('the handlers those screens receive are stable', () => {
  // Without these the memo compares a fresh function every render and never
  // holds. They close over nothing but state setters, which is what makes an
  // empty dependency array honest rather than a lie that hides a stale value.
  it.each([['navigateToMovie'], ['navigateToReview'], ['navigateToListDetail']])(
    '%s is wrapped in useCallback',
    (fn) => {
      expect(app()).toMatch(new RegExp(`const ${fn} = useCallback\\(`));
    },
  );

  it('passes only those stable handlers to the kept-alive screens', () => {
    // The prop wiring is the part that actually has to line up; a useCallback
    // nobody passes is decoration.
    const s = app();
    expect(s).toMatch(/<FilmFeedScreen onMoviePress=\{navigateToMovie\}/);
    expect(s).toMatch(/onOpenList=\{navigateToListDetail\}/);
    expect(s).toMatch(/onStartDailyReview=\{navigateToReview\}/);
  });
});
