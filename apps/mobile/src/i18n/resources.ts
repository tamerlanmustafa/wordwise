/**
 * resources — the static locale → namespace → JSON map handed to i18next.
 *
 * These imports are deliberately explicit rather than globbed: Metro resolves
 * `require`/`import` at build time from *literal* paths only, so a dynamic
 * `require(\`./locales/${code}/common.json\`)` would resolve to nothing in a
 * release bundle. Explicit imports also mean a mistyped locale directory is a
 * TypeScript error rather than a blank screen at runtime.
 *
 * Adding a language: add the three imports and one `resources` entry — see the
 * checklist in `languages.ts`.
 */

import type { Resource } from 'i18next';

import enAuth from './locales/en/auth.json';
import enCommon from './locales/en/common.json';
import enOnboarding from './locales/en/onboarding.json';
import enSettings from './locales/en/settings.json';

import esAuth from './locales/es/auth.json';
import esCommon from './locales/es/common.json';
import esOnboarding from './locales/es/onboarding.json';
import esSettings from './locales/es/settings.json';

import ptAuth from './locales/pt/auth.json';
import ptCommon from './locales/pt/common.json';
import ptOnboarding from './locales/pt/onboarding.json';
import ptSettings from './locales/pt/settings.json';

import trAuth from './locales/tr/auth.json';
import trCommon from './locales/tr/common.json';
import trOnboarding from './locales/tr/onboarding.json';
import trSettings from './locales/tr/settings.json';

import ruAuth from './locales/ru/auth.json';
import ruCommon from './locales/ru/common.json';
import ruOnboarding from './locales/ru/onboarding.json';
import ruSettings from './locales/ru/settings.json';

/**
 * Namespaces, in the order they were carved up in I18N_PLAN.md §2.
 * `common` is the default: `t('action.save')` with no prefix resolves there.
 */
export const NAMESPACES = ['common', 'auth', 'onboarding', 'settings'] as const;
export type Namespace = (typeof NAMESPACES)[number];

export const DEFAULT_NAMESPACE: Namespace = 'common';

export const resources: Resource = {
  en: { common: enCommon, auth: enAuth, onboarding: enOnboarding, settings: enSettings },
  es: { common: esCommon, auth: esAuth, onboarding: esOnboarding, settings: esSettings },
  pt: { common: ptCommon, auth: ptAuth, onboarding: ptOnboarding, settings: ptSettings },
  tr: { common: trCommon, auth: trAuth, onboarding: trOnboarding, settings: trSettings },
  ru: { common: ruCommon, auth: ruAuth, onboarding: ruOnboarding, settings: ruSettings },
};
