/**
 * A list is a collection, not a deck. Practice lives on the Practice tab.
 *
 * `ListDetailScreen` used to put a gold button at the top of an open list that
 * started an SRS session scoped to it. Films lists lost their version first —
 * pooling the vocabulary of a whole watchlist into one deck reads as an
 * obvious feature and is not one, because the place you practise a film's
 * words is that film — and words lists have now followed, by decision: one
 * deck, in one place, crediting one streak.
 *
 * This replaces `filmsListHasNoPractice.test.ts`, which guarded the half-way
 * state and asserted the words button still existed. Kept as a guard rather
 * than deleted outright because the removal spans a screen, a handler in App,
 * an API client method and six locale files, and a partial restoration —
 * someone re-adding the button without the endpoint, or the string without the
 * button — is the likely way it comes back.
 *
 * Source-reading, like the rest of this folder: mobile tests carry no render
 * library on purpose (see `mobile-test-conventions`).
 */

import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(SRC, ...p), 'utf8');
const screen = () => read('components', 'screens', 'ListDetailScreen.tsx');
const locale = (lang: string) =>
  JSON.parse(read('i18n', 'locales', lang, 'lists.json')) as {
    practice?: Record<string, string>;
  };

const LANGS = fs
  .readdirSync(path.join(SRC, 'i18n', 'locales'))
  .filter((d) => fs.existsSync(path.join(SRC, 'i18n', 'locales', d, 'lists.json')));

describe('no list offers a practice session', () => {
  it('has no practice button, for either kind of list', () => {
    const s = screen();
    expect(s).not.toMatch(/startPractice/);
    expect(s).not.toMatch(/practiceBtn/);
    expect(s).not.toMatch(/practiceLabel/);
  });

  it('does not reach for the session API from a list', () => {
    // The screen was the only caller of `listsApi.practice`, so the method
    // went with it. If this fails, the button came back.
    expect(screen()).not.toMatch(/listsApi/);
    expect(read('services', 'api.ts')).not.toMatch(/\/lists\/\$\{id\}\/practice/);
  });

  it('leaves the strings in no locale, so nothing can quietly reach for one', () => {
    // Six locales. A key removed from `en` alone is a key that comes back the
    // next time someone syncs translations from a file that still has it.
    expect(LANGS.length).toBeGreaterThanOrEqual(5);
    for (const lang of LANGS) {
      expect(locale(lang).practice).toBeUndefined();
    }
  });

  it('puts the sort control on the trailing edge, where it is now alone', () => {
    // The action row has one control in it. Without this the row's only button
    // jumps to the leading edge, which reads as a layout bug rather than as a
    // row with less in it.
    const s = screen();
    const style = s.slice(s.indexOf('  actionRow: {'));
    expect(style.slice(0, style.indexOf('},'))).toMatch(/justifyContent: 'flex-end'/);
  });
});

describe('App stops carrying the list-session plumbing', () => {
  const app = () => read('core', 'App.tsx');

  it('has no handler for a list-started session', () => {
    expect(app()).not.toMatch(/handleListPractice/);
  });

  it('hands ReviewScreen nothing to scope a session with', () => {
    // `kind`, `listId` and `initialSession` were only ever filled in by the
    // Lists tab. ReviewScreen still ACCEPTS them — they carry the rule that a
    // list session must not credit the streak — so this guards the caller,
    // not the screen: nothing should be passing them again.
    const s = app();
    expect(s).not.toMatch(/reviewLaunch/);
    expect(s).not.toMatch(/initialSession=\{/);
  });

  it('still leaves a review the same way it always did', () => {
    // The exit used to branch on whether a list started the session. With one
    // origin left the branch is gone, but the guard must not be.
    expect(app()).toMatch(/guardQuizExit\(quizExitCopy, navigateToPractice\)/);
  });
});
