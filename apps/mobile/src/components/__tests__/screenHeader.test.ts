/**
 * The back-arrow bar is one component, not six.
 *
 * It used to be six hand-rolled copies and they had quietly diverged: a 16pt
 * bold title in three screens and an 18pt semibold one in two others, a back
 * link that was `primaryOnSurface` here, `primary` there, and a frozen purple
 * hex somewhere else. Nothing failed. Every copy rendered a perfectly good
 * header — just not the same one, which you only notice by walking between two
 * screens, which is what the user did.
 *
 * A render test cannot catch that (no component render library here, on
 * purpose) but the source can: a screen that takes an `onBack` should be
 * getting its bar from `ScreenHeader` rather than assembling another one.
 */

import fs from 'fs';
import path from 'path';

const COMPONENTS = path.join(__dirname, '..');

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') tsxFiles(full, out);
    } else if (/\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

const read = (f: string) => fs.readFileSync(f, 'utf8');
const rel = (f: string) => path.relative(COMPONENTS, f);

/**
 * Screens converted to the shared header. Deliberately a list rather than
 * "every file with a back button": several older screens still hand-roll
 * theirs and converting them all was not this change's job. The list is what
 * stops the converted ones sliding back.
 */
const CONVERTED = [
  path.join('AdminScreen.tsx'),
  path.join('screens', 'SettingsScreen.tsx'),
];

describe('ScreenHeader', () => {
  it('delegates the back control to the shared BackButton', () => {
    // The header used to draw the arrow itself, as `BACK_ARROW` plus a label
    // naming the previous screen. That is now BackButton — the circular
    // chevron chip the film detail screen already used — so there is exactly
    // one back affordance in the app instead of three.
    const src = read(path.join(COMPONENTS, 'common', 'ScreenHeader.tsx'));
    expect(src).toMatch(/<BackButton/);
    expect(src).not.toMatch(/BACK_ARROW/);
  });

  it('BackButton is a fixed-size chip, not a text link', () => {
    // A text label changed width with the locale, which is why the title was
    // never quite centred and why the RTL builds wrapped it.
    const src = read(path.join(COMPONENTS, 'common', 'BackButton.tsx'));
    expect(src).toMatch(/BACK_BUTTON_SIZE/);
    expect(src).toMatch(/chevron-back/);
    // Direction is resolved, not hard-coded: "back" points the other way in RTL.
    expect(src).toMatch(/directionalIcon/);
  });

  it.each(CONVERTED)('%s renders ScreenHeader', (f) => {
    const src = read(path.join(COMPONENTS, f));
    expect(src).toMatch(/<ScreenHeader/);
  });

  it.each(CONVERTED)('%s no longer hand-rolls a back link', (f) => {
    // The giveaway is a raw BACK_ARROW outside the shared component.
    expect(read(path.join(COMPONENTS, f))).not.toMatch(/BACK_ARROW/);
  });

  it('is the only place the back arrow is styled into a header bar', () => {
    // Any *new* screen that pairs BACK_ARROW with its own headerTitle style is
    // starting copy number seven. Existing offenders are listed so the guard
    // fails on additions rather than on history.
    const KNOWN_UNCONVERTED = [
      'NotebookScreen.tsx',
      'StatsScreen.tsx',
      'AchievementsScreen.tsx',
      'FamilyPlanScreen.tsx',
      'SavedMoviesScreen.tsx',
      'LeaderboardScreen.tsx',
      path.join('screens', 'WatchedScreen.tsx'),
      path.join('screens', 'LearnedWordsScreen.tsx'),
      path.join('screens', 'VocabularyScreen.tsx'),
    ];
    const offenders = tsxFiles(COMPONENTS)
      .filter((f) => {
        const src = read(f);
        return /BACK_ARROW/.test(src) && /headerTitle/.test(src);
      })
      .map(rel)
      .filter((f) => !KNOWN_UNCONVERTED.includes(f))
      .sort();

    expect(offenders).toEqual([]);
  });
});
