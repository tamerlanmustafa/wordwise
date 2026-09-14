/**
 * The interface language follows the translation language — as documented.
 *
 * ## The bug
 *
 * The "App language" section was removed from Settings deliberately (a68f254),
 * on the stated understanding that the i18n module's
 * follow-the-translation-language resolution would take over. It never did.
 *
 * `resolveAppLanguage` ranks the account's `language_preference` **above** the
 * translation language, and signup writes that column from whatever the device
 * locale happened to be (`LoginScreen` sends `language_preference:
 * getAppLanguage()`). Nothing ever cleared it: `setAppLanguage(persist)` and
 * `clearExplicitAppLanguage` had zero production call sites — they existed for
 * a control that no longer shipped.
 *
 * So the interface was frozen at signup and the one remaining language picker
 * could not move it. Measured on the test account: `native_language: es`,
 * `language_preference: en` — Spanish translations, English interface, no
 * control anywhere. Six locales that most accounts could never reach.
 *
 * The fix is in `SettingsScreen.handleSelectNativeLanguage`: clearing the pin
 * rather than re-setting it, so the documented behaviour becomes the real one.
 * These pin the resolution rules that make that fix correct.
 */

import fs from 'fs';
import path from 'path';

import { resolveAppLanguage } from '../index';

describe('the resolution order that made the pin sticky', () => {
  it('a stored pin beats everything', () => {
    expect(
      resolveAppLanguage({ stored: 'ru', server: 'en', translationLanguage: 'ES', device: 'tr' }),
    ).toBe('ru');
  });

  it('the account pin beats the translation language', () => {
    // The rule that broke it. Signup writes `server`, so once set it outranks
    // the picker forever — the exact state the test account was in.
    expect(
      resolveAppLanguage({ stored: null, server: 'en', translationLanguage: 'ES', device: 'tr' }),
    ).toBe('en');
  });

  it('the translation language wins once nothing is pinned', () => {
    // What the Settings picker now produces, by clearing both copies of the
    // pin in the same action.
    expect(
      resolveAppLanguage({ stored: null, server: null, translationLanguage: 'ES', device: 'tr' }),
    ).toBe('es');
  });

  it('falls back to the device, then to English', () => {
    expect(
      resolveAppLanguage({ stored: null, server: null, translationLanguage: null, device: 'tr' }),
    ).toBe('tr');
    expect(
      resolveAppLanguage({ stored: null, server: null, translationLanguage: null, device: null }),
    ).toBe('en');
  });

  it('ignores a language we do not ship at every level', () => {
    // A pin naming a locale with no bundle must fall through rather than
    // render an interface of raw keys.
    expect(
      resolveAppLanguage({ stored: 'ja', server: null, translationLanguage: 'ES', device: null }),
    ).toBe('es');
  });
});

describe('the Settings picker clears the pin rather than moving it', () => {
  const read = () =>
    fs
      .readFileSync(
        path.join(__dirname, '..', '..', 'components', 'screens', 'SettingsScreen.tsx'),
        'utf8',
      )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('clears the account copy in the same PATCH as the language', () => {
    // Same request, deliberately: two would let one land and the other fail,
    // leaving the columns disagreeing again — which is the state this whole
    // screen exists to prevent.
    const src = read();
    expect(src).toMatch(/native_language:[^,]+,\s*language_preference:\s*''/);
  });

  it('clears the device copy too', () => {
    // One preference stored twice. Clearing only the account copy lets the
    // local one restore it on the next launch.
    expect(read()).toContain('clearExplicitAppLanguage(');
  });
});
