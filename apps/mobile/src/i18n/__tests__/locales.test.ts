/**
 * Locale integrity tests — the guardrail behind "adding a language is easy".
 *
 * Everything here is structural: it reads the JSON off disk and compares each
 * locale against `en`. That makes the failure mode loud and early (pre-push /
 * CI) rather than a blank label discovered by a user in production.
 *
 * The plural cases are deliberately not symmetric with the key-parity check:
 * a Russian file legitimately has `_few`/`_many` keys English doesn't, so
 * plural suffixes are compared per-language against Intl.PluralRules instead
 * of against the English key set.
 */

import fs from 'fs';
import path from 'path';

import { NAMESPACES } from '../resources';
import {
  FALLBACK_LANGUAGE,
  SELECTABLE_UI_LANGUAGES,
  UI_LANGUAGES,
  normalizeToUiLanguage,
} from '../languages';

const LOCALES_DIR = path.join(__dirname, '..', 'locales');
const CODES = UI_LANGUAGES.map((l) => l.code);
const TRANSLATIONS = CODES.filter((c) => c !== FALLBACK_LANGUAGE);

/** i18next plural suffixes, e.g. `wordCount_one` → base `wordCount`, cat `one`. */
const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];

function readNs(locale: string, ns: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, locale, `${ns}.json`), 'utf8'));
}

/** Flatten nested objects to dotted paths: `{a:{b:'x'}}` → `{'a.b':'x'}`. */
function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v as Record<string, unknown>, key));
    } else {
      out[key] = String(v);
    }
  }
  return out;
}

/** Strip a trailing plural suffix so `wordCount_many` groups under `wordCount`. */
function pluralBase(key: string): string {
  for (const suf of PLURAL_SUFFIXES) {
    if (key.endsWith(`_${suf}`)) return key.slice(0, -(suf.length + 1));
  }
  return key;
}

function placeholders(value: string): string[] {
  return (value.match(/\{\{\s*[\w.]+\s*\}\}/g) ?? [])
    .map((p) => p.replace(/[{}\s]/g, ''))
    .sort();
}

describe('locale files', () => {
  it('has a directory for every language in UI_LANGUAGES', () => {
    const onDisk = fs
      .readdirSync(LOCALES_DIR, { withFileTypes: true })
      .filter((d: fs.Dirent) => d.isDirectory())
      .map((d: fs.Dirent) => d.name)
      .sort();
    expect(onDisk).toEqual([...CODES].sort());
  });

  it.each(CODES)('%s has every namespace file and it is valid JSON', (locale) => {
    for (const ns of NAMESPACES) {
      expect(() => readNs(locale, ns)).not.toThrow();
    }
  });

  it.each(CODES)('%s has no blank values', (locale) => {
    // Collected rather than asserted per-key so one run reports every gap —
    // the difference between one fix-and-rerun cycle and twenty.
    const blank: string[] = [];
    for (const ns of NAMESPACES) {
      for (const [key, value] of Object.entries(flatten(readNs(locale, ns)))) {
        if (value.trim().length === 0) blank.push(`${ns}:${key}`);
      }
    }
    expect({ locale, blank }).toEqual({ locale, blank: [] });
  });

  it.each(CODES)('%s writes numbers in Western digits', (locale) => {
    // The Arabic copy was first written with Arabic-Indic digits (U+0660-0669)
    // while every `{{count}}` interpolation emits Western ones, so a single
    // screen showed both systems (#104, section 4). One convention, picked as
    // Western because that is what the hundreds of interpolated numbers
    // already produce, and enforced here so it cannot drift back.
    const NON_WESTERN_DIGITS = /[\u0660-\u0669\u06f0-\u06f9]/;
    const offenders: string[] = [];
    for (const ns of NAMESPACES) {
      for (const [key, value] of Object.entries(flatten(readNs(locale, ns)))) {
        if (NON_WESTERN_DIGITS.test(value)) offenders.push(`${ns}:${key}`);
      }
    }
    expect({ locale, offenders }).toEqual({ locale, offenders: [] });
  });
});

describe('key parity with the fallback locale', () => {
  it.each(TRANSLATIONS)('%s has exactly the English key set (modulo plurals)', (locale) => {
    for (const ns of NAMESPACES) {
      const en = new Set(Object.keys(flatten(readNs(FALLBACK_LANGUAGE, ns))).map(pluralBase));
      const other = new Set(Object.keys(flatten(readNs(locale, ns))).map(pluralBase));

      const missing = [...en].filter((k) => !other.has(k)).sort();
      const extra = [...other].filter((k) => !en.has(k)).sort();

      // Asserted as objects so a failure names the offending keys directly.
      expect({ ns, locale, missing, extra }).toEqual({ ns, locale, missing: [], extra: [] });
    }
  });
});

describe('interpolation parity', () => {
  it.each(TRANSLATIONS)('%s uses the same placeholders as English', (locale) => {
    for (const ns of NAMESPACES) {
      const en = flatten(readNs(FALLBACK_LANGUAGE, ns));
      const other = flatten(readNs(locale, ns));

      // Build the English placeholder set per plural *base*, since a locale's
      // `_many` variant must carry the placeholders of English's `_other`.
      const enByBase: Record<string, string[]> = {};
      for (const [key, value] of Object.entries(en)) {
        enByBase[pluralBase(key)] = placeholders(value);
      }

      for (const [key, value] of Object.entries(other)) {
        const expected = enByBase[pluralBase(key)];
        if (!expected) continue; // key-parity test reports this separately
        expect({ locale, ns, key, placeholders: placeholders(value) }).toEqual({
          locale,
          ns,
          key,
          placeholders: expected,
        });
      }
    }
  });
});

describe('plural completeness', () => {
  it.each(CODES)('%s defines every plural category its language requires', (locale) => {
    const required = new Set(
      // Probe a spread of counts wide enough to surface one/few/many/other.
      [0, 1, 2, 3, 5, 11, 21, 22, 25, 100, 101].map((n) =>
        new Intl.PluralRules(locale).select(n),
      ),
    );

    const missing: string[] = [];
    for (const ns of NAMESPACES) {
      const keys = Object.keys(flatten(readNs(locale, ns)));
      const pluralBases = new Set(keys.filter((k) => k !== pluralBase(k)).map(pluralBase));

      for (const base of pluralBases) {
        for (const cat of required) {
          if (!keys.includes(`${base}_${cat}`)) missing.push(`${ns}:${base}_${cat}`);
        }
      }
    }
    expect({ locale, missing }).toEqual({ locale, missing: [] });
  });

  it('every language that pluralises in English also pluralises everywhere', () => {
    const enKeys = NAMESPACES.flatMap((ns) => Object.keys(flatten(readNs(FALLBACK_LANGUAGE, ns))));
    const enPluralBases = new Set(enKeys.filter((k) => k !== pluralBase(k)).map(pluralBase));

    for (const locale of TRANSLATIONS) {
      const keys = NAMESPACES.flatMap((ns) => Object.keys(flatten(readNs(locale, ns))));
      const bases = new Set(keys.filter((k) => k !== pluralBase(k)).map(pluralBase));
      expect({ locale, bases: [...bases].sort() }).toEqual({
        locale,
        bases: [...enPluralBases].sort(),
      });
    }
  });
});

/**
 * Locales the #101 copy pass covers. Arabic is excluded on purpose: it is
 * `preview: true` pending the native review in #104, and what it should call a
 * reel is a translation decision that review has not made yet.
 */
const REVIEWED_LOCALES = TRANSLATIONS.filter((c) => c !== 'ar');

describe('product glossary (#101)', () => {
  // "reel" is our own noun for a user's film queue, and translating each string
  // in isolation had no way to know that: across sixteen keys it shipped as
  // корзина (a shopping cart), makara (a film spool), аудиозаписи (audio
  // recordings), portfólio, and Reels (the Instagram feature). The decision was
  // to keep the English loanword in every locale — enforceable precisely
  // because it is the one rendering with no dictionary sense to drift into.
  const stripPlaceholders = (s: string) => s.replace(/\{\{[^}]*\}\}/g, '');
  const MENTIONS_REEL = /\breels?\b/i;

  function englishReelKeys(): string[] {
    return NAMESPACES.flatMap((ns) =>
      Object.entries(flatten(readNs(FALLBACK_LANGUAGE, ns)))
        .filter(([, value]) => MENTIONS_REEL.test(value))
        .map(([key]) => `${ns}:${key}`),
    );
  }

  it('English still uses the term the glossary is written against', () => {
    // Without this, renaming the feature in English would silently reduce the
    // check below to zero assertions and it would keep passing forever.
    expect(englishReelKeys().length).toBeGreaterThan(10);
  });

  it.each(REVIEWED_LOCALES)('%s calls a reel a reel', (locale) => {
    const offenders: string[] = [];
    for (const ns of NAMESPACES) {
      const en = flatten(readNs(FALLBACK_LANGUAGE, ns));
      const other = flatten(readNs(locale, ns));
      for (const [key, value] of Object.entries(en)) {
        if (!MENTIONS_REEL.test(value)) continue;
        // Placeholders are stripped first: `{{reel}}` in `setIntro.setReel`
        // would otherwise satisfy the check with no visible word on screen.
        if (!stripPlaceholders(other[key] ?? '').toLowerCase().includes('reel')) {
          offenders.push(`${ns}:${key}`);
        }
      }
    }
    expect({ locale, offenders }).toEqual({ locale, offenders: [] });
  });
});

describe('register consistency (#101)', () => {
  // Turkish, Russian and Portuguese each offer a choice the source English does
  // not encode, so a per-string pipeline answered it per string: Turkish
  // onboarding asked "Ne öğreniyorsun?" (informal) two screens before the level
  // result said "biliyorsunuz" (formal). Each language is committed to one
  // register here; the patterns below are the *rejected* one.
  //
  // Matched as bare substrings rather than with `\b`, because JavaScript word
  // boundaries are ASCII-only — `/iniz\b/` fails on "adresinizi", which is
  // exactly the formal possessive-plus-case-ending this needs to catch.
  const REJECTED: Record<string, { register: string; pattern: RegExp }> = {
    // Formal 2nd-person-plural verb and possessive endings.
    tr: { register: 'informal sen', pattern: /sınız|siniz|sunuz|sünüz|ınız|iniz|unuz|ünüz/ },
    // Informal pronouns. Cyrillic needs explicit letter lookarounds for the
    // same ASCII-`\b` reason; `тво[йяеиёу]` keeps "творог" out.
    ru: { register: 'formal вы', pattern: /(?<!\p{L})(?:ты|тебя|тебе|тобой|тво[йяеиёу]\p{L}*)(?!\p{L})/iu },
    // European Portuguese forms in an otherwise Brazilian file.
    pt: {
      register: 'Brazilian',
      pattern: /(?<!\p{L})(?:estás|podes|tens|ecrã|telemóvel|utilizador|descarreg\p{L}*)(?!\p{L})/iu,
    },
  };

  it.each(Object.keys(REJECTED))('%s keeps one register throughout', (locale) => {
    const { register, pattern } = REJECTED[locale];
    const offenders: string[] = [];
    for (const ns of NAMESPACES) {
      for (const [key, value] of Object.entries(flatten(readNs(locale, ns)))) {
        if (pattern.test(value)) offenders.push(`${ns}:${key}`);
      }
    }
    expect({ locale, register, offenders }).toEqual({ locale, register, offenders: [] });
  });
});

describe('right-to-left locales', () => {
  // This used to assert the *opposite* — that no RTL locale existed — because
  // the layout could not mirror. Now that it can (see `i18n/rtl.ts`), the
  // guard's job is the reverse: keep RTL a supported configuration rather than
  // something that silently rots the next time a style is written by hand.
  it('ships at least one, so the mirroring path stays exercised', () => {
    expect(UI_LANGUAGES.some((l) => l.rtl)).toBe(true);
  });

  it('marks Arabic as RTL and nothing latin-scripted', () => {
    const rtl = UI_LANGUAGES.filter((l) => l.rtl).map((l) => l.code);
    expect(rtl).toContain('ar');
    expect(rtl).not.toContain('en');
  });
});

describe('preview locales', () => {
  // A preview locale is fully shipped but not offered: it keeps its files, its
  // parity checks and (for Arabic) the mirroring guards above, while staying
  // out of every path that could put a user in it. See #104.
  it('keeps Arabic bundled but out of the picker until RTL is verified', () => {
    const previewed = UI_LANGUAGES.filter((l) => l.preview).map((l) => l.code);
    expect(previewed).toEqual(['ar']);

    // Still in UI_LANGUAGES, so its locale dir and RTL flag stay under test…
    expect(CODES).toContain('ar');
    // …but nothing a user can choose.
    expect(SELECTABLE_UI_LANGUAGES.map((l) => l.code)).not.toContain('ar');
  });

  it('excludes them from resolution, not just from the list', () => {
    // The picker is only half the surface: a device set to Arabic would
    // otherwise be handed an unverified RTL layout it never asked for, with no
    // Arabic row in Settings to explain where it came from.
    expect(normalizeToUiLanguage('ar')).toBeUndefined();
    expect(normalizeToUiLanguage('ar-EG')).toBeUndefined();
  });

  it('leaves the five launch locales selectable', () => {
    expect(SELECTABLE_UI_LANGUAGES.map((l) => l.code)).toEqual(['en', 'es', 'pt', 'tr', 'ru']);
  });
});

describe('normalizeToUiLanguage', () => {
  it('accepts the shapes the platform and our own settings actually produce', () => {
    expect(normalizeToUiLanguage('ES')).toBe('es');
    expect(normalizeToUiLanguage('pt-BR')).toBe('pt');
    expect(normalizeToUiLanguage('pt_PT')).toBe('pt');
    expect(normalizeToUiLanguage('ru-RU')).toBe('ru');
    expect(normalizeToUiLanguage('es-419')).toBe('es');
  });

  it('rejects languages we do not ship a UI for', () => {
    // 'ja' is a translation language (AVAILABLE_LANGUAGES) but not a UI one —
    // the exact case that must not fall through to a half-translated screen.
    expect(normalizeToUiLanguage('ja')).toBeUndefined();
    expect(normalizeToUiLanguage('zz')).toBeUndefined();
    expect(normalizeToUiLanguage('')).toBeUndefined();
    expect(normalizeToUiLanguage(null)).toBeUndefined();
    expect(normalizeToUiLanguage(undefined)).toBeUndefined();
  });
});

describe('backend parity (#98)', () => {
  // The server decides which language a welcome / password-reset email is
  // written in, so it keeps its own copy of this list — Python can't import a
  // .ts module. These two tests are what stop the copies drifting: un-gate a
  // locale here without touching the backend and a user gets a translated app
  // with English mail, which nobody notices until they read their inbox.
  const BACKEND_DIR = path.join(__dirname, '..', '..', '..', '..', '..', 'backend', 'src');

  function pyStringList(source: string, constant: string): string[] {
    const block = new RegExp(`${constant}[^=]*=\\s*\\(([^)]*)\\)`).exec(source);
    if (!block) throw new Error(`${constant} not found — did the backend file move?`);
    return [...block[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
  }

  it('ships the same selectable locales as backend/src/utils/ui_languages.py', () => {
    const source = fs.readFileSync(path.join(BACKEND_DIR, 'utils', 'ui_languages.py'), 'utf8');
    expect(pyStringList(source, 'UI_LANGUAGE_CODES')).toEqual(
      SELECTABLE_UI_LANGUAGES.map((l) => l.code),
    );
  });

  it('has an email copy block for every selectable locale', () => {
    const source = fs.readFileSync(path.join(BACKEND_DIR, 'services', 'email_i18n.py'), 'utf8');
    const dict = /EMAIL_COPY: dict\[str, dict\[str, str\]\] = \{([^}]*)\}/.exec(source);
    expect(dict).not.toBeNull();
    const codes = [...dict![1].matchAll(/"([a-z-]+)":/g)].map((m) => m[1]);
    expect(codes.sort()).toEqual(SELECTABLE_UI_LANGUAGES.map((l) => l.code).sort());
  });
});
