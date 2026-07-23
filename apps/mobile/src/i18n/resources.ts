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
import enBilling from './locales/en/billing.json';
import enCommon from './locales/en/common.json';
import enOnboarding from './locales/en/onboarding.json';
import enSettings from './locales/en/settings.json';
import enHome from './locales/en/home.json';
import enMovies from './locales/en/movies.json';
import enVocabulary from './locales/en/vocabulary.json';
import enNotifications from './locales/en/notifications.json';
import enPractice from './locales/en/practice.json';
import enQuiz from './locales/en/quiz.json';
import enStats from './locales/en/stats.json';

import esAuth from './locales/es/auth.json';
import esBilling from './locales/es/billing.json';
import esCommon from './locales/es/common.json';
import esOnboarding from './locales/es/onboarding.json';
import esSettings from './locales/es/settings.json';
import esHome from './locales/es/home.json';
import esMovies from './locales/es/movies.json';
import esVocabulary from './locales/es/vocabulary.json';
import esNotifications from './locales/es/notifications.json';
import esPractice from './locales/es/practice.json';
import esQuiz from './locales/es/quiz.json';
import esStats from './locales/es/stats.json';

import ptAuth from './locales/pt/auth.json';
import ptBilling from './locales/pt/billing.json';
import ptCommon from './locales/pt/common.json';
import ptOnboarding from './locales/pt/onboarding.json';
import ptSettings from './locales/pt/settings.json';
import ptHome from './locales/pt/home.json';
import ptMovies from './locales/pt/movies.json';
import ptVocabulary from './locales/pt/vocabulary.json';
import ptNotifications from './locales/pt/notifications.json';
import ptPractice from './locales/pt/practice.json';
import ptQuiz from './locales/pt/quiz.json';
import ptStats from './locales/pt/stats.json';

import trAuth from './locales/tr/auth.json';
import trBilling from './locales/tr/billing.json';
import trCommon from './locales/tr/common.json';
import trOnboarding from './locales/tr/onboarding.json';
import trSettings from './locales/tr/settings.json';
import trHome from './locales/tr/home.json';
import trMovies from './locales/tr/movies.json';
import trVocabulary from './locales/tr/vocabulary.json';
import trNotifications from './locales/tr/notifications.json';
import trPractice from './locales/tr/practice.json';
import trQuiz from './locales/tr/quiz.json';
import trStats from './locales/tr/stats.json';

import ruAuth from './locales/ru/auth.json';
import ruBilling from './locales/ru/billing.json';
import ruCommon from './locales/ru/common.json';
import ruOnboarding from './locales/ru/onboarding.json';
import ruSettings from './locales/ru/settings.json';
import ruHome from './locales/ru/home.json';
import ruMovies from './locales/ru/movies.json';
import ruVocabulary from './locales/ru/vocabulary.json';
import ruNotifications from './locales/ru/notifications.json';
import ruPractice from './locales/ru/practice.json';
import ruQuiz from './locales/ru/quiz.json';
import ruStats from './locales/ru/stats.json';

/**
 * Namespaces, in the order they were carved up in I18N_PLAN.md §2.
 * `common` is the default: `t('action.save')` with no prefix resolves there.
 */
export const NAMESPACES = [
  'common',
  'auth',
  'billing',
  'home',
  'movies',
  'notifications',
  'onboarding',
  'practice',
  'quiz',
  'settings',
  'stats',
  'vocabulary',
] as const;
export type Namespace = (typeof NAMESPACES)[number];

export const DEFAULT_NAMESPACE: Namespace = 'common';

export const resources: Resource = {
  en: {
    common: enCommon,
    auth: enAuth,
    billing: enBilling,
    home: enHome,
    movies: enMovies,
    onboarding: enOnboarding,
    settings: enSettings,
    notifications: enNotifications,
    practice: enPractice,
    quiz: enQuiz,
    stats: enStats,
    vocabulary: enVocabulary,
  },
  es: {
    common: esCommon,
    auth: esAuth,
    billing: esBilling,
    home: esHome,
    movies: esMovies,
    onboarding: esOnboarding,
    settings: esSettings,
    notifications: esNotifications,
    practice: esPractice,
    quiz: esQuiz,
    stats: esStats,
    vocabulary: esVocabulary,
  },
  pt: {
    common: ptCommon,
    auth: ptAuth,
    billing: ptBilling,
    home: ptHome,
    movies: ptMovies,
    onboarding: ptOnboarding,
    settings: ptSettings,
    notifications: ptNotifications,
    practice: ptPractice,
    quiz: ptQuiz,
    stats: ptStats,
    vocabulary: ptVocabulary,
  },
  tr: {
    common: trCommon,
    auth: trAuth,
    billing: trBilling,
    home: trHome,
    movies: trMovies,
    onboarding: trOnboarding,
    settings: trSettings,
    notifications: trNotifications,
    practice: trPractice,
    quiz: trQuiz,
    stats: trStats,
    vocabulary: trVocabulary,
  },
  ru: {
    common: ruCommon,
    auth: ruAuth,
    billing: ruBilling,
    home: ruHome,
    movies: ruMovies,
    onboarding: ruOnboarding,
    settings: ruSettings,
    notifications: ruNotifications,
    practice: ruPractice,
    quiz: ruQuiz,
    stats: ruStats,
    vocabulary: ruVocabulary,
  },
};
