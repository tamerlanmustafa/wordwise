# WordWise — App Language (i18n) Map & Plan

Goal: let users run the **app UI** in their own language, and make adding language
#N+1 a data-only change (drop in a JSON file, add one line to a list).

Scope: `apps/mobile` only. `frontend/` is frozen (see CLAUDE.md); its public pages
stay English unless we're asked otherwise.

---

## 1. The three "language" concepts already in the codebase

This is the single biggest source of confusion, and it must be settled before any
strings move. Today there are **three** language fields and **none of them** control
the app UI:

| Concept | Where it lives | List used | What it actually does |
|---|---|---|---|
| `targetLanguage` | `core/App.tsx:100`, AsyncStorage key `targetLanguage` | `AVAILABLE_LANGUAGES` (12) | Language that **words/sentences are translated into**. The real "my language" signal. |
| `native_language` | `users.native_language`, `SettingsScreen.tsx:54` | `SUPPORTED_LANGUAGES` (30) | Profile field. Saved, displayed, otherwise **inert**. |
| `learning_language` | `users.learning_language`, `SettingsScreen.tsx:55` | `SUPPORTED_LANGUAGES` (30) | Profile field. Effectively always English (the app only teaches English). |
| `language_preference` | `users.language_preference`, `schemas/user.py:12` | — | Hard-coded to `'en'` at signup (`LoginScreen.tsx:205`). Commented "translation target language". **Vestigial.** |

**Recommendation:** add **one** new concept, `appLanguage`, and do *not* add a fourth
picker. Resolution order:

```
appLanguage = explicit user choice
            ?? targetLanguage (if we ship a UI locale for it)
            ?? device locale (expo-localization)
            ?? 'en'
```

So a user who picks Spanish translations in onboarding gets a Spanish UI for free,
with an override in Settings for the mismatch case (a Turk studying via Spanish
translations who still wants a Turkish UI). Reuse the dead `language_preference`
column for server-side persistence rather than adding a migration — Prisma migrations
are currently drifted and go through manual SQL, so avoiding a schema change is worth
real money here.

---

## 2. String inventory (measured, not estimated)

Scanned `apps/mobile/src`, excluding `__tests__`. Counts are **unique prose strings**.

| Namespace | Strings | Files | Notes |
|---|---:|---:|---|
| `common` | 112 | 18 | App shell, bottom bar, `api.ts` error messages, store toasts, `ReportDialog` |
| `movies` | 71 | 13 | MovieDetail, MoviePreviewHub, MyMovies, journey shelves |
| `admin` | 65 | 4 | **Recommend excluding** — internal-only, English is fine |
| `settings` | 58 | 3 | SettingsScreen, UserMenuSheet, Privacy/Terms |
| `vocabulary` | 44 | 13 | WordCardDeck, VocabRow, Notebook, LearnedWords |
| `quiz` | 43 | 11 | QuizLesson, QuizResult, ReviewScreen, MCQCard |
| `onboarding` | 42 | 11 | Steps, SetIntroScreen, LanguageStep |
| `home` | 33 | 9 | HomeScreen, TodayWordCard, search bar, level sort |
| `other` | 31 | 15 | Genre names (`core/types.ts`), CEFR labels (`theme/palette.ts`) |
| `billing` | 28 | 3 | Paywall, FamilyPlan |
| `practice` | 24 | 5 | PracticeScreen, tiles, streak labels |
| `auth` | 21 | 1 | LoginScreen |
| `stats` | 15 | 3 | Stats, Leaderboard, Achievements |
| `notifications` | 9 | 3 | notificationsStore, NotificationsSheet, local reminders |
| **Total** | **596** | **112** | **~530 translatable** once admin is excluded |

Also in scope but outside the component tree:

- **180** template literals with `${}` interpolation → become `t('key', {count, name})`.
- **14** hand-rolled English plurals (`word${n === 1 ? '' : 's'}`) at
  `NotebookScreen.tsx:140,172`, `StatsScreen.tsx:152`, `LearnedWordsScreen.tsx:85`,
  `VocabularyScreen.tsx:44`, `MyMoviesScreen.tsx:155`, `PracticeScreen.tsx:215,221`,
  `OfflineBanner.tsx:28`, `AdminScreen.tsx:379,463`, `VocabCoverageView.tsx:201`.
  These **break** in Russian/Polish/Arabic (3–6 plural forms) and must become ICU plurals.
- **3 backend email templates** (`backend/src/services/email_service.py`): welcome,
  password reset, worker alert. Welcome + reset are user-facing.
- **2 local push reminders** (`services/notifications.ts:88,116`).
- **84** backend `HTTPException(detail=...)` strings — mostly never displayed verbatim;
  only `SettingsScreen.tsx:157` surfaces one. Recommend leaving these English and
  ensuring the app always has a translated fallback message.

---

## 3. Architecture

### Library
`i18next` + `react-i18next` + `expo-localization`. Reasons: it's the only option with
mature ICU plural support (needed for Russian/Polish/Arabic), it has a non-React `t()`
for use inside Zustand stores, and it does namespace lazy-loading. Add
`intl-pluralrules` only if Hermes' `Intl.PluralRules` proves absent on Android.

### Layout

```
apps/mobile/src/i18n/
  index.ts              # init, locale resolution, RTL wiring
  locales/
    en/                 # source of truth — every other locale mirrors these files
      common.json  home.json  movies.json  vocabulary.json  quiz.json
      practice.json  onboarding.json  auth.json  settings.json
      billing.json  stats.json  notifications.json
    es/ ... tr/ ...
  languages.ts          # UI_LANGUAGES: the shipped list (the "add a language" file)
```

### What "adding a language" costs, by design
1. Copy `locales/en/` → `locales/xx/`, translate the values.
2. Add one entry to `UI_LANGUAGES` in `languages.ts`.
3. Done. No component edits, no picker edits — the Settings picker and the
   onboarding step both render from `UI_LANGUAGES`.

To keep that promise, resources are registered by **static glob-free import map** in
`i18n/index.ts` (Metro can't do dynamic `require` on variable paths), so step 2 is
literally two lines: the import and the list entry.

### Guardrails (the part that stops drift)
- **Key-parity test** in `src/i18n/__tests__/locales.test.ts`: every locale must have
  exactly the key set of `en`, no extras, no missing, and no empty values. This is the
  test that makes "easy to add a language" true six months from now — it fails loudly
  on push (`.husky/pre-push`) when someone adds an English string and forgets the rest.
- **Interpolation-parity test**: `{{count}}`/`{{name}}` placeholders in a translated
  value must match the English one.
- **ESLint `react-native/no-raw-text`** (or a scoped custom rule) to stop new literal
  JSX text from landing untranslated.

### Things that break and need explicit handling
- **RTL** — no `I18nManager` usage exists anywhere today. If Arabic or Hebrew ships,
  every `marginLeft`/`paddingRight`/`flexDirection: 'row'` needs auditing. Strong
  recommendation: **exclude RTL languages from v1** and treat RTL as its own project.
- **Dates/numbers** — 12 call sites use `toLocaleString()` / `toLocaleDateString()`
  with no locale argument, so they follow the *device*, not the app language. They
  need to take the active locale.
- **Text overflow** — German and Russian run 30–40% longer than English. Fixed-width
  buttons and `numberOfLines={1}` labels will clip.
- **Keyboards** — nothing to build. OS keyboards already work in all 13 `TextInput`s;
  none restrict input. The one real risk is search/matching against non-Latin scripts,
  and `filterLanguages()` (`types/constants.ts:85`) already lowercases both sides,
  which is correct.

---

## 4. Suggested sequencing

| Phase | Work | Why this order |
|---|---|---|
| 0 ✅ | **Done** — deps, `i18n/index.ts`, locale resolution, `UI_LANGUAGES`, parity tests, Settings picker, `LanguageStep` extracted | Infrastructure lands and is provably correct before 500 strings move |
| 1 | Extract `common` + `auth` + `onboarding` (175 strings) | First-run experience — the highest-value surface for a non-English user |
| 2 | Extract `home`, `movies`, `vocabulary` (148) | Core loop |
| 3 | Extract `quiz`, `practice`, `stats`, `notifications` (91) | Study loop |
| 4 | Extract `settings`, `billing`, `other` (117) | Includes genre + CEFR labels |
| 5 | Plurals → ICU, `toLocaleString` → active locale, backend email templates | Correctness pass |
| 6 | Second locale end-to-end + overflow/clipping sweep | Proves the "add a language" promise |

Admin (65 strings) stays English throughout.

---

## 4b. What Phase 0 actually shipped

Pilot locales: **en, es, pt, tr, ru** (Russian chosen deliberately — its 4-form
plurals exercise the path that 14 existing hand-rolled `n === 1 ? …` sites get wrong).

```
src/i18n/index.ts          resolution, init, switching, getFormattingLocale()
src/i18n/languages.ts      UI_LANGUAGES — the "add a language" file
src/i18n/resources.ts      static locale × namespace import map
src/i18n/locales/<code>/   common.json, onboarding.json, settings.json
src/i18n/__tests__/        46 tests: locale integrity + resolution behaviour
```

Wired up:
- `core/App.tsx` — `initI18n()` before first render; an effect re-derives the UI
  language whenever `targetLanguage` changes (unless the user pinned one).
- `SettingsScreen` — "App Language" section above Translation Language, with a
  "follows your translation language" reset shown only when pinned.
- `onboarding/LanguageStep` — fully extracted, as the proof case.

Verified: `tsc --noEmit` clean (web + mobile) · 493/493 jest tests pass · 0 new
lint errors · `expo export --platform ios` bundles, with all five locales
confirmed present in the Hermes bytecode.

**Deploy note:** `expo-localization` is a new native module with a config plugin,
so existing dev clients need a rebuild before device-locale detection works.
`getDeviceLanguage()` is try/caught and returns `undefined` on an old client, so
the app degrades to translation-language → English rather than crashing.

---

## 5. Open questions

1. ~~Launch languages~~ — **decided:** 4 pilot locales (es, pt, tr, ru) + en.
2. ~~Translation source~~ — **decided:** DeepL machine translation with spot review.
   The Phase 0 strings above were written by hand; phases 1–4 should run through DeepL.
3. **Reuse `language_preference`** for the server-side field, or accept a migration?
   Still open — Phase 0 persists to AsyncStorage only, which is correct for a
   device-level preference. Server persistence only matters if the language should
   follow a user across devices. Worth deciding before Phase 1.
4. **Backend emails** (welcome, password reset) are still English-only. They'd need
   the user's language stored server-side — i.e. question 3 answered first.
