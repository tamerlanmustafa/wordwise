/**
 * A list of films is a watchlist, not a deck.
 *
 * `ListDetailScreen` used to put a gold "Practice words from these films"
 * button at the top of a films list, which pooled the vocabulary of everything
 * in it into one session. It reads as an obvious feature and is not one: the
 * place you practise a film's words is that film, where the deck is scoped to
 * the thing you are about to watch and the words arrive with the sentences
 * they came from. Pooled across a watchlist they are just words.
 *
 * Removed rather than hidden, and this is the guard — because the button is
 * still there for words lists, so the branch that tells them apart is one
 * `isFilms` away from coming back by accident.
 *
 * Source-reading, like the rest of this folder: mobile tests carry no render
 * library on purpose (see `mobile-test-conventions`).
 */

import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', '..', '..');
const screen = () =>
  fs.readFileSync(path.join(SRC, 'components', 'screens', 'ListDetailScreen.tsx'), 'utf8');
const locale = (lang: string) =>
  JSON.parse(
    fs.readFileSync(path.join(SRC, 'i18n', 'locales', lang, 'lists.json'), 'utf8'),
  ) as { practice?: Record<string, string> };

const LANGS = fs
  .readdirSync(path.join(SRC, 'i18n', 'locales'))
  .filter((d) => fs.existsSync(path.join(SRC, 'i18n', 'locales', d, 'lists.json')));

describe('a films list offers no practice session', () => {
  it('gates the practice button on the list not being films', () => {
    expect(screen()).toMatch(/\{isFilms \? null : \(\s*\n\s*<TouchableOpacity/);
  });

  it('no longer asks for a films-specific label', () => {
    // The label was the only thing that made the films branch look deliberate.
    expect(screen()).not.toMatch(/practice\.films/);
  });

  it('leaves the string in no locale, so nothing can quietly reach for it', () => {
    // Six locales. A key removed from `en` alone is a key that comes back the
    // next time someone syncs translations from a file that still has it.
    expect(LANGS.length).toBeGreaterThanOrEqual(5);
    for (const lang of LANGS) {
      expect(locale(lang).practice ?? {}).not.toHaveProperty('films');
    }
  });

  it('keeps the button for words lists', () => {
    // The other half. Deleting the feature outright would have taken the one
    // list kind it was always right for.
    const s = screen();
    expect(s).toMatch(/practice\.none/);
    expect(s).toMatch(/onPress=\{startPractice\}/);
  });

  it('puts the sort control on the trailing edge, where it is now alone', () => {
    // On a films list the action row has one control in it. Without this the
    // row's only button jumps to the leading edge, which reads as a layout
    // bug rather than as a row with less in it.
    const s = screen();
    const style = s.slice(s.indexOf('  actionRow: {'));
    expect(style.slice(0, style.indexOf('},'))).toMatch(/justifyContent: 'flex-end'/);
  });
});
