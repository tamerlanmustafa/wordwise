/**
 * UI_LANGUAGES — the locales the *app chrome* is available in.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ADDING A LANGUAGE — the whole checklist:
 *
 *    1. Copy `locales/en/` → `locales/<code>/` and translate the values.
 *       (Keep the filenames and every key identical — the parity test in
 *        `__tests__/locales.test.ts` enforces this and fails on pre-push.)
 *    2. Add the resource import + entry in `resources.ts`.
 *    3. Add one row to UI_LANGUAGES below.
 *
 *  No component, picker, or store needs touching: Settings and onboarding
 *  both render straight from this list.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * NOT to be confused with the two lists in `types/constants.ts`:
 *   • AVAILABLE_LANGUAGES — languages we *translate words into* (12).
 *   • SUPPORTED_LANGUAGES — the inert native/learning profile fields (30).
 * UI_LANGUAGES is a subset of what AVAILABLE_LANGUAGES offers, because
 * translating vocabulary into a language is far cheaper than translating the
 * entire interface into it.
 */

export interface UiLanguage {
  /** BCP-47 base code, lowercase. Also the `locales/<code>/` directory name. */
  code: string;
  /** English name — used in search and as an accessibility label. */
  name: string;
  /** Endonym, shown as the primary label in pickers. */
  nativeName: string;
  /** Right-to-left script. Nothing in the app handles RTL layout yet, so no
   *  RTL locale may ship until that work is done — see I18N_PLAN.md §3. */
  rtl?: boolean;
}

export const UI_LANGUAGES: ReadonlyArray<UiLanguage> = [
  { code: 'en', name: 'English',    nativeName: 'English' },
  { code: 'es', name: 'Spanish',    nativeName: 'Español' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'tr', name: 'Turkish',    nativeName: 'Türkçe' },
  { code: 'ru', name: 'Russian',    nativeName: 'Русский' },
];

/** The locale every other one falls back to, key-by-key. */
export const FALLBACK_LANGUAGE = 'en';

export const UI_LANGUAGE_CODES: ReadonlyArray<string> = UI_LANGUAGES.map((l) => l.code);

export function isUiLanguage(code: string | null | undefined): boolean {
  return !!code && UI_LANGUAGE_CODES.includes(code.toLowerCase());
}

export function getUiLanguage(code: string | null | undefined): UiLanguage | undefined {
  if (!code) return undefined;
  return UI_LANGUAGES.find((l) => l.code === code.toLowerCase());
}

/**
 * Narrow an arbitrary locale tag to one we ship.
 *
 * Accepts anything the platform or our own stored settings might hand us —
 * `'ES'`, `'pt-BR'`, `'ru_RU'`, `'es-419'` — and returns the base code when we
 * support it, else undefined. Region is deliberately dropped: we ship one
 * variant per language, so `pt-BR` and `pt-PT` both resolve to `pt`.
 */
export function normalizeToUiLanguage(tag: string | null | undefined): string | undefined {
  if (!tag) return undefined;
  const base = tag.toLowerCase().replace(/_/g, '-').split('-')[0];
  return UI_LANGUAGE_CODES.includes(base) ? base : undefined;
}
