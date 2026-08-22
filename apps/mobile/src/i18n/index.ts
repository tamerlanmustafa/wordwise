/**
 * i18n — app-UI language for WordWise mobile.
 *
 * Read this first, because the codebase has four "language" fields and only
 * one of them is this one:
 *
 *   • appLanguage        (here)   — the language of the *interface*: buttons,
 *                                   labels, instructions.
 *   • targetLanguage     (App.tsx) — the language words are *translated into*.
 *   • native_language    (profile) — stored, displayed, otherwise inert.
 *   • learning_language  (profile) — always English in practice.
 *
 * Resolution order for appLanguage, highest priority first:
 *
 *   1. an explicit choice the user made in Settings   (AsyncStorage)
 *   2. the same choice stored on their account        (users.language_preference)
 *   3. their translation language, if we ship a UI locale for it
 *   4. the device locale                              (expo-localization)
 *   5. 'en'
 *
 * Rule 3 is what makes this feel automatic: someone who picks Spanish
 * translations during onboarding gets a Spanish interface without being asked
 * a second language question. Rule 1 exists for the mismatch case — a Turkish
 * speaker studying via Spanish translations who still wants a Turkish UI.
 *
 * Rules 1 and 2 hold the *same* fact — Settings writes both — and differ only
 * in where. Local wins because it is the choice made on this device and needs
 * no network; the account copy is what a fresh install inherits before the
 * user has touched Settings on it, and what decides which language their
 * welcome and password-reset emails are written in (#98).
 *
 * Because `t` is also needed outside React (Zustand stores, services, the
 * notification builders), prefer the exported `t` here over the `useTranslation`
 * hook in non-component code.
 */

// i18next resolves plural categories through Intl.PluralRules. Hermes ships it
// on current RN, but a silent absence would degrade Russian/Polish plurals to
// the English one/other split — wrong, and invisible in testing. Load the
// polyfill only when the engine lacks it. The require path is a literal, so
// Metro still bundles it; the conditional only decides whether it executes.
if (typeof Intl === 'undefined' || typeof (Intl as any).PluralRules === 'undefined') {
  require('intl-pluralrules');
}

import i18next, { type i18n as I18nInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_NAMESPACE, NAMESPACES, resources } from './resources';
import { FALLBACK_LANGUAGE, normalizeToUiLanguage } from './languages';

/** AsyncStorage key holding the user's *explicit* Settings choice, if any. */
export const APP_LANGUAGE_KEY = 'wordwise.appLanguage.v1';

/**
 * Device locale, narrowed to a language we ship.
 *
 * expo-localization is a native module, so it is required lazily and guarded:
 * under Jest (and on the rare platform where the module is missing) this must
 * degrade to `undefined` rather than throwing during module init.
 */
export function getDeviceLanguage(): string | undefined {
  try {
    const { getLocales } = require('expo-localization');
    const tag = getLocales?.()?.[0]?.languageCode ?? getLocales?.()?.[0]?.languageTag;
    return normalizeToUiLanguage(tag);
  } catch {
    return undefined;
  }
}

export interface ResolveInput {
  /** Explicit Settings choice made on this device. */
  stored?: string | null;
  /** The same choice as stored on the account (`user.language_preference`). */
  server?: string | null;
  /** The user's translation language (`targetLanguage`, e.g. 'ES'). */
  translationLanguage?: string | null;
  /** Device locale, already normalized. Injectable for tests. */
  device?: string | null;
}

/** Pure resolution of the five-step order documented above. */
export function resolveAppLanguage({
  stored,
  server,
  translationLanguage,
  device,
}: ResolveInput): string {
  return (
    normalizeToUiLanguage(stored) ??
    normalizeToUiLanguage(server) ??
    normalizeToUiLanguage(translationLanguage) ??
    normalizeToUiLanguage(device) ??
    FALLBACK_LANGUAGE
  );
}

let initialized = false;

/**
 * Initialise i18next. Safe to call more than once — later calls are no-ops, so
 * a re-render or a fast-refresh cycle can't reset the active language.
 */
export function initI18n(initialLanguage: string = FALLBACK_LANGUAGE): I18nInstance {
  if (initialized) return i18next;
  initialized = true;

  i18next.use(initReactI18next).init({
    resources,
    lng: normalizeToUiLanguage(initialLanguage) ?? FALLBACK_LANGUAGE,
    fallbackLng: FALLBACK_LANGUAGE,
    ns: NAMESPACES as unknown as string[],
    defaultNS: DEFAULT_NAMESPACE,
    // React Native has no <html> to escape into, and escaping here would
    // mangle apostrophes and quotes in translated copy.
    interpolation: { escapeValue: false },
    // Metro bundles every locale up front, so nothing is ever loaded async.
    initImmediate: false,
    returnNull: false,
  });

  return i18next;
}

/**
 * Hydrate from storage and switch to the resolved language.
 *
 * `translationLanguage` and `serverLanguage` are passed in rather than read
 * from a store to keep this module free of app-state imports (the
 * auth/onboarding stores import *this*). `serverLanguage` is
 * `user.language_preference`; it is legitimately undefined on a logged-out
 * boot, and arrives late on a cold start (the cached user is refreshed from
 * /auth/me in the background), so callers re-run this when it changes.
 */
export async function hydrateAppLanguage(
  translationLanguage?: string | null,
  serverLanguage?: string | null,
): Promise<string> {
  let stored: string | null = null;
  try {
    stored = await AsyncStorage.getItem(APP_LANGUAGE_KEY);
  } catch {
    // Storage unavailable — fall through to the derived language.
  }
  const resolved = resolveAppLanguage({
    stored,
    server: serverLanguage,
    translationLanguage,
    device: getDeviceLanguage(),
  });
  await setAppLanguage(resolved, { persist: false });
  return resolved;
}

/**
 * Switch the active UI language.
 *
 * `persist: false` is for derived changes (following the translation language,
 * or the initial hydrate) — those must NOT be written back, or the very first
 * launch would record an explicit choice the user never made and rule 2 could
 * never apply again.
 */
export async function setAppLanguage(
  code: string,
  opts: { persist?: boolean } = {},
): Promise<void> {
  const { persist = true } = opts;
  const next = normalizeToUiLanguage(code) ?? FALLBACK_LANGUAGE;

  if (i18next.language !== next) {
    await i18next.changeLanguage(next);
  }
  if (persist) {
    try {
      await AsyncStorage.setItem(APP_LANGUAGE_KEY, next);
    } catch {
      // Non-fatal: the language still changed for this session.
    }
  }
}

/** True when the user has explicitly pinned a language in Settings. */
export async function hasExplicitAppLanguage(): Promise<boolean> {
  try {
    return normalizeToUiLanguage(await AsyncStorage.getItem(APP_LANGUAGE_KEY)) !== undefined;
  } catch {
    return false;
  }
}

/**
 * Clear the explicit choice so the UI follows the translation language again.
 *
 * No `serverLanguage` argument on purpose: the account copy holds the *same*
 * pin, so re-reading it here would instantly restore the language the user
 * just cleared. Settings clears both — it PATCHes `language_preference: ''`
 * alongside this call.
 */
export async function clearExplicitAppLanguage(translationLanguage?: string | null): Promise<void> {
  try {
    await AsyncStorage.removeItem(APP_LANGUAGE_KEY);
  } catch {
    // ignore
  }
  await hydrateAppLanguage(translationLanguage, null);
}

/** Currently active UI language. */
export function getAppLanguage(): string {
  return normalizeToUiLanguage(i18next.language) ?? FALLBACK_LANGUAGE;
}

/**
 * Locale tag for Intl formatters (`toLocaleDateString`, `Intl.NumberFormat`).
 * Use this instead of calling those with no argument, which silently follows
 * the *device* locale rather than the app language.
 */
export function getFormattingLocale(): string {
  return getAppLanguage();
}

/**
 * Initialise on import.
 *
 * `t` is used from outside React — Zustand stores and the notification
 * builders — so any module that imports this one may call it before App.tsx
 * has run. An uninitialised i18next returns `undefined` from `t`, which turns
 * a missing setup step into blank notification bodies rather than an error.
 * Init is synchronous (every locale is bundled, `initImmediate: false`), so
 * doing it here costs nothing and makes importing this module sufficient.
 *
 * App.tsx still calls initI18n() explicitly — it is a no-op by then, but it
 * documents the ordering and pins the language before the first render.
 */
initI18n();

export { default as i18n } from 'i18next';
export const t = i18next.t.bind(i18next);
export * from './languages';
