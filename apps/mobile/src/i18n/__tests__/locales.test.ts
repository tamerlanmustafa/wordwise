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
import { FALLBACK_LANGUAGE, UI_LANGUAGES, normalizeToUiLanguage } from '../languages';

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
