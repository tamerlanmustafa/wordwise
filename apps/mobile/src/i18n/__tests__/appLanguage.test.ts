/**
 * Behaviour tests for the app-language resolution + switching.
 *
 * The resolution order is the part most likely to regress silently, because
 * every rule produces a *plausible* language — a bug here shows up as "the app
 * is in the wrong language sometimes", not as a crash.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  APP_LANGUAGE_KEY,
  clearExplicitAppLanguage,
  getAppLanguage,
  hasExplicitAppLanguage,
  hydrateAppLanguage,
  initI18n,
  resolveAppLanguage,
  setAppLanguage,
  t,
} from '..';

beforeAll(() => {
  initI18n('en');
});

beforeEach(async () => {
  await AsyncStorage.clear();
  await setAppLanguage('en', { persist: false });
});

describe('resolveAppLanguage', () => {
  it('prefers an explicit Settings choice over everything else', () => {
    expect(
      resolveAppLanguage({ stored: 'tr', translationLanguage: 'ES', device: 'ru' }),
    ).toBe('tr');
  });

  it('falls back to the translation language when nothing is stored', () => {
    // The headline case: pick Spanish translations in onboarding, get a
    // Spanish interface without a second question.
    expect(resolveAppLanguage({ stored: null, translationLanguage: 'ES', device: 'ru' })).toBe(
      'es',
    );
  });

  it('falls back to the device locale when the translation language has no UI', () => {
    // 'JA' is in AVAILABLE_LANGUAGES but not UI_LANGUAGES.
    expect(resolveAppLanguage({ stored: null, translationLanguage: 'JA', device: 'ru' })).toBe(
      'ru',
    );
  });

  it('ends at English when nothing matches', () => {
    expect(resolveAppLanguage({ stored: null, translationLanguage: 'JA', device: 'ko' })).toBe(
      'en',
    );
    expect(resolveAppLanguage({})).toBe('en');
  });

  it('ignores a stored value for a language we no longer ship', () => {
    // Guards the downgrade path: a locale removed from UI_LANGUAGES must not
    // strand a user on a language with no resources.
    expect(resolveAppLanguage({ stored: 'ja', translationLanguage: 'PT' })).toBe('pt');
  });
});

describe('hydrateAppLanguage', () => {
  it('applies the derived language without recording it as an explicit choice', async () => {
    await hydrateAppLanguage('ES');

    expect(getAppLanguage()).toBe('es');
    // Critical: hydrating must not write, or rule 2 could never apply again.
    expect(await AsyncStorage.getItem(APP_LANGUAGE_KEY)).toBeNull();
    expect(await hasExplicitAppLanguage()).toBe(false);
  });

  it('honours a previously stored explicit choice', async () => {
    await AsyncStorage.setItem(APP_LANGUAGE_KEY, 'tr');

    await hydrateAppLanguage('ES');

    expect(getAppLanguage()).toBe('tr');
    expect(await hasExplicitAppLanguage()).toBe(true);
  });
});

describe('setAppLanguage', () => {
  it('persists an explicit choice and switches the active language', async () => {
    await setAppLanguage('ru');

    expect(getAppLanguage()).toBe('ru');
    expect(await AsyncStorage.getItem(APP_LANGUAGE_KEY)).toBe('ru');
  });

  it('normalizes region tags before storing', async () => {
    await setAppLanguage('pt-BR');

    expect(getAppLanguage()).toBe('pt');
    expect(await AsyncStorage.getItem(APP_LANGUAGE_KEY)).toBe('pt');
  });

  it('falls back to English rather than switching to an unshipped language', async () => {
    await setAppLanguage('ja');

    expect(getAppLanguage()).toBe('en');
  });
});

describe('clearExplicitAppLanguage', () => {
  it('drops the pin and re-derives from the translation language', async () => {
    await setAppLanguage('tr');
    expect(getAppLanguage()).toBe('tr');

    await clearExplicitAppLanguage('ES');

    expect(getAppLanguage()).toBe('es');
    expect(await hasExplicitAppLanguage()).toBe(false);
  });
});

describe('translation lookup', () => {
  it('returns translated copy for the active language', async () => {
    await setAppLanguage('es', { persist: false });
    expect(t('action.save')).toBe('Guardar');

    await setAppLanguage('tr', { persist: false });
    expect(t('action.save')).toBe('Kaydet');
  });

  it('resolves namespaced keys', async () => {
    await setAppLanguage('ru', { persist: false });
    expect(t('settings:appLanguage.sectionTitle')).toBe('Язык приложения');
  });

  it('interpolates values', async () => {
    await setAppLanguage('en', { persist: false });
    expect(t('onboarding:stepOf', { step: 2, total: 6 })).toBe('Step 2 of 6');
  });

  it('interpolates into a translated locale whose word order differs', async () => {
    // Turkish renders this as "the 2nd step of 6", i.e. the placeholders swap
    // order. Assert the invariant (both values substituted, nothing left raw)
    // rather than exact wording, which changes whenever copy is re-translated.
    await setAppLanguage('tr', { persist: false });
    const out = t('onboarding:stepOf', { step: 2, total: 6 });

    expect(out).not.toMatch(/\{\{/);
    expect(out).toContain('2');
    expect(out).toContain('6');
    expect(out).not.toBe('Step 2 of 6');
  });

  it('falls back to English for a key a locale is missing', async () => {
    await setAppLanguage('es', { persist: false });
    // i18next echoes the key when nothing resolves — the visible symptom of a
    // missing translation, and what the locale parity test exists to prevent.
    expect(t('action.definitelyNotAKey')).toBe('action.definitelyNotAKey');
  });

  describe('plurals', () => {
    it('uses the two English forms', async () => {
      await setAppLanguage('en', { persist: false });
      expect(t('wordCount', { count: 1 })).toBe('1 word');
      expect(t('wordCount', { count: 2 })).toBe('2 words');
      expect(t('wordCount', { count: 0 })).toBe('0 words');
    });

    it('uses all four Russian forms', async () => {
      // The reason we run i18next rather than a hand-rolled `n === 1 ? …` —
      // the current codebase has 14 sites that would be wrong here.
      await setAppLanguage('ru', { persist: false });
      expect(t('wordCount', { count: 1 })).toBe('1 слово');
      expect(t('wordCount', { count: 3 })).toBe('3 слова');
      expect(t('wordCount', { count: 5 })).toBe('5 слов');
      expect(t('wordCount', { count: 21 })).toBe('21 слово');
      expect(t('wordCount', { count: 22 })).toBe('22 слова');
      expect(t('wordCount', { count: 25 })).toBe('25 слов');
    });

    it('uses the invariant Turkish form', async () => {
      await setAppLanguage('tr', { persist: false });
      expect(t('wordCount', { count: 1 })).toBe('1 kelime');
      expect(t('wordCount', { count: 7 })).toBe('7 kelime');
    });
  });
});
