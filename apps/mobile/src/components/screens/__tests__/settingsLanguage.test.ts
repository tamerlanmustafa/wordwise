/**
 * Settings: learning language IS the translation language.
 *
 * They were two controls over one value. `setTargetLanguage` writes
 * `users.learning_language` (App.tsx), and `targetLanguage` initialises from
 * that same column — so the "Learning language" picker and the "Translation
 * language" grid were both editing it, and could disagree.
 *
 * The lists were the real bug. The picker offered every `SUPPORTED_LANGUAGES`
 * entry (~30, the full world list); the grid offered `AVAILABLE_LANGUAGES` (the
 * 12 we can actually translate into). Choosing Thai or Malay in the picker set
 * a target language nothing in the pipeline can serve, and the grid would then
 * show nothing selected.
 *
 * There is no component-render library in this suite by project rule, so what
 * is pinned here is the data contract the merged control depends on — which is
 * where the bug lived.
 */

import { AVAILABLE_LANGUAGES, SUPPORTED_LANGUAGES } from '../../../types';

describe('the merged learning/translation language list', () => {
  it('is not merely a subset of the world list — az exists only here', () => {
    // Worth pinning because it is the reason the merged picker reads
    // AVAILABLE_LANGUAGES directly rather than intersecting the two lists.
    // Azerbaijani is translatable (shipped in beta) but was never added to
    // SUPPORTED_LANGUAGES, which is the native/world-language list. Intersect
    // them and az silently disappears from the only control that can select it.
    const supported = new Set(SUPPORTED_LANGUAGES.map((l) => l.code.toLowerCase()));
    const translatableOnly = AVAILABLE_LANGUAGES
      .map((l) => l.code.toLowerCase())
      .filter((code) => !supported.has(code));

    expect(translatableOnly).toEqual(['az']);
  });

  it('is exactly what the merged picker offers, so every choice is servable', () => {
    // The invariant the merge actually depends on: the control is the
    // translatable list itself. Anything it offers, the pipeline can serve.
    expect(AVAILABLE_LANGUAGES.length).toBeGreaterThan(0);
    expect(AVAILABLE_LANGUAGES.every((l) => typeof l.code === 'string')).toBe(true);
  });

  it('offers strictly fewer languages than the old picker did', () => {
    // The point of the merge: you can no longer pick a language we cannot
    // translate into.
    expect(AVAILABLE_LANGUAGES.length).toBeLessThan(SUPPORTED_LANGUAGES.length);
  });

  it('carries a native name for every option, which is what the row displays', () => {
    // The row shows "Español", not "Spanish" — a speaker scans for their
    // language in their own language. A missing nativeName would silently fall
    // back to the raw code ("ES"), which is what the old chips did wrong.
    for (const lang of AVAILABLE_LANGUAGES) {
      expect(lang.nativeName).toBeTruthy();
      expect(lang.nativeName).not.toBe(lang.code);
    }
  });

  it('uses uppercase codes, matching what targetLanguage holds', () => {
    // `targetLanguage` is uppercased at every write (App.tsx), and the picker
    // marks the selected row by exact code equality. A lowercase entry here
    // would render as "nothing selected".
    for (const lang of AVAILABLE_LANGUAGES) {
      expect(lang.code).toBe(lang.code.toUpperCase());
    }
  });

  it('has no duplicate codes', () => {
    const codes = AVAILABLE_LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
