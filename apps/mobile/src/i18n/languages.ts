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
 *    3. Add one row to UI_LANGUAGES below. Set `rtl: true` for a right-to-left
 *       script — `rtl.ts` handles the mirroring off that flag alone. Set
 *       `preview: true` while the locale is still being verified: it ships and
 *       is tested, but is not offered to users until the flag comes off.
 *    4. Un-gating a locale (dropping `preview`) also means the *server* has to
 *       know it: add the code to `backend/src/utils/ui_languages.py` and a copy
 *       block to `backend/src/services/email_i18n.py`, or that user gets a
 *       translated app and an English welcome email. `locales.test.ts` fails
 *       when the two lists disagree.
 *
 *  No component, picker, or store needs touching: Settings and onboarding
 *  both render straight from SELECTABLE_UI_LANGUAGES.
 *
 *  One thing translators own rather than the code: directional arrows baked
 *  into copy (`"Continue →"`). An RTL locale writes `←` in its own strings.
 *  Arrows rendered from code go through `FORWARD_ARROW` in `rtl.ts` instead.
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
  /** Right-to-left script. Read by `rtl.ts` to decide the native layout
   *  direction, which is why it is data here rather than a hardcoded list. */
  rtl?: boolean;
  /** Translated and bundled, but not yet offered to users. A preview locale
   *  stays in this list — so its files, its parity tests and (for Arabic) the
   *  RTL mirroring guards all keep running — while being excluded from the
   *  picker *and* from language resolution, so nobody lands in it by accident.
   *  Un-gating is a one-word deletion once the locale has been verified. */
  preview?: boolean;
}

export const UI_LANGUAGES: ReadonlyArray<UiLanguage> = [
  { code: 'en', name: 'English',    nativeName: 'English' },
  { code: 'es', name: 'Spanish',    nativeName: 'Español' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'tr', name: 'Turkish',    nativeName: 'Türkçe' },
  { code: 'ru', name: 'Russian',    nativeName: 'Русский' },
  // Arabic is gated until RTL has been walked on a device (#104): two swipe
  // gestures still read physical `dx`, and no one has ever seen this app
  // mirrored. Drop `preview` to ship it.
  { code: 'ar', name: 'Arabic',     nativeName: 'العربية', rtl: true, preview: true },
];

/** The locale every other one falls back to, key-by-key. */
export const FALLBACK_LANGUAGE = 'en';

/** The locales a user can actually end up in — pickers and resolution both read
 *  this rather than UI_LANGUAGES, which also carries the gated `preview` ones. */
export const SELECTABLE_UI_LANGUAGES: ReadonlyArray<UiLanguage> = UI_LANGUAGES.filter(
  (l) => !l.preview,
);

export const UI_LANGUAGE_CODES: ReadonlyArray<string> = SELECTABLE_UI_LANGUAGES.map((l) => l.code);

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
