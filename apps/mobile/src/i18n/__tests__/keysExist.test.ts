/**
 * Every `t('ns:key')` in the app resolves to a real string.
 *
 * This exists because the opposite shipped. A quiz header called
 * `t('quiz:mcq.exerciseType')` for a key that was never added to any locale,
 * and i18next's fallback is to render the key itself — so a pill in the top
 * bar displayed the literal text `quiz:mcq.exerciseType` to users, in an OTA,
 * for a day.
 *
 * Nothing caught it, and the existing i18n suite is thorough: `locales.test`
 * checks that all six locales have the *same* keys, that none are blank, that
 * placeholders match and that plurals are complete. Every one of those passed,
 * because a key missing from **all** locales is perfectly symmetrical. Parity
 * tests compare the translations to each other; nothing compared them to the
 * code that calls them.
 *
 * So this reads the source instead: find the literal `t('...')` calls, and
 * assert the fallback locale can answer each one.
 *
 * Limits, stated so nobody trusts this further than it goes: only *literal*
 * keys are visible to a regex. `t(opt.labelKey)` and `t(\`quiz:${kind}\`)` are
 * computed at runtime and skipped — those are exactly the calls this cannot
 * protect, and they are worth writing as literals where you can.
 */

import fs from 'fs';
import path from 'path';

import { NAMESPACES } from '../resources';
import { FALLBACK_LANGUAGE } from '../languages';

const SRC = path.join(__dirname, '..', '..');
const LOCALES_DIR = path.join(__dirname, '..', 'locales');

/** Flatten `{a:{b:'x'}}` to `{'a.b':'x'}` so a dotted key can be looked up. */
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

/**
 * i18next plural suffixes. A counted call names the *base* key — `t('x', {count})`
 * — and i18next picks `x_one` / `x_other` from it, so the base legitimately
 * does not exist in the file. Stripping the suffix is what stops this guard
 * reporting every plural in the app as missing.
 */
const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];

function pluralBase(key: string): string {
  for (const suf of PLURAL_SUFFIXES) {
    if (key.endsWith(`_${suf}`)) return key.slice(0, -(suf.length + 1));
  }
  return key;
}

/** Every key the fallback locale can answer, as `ns:dotted.key`, plus the
 *  plural bases those keys are reachable by. */
const KNOWN = new Set<string>();
for (const ns of NAMESPACES) {
  const file = path.join(LOCALES_DIR, FALLBACK_LANGUAGE, `${ns}.json`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const key of Object.keys(flatten(data))) {
    KNOWN.add(`${ns}:${key}`);
    KNOWN.add(`${ns}:${pluralBase(key)}`);
  }
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'locales') sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** `t('ns:key')` / `t("ns:key")` with a literal, namespaced key. */
const T_CALL = /\bt\(\s*['"]([a-zA-Z0-9_]+:[a-zA-Z0-9_.]+)['"]/g;

describe('i18n keys referenced in code', () => {
  const missing: string[] = [];

  for (const file of sourceFiles(SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(T_CALL)) {
      const key = m[1];
      if (!KNOWN.has(key)) {
        missing.push(`${path.relative(SRC, file)}  ${key}`);
      }
    }
  }

  it('finds t() calls to check (guards the guard)', () => {
    // If the regex ever stops matching, this suite would pass vacuously and
    // quietly stop protecting anything.
    let found = 0;
    for (const file of sourceFiles(SRC)) {
      found += [...fs.readFileSync(file, 'utf8').matchAll(T_CALL)].length;
    }
    expect(found).toBeGreaterThan(100);
  });

  it('every literal key exists in the fallback locale', () => {
    // A key missing from *all* locales is symmetrical, so the parity tests are
    // blind to it — and i18next renders the key itself, which is how
    // `quiz:mcq.exerciseType` reached users as visible text.
    expect(missing).toEqual([]);
  });
});
