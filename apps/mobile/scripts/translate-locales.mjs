#!/usr/bin/env node
/**
 * translate-locales — machine-translate `src/i18n/locales/en/*.json` into every
 * other locale in UI_LANGUAGES, via DeepL.
 *
 * Usage (from apps/mobile):
 *   node scripts/translate-locales.mjs                  # all namespaces, all locales
 *   node scripts/translate-locales.mjs --ns quiz,home   # only these namespaces
 *   node scripts/translate-locales.mjs --lang ru        # only this locale
 *   node scripts/translate-locales.mjs --force          # re-translate existing keys
 *   node scripts/translate-locales.mjs --dry-run        # print, write nothing
 *
 * Behaviour that matters:
 *
 *  • Incremental by default. A key already present in the target locale is left
 *    alone, so hand-corrected copy survives re-runs and we don't re-pay for
 *    strings that haven't changed. `--force` overrides.
 *
 *  • Placeholders are verified, not escaped — see the comment on deeplBatch for
 *    why escaping made things worse. A translation that loses or renames a
 *    `{{var}}` is rejected, kept in English, and reported at the end.
 *
 *  • Stale keys are pruned. Renaming an English key otherwise orphans the old
 *    one in all four locales, which the parity test then fails on.
 *
 *  • Single-word labels need a human eye. DeepL translates each string in
 *    isolation, so a bare noun gets its most common sense, not the domain one:
 *    the film genre "Action" came back as Turkish "Eylem" (a deed) and Russian
 *    "Действие" (an act) rather than "Aksiyon"/"Боевик". Review any key whose
 *    English value is one or two words before trusting it.
 *
 *  • Plural keys are NOT machine-translated. English has two forms; Russian
 *    needs four, and there is no honest way to derive `wordCount_many` from
 *    `wordCount_other`. Those keys are listed at the end for a human to write.
 *    The locale parity test fails until they exist, which is the intended gate.
 *
 * The key is read from backend/.env — never hardcode or commit it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOBILE = path.resolve(HERE, '..');
const LOCALES = path.join(MOBILE, 'src', 'i18n', 'locales');
const ENV_FILE = path.resolve(MOBILE, '..', '..', 'backend', '.env');

const SOURCE = 'en';
/** DeepL target codes. Keep in sync with UI_LANGUAGES in src/i18n/languages.ts. */
const DEEPL_TARGET = { es: 'ES', pt: 'PT-BR', tr: 'TR', ru: 'RU' };

const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const DRY = flag('dry-run');
const FORCE = flag('force');
const ONLY_NS = opt('ns')?.split(',').map((s) => s.trim());
const ONLY_LANG = opt('lang')?.split(',').map((s) => s.trim());

// ── deepl ───────────────────────────────────────────────────────────────────
function readApiKey() {
  const raw = fs.readFileSync(ENV_FILE, 'utf8');
  const line = raw.split('\n').find((l) => l.trim().startsWith('DEEPL_API_KEY'));
  if (!line) throw new Error(`DEEPL_API_KEY not found in ${ENV_FILE}`);
  return line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
}

const API_KEY = readApiKey();
const ENDPOINT = API_KEY.endsWith(':fx')
  ? 'https://api-free.deepl.com/v2/translate'
  : 'https://api.deepl.com/v2/translate';

const PLACEHOLDER_RE = /\{\{\s*[\w.]+\s*\}\}/g;

const placeholdersOf = (text) => [...text.matchAll(PLACEHOLDER_RE)].map((m) => m[0]).sort();

/**
 * Send `{{name}}` through verbatim — no XML tag handling.
 *
 * This is deliberate and was measured. DeepL's `tag_handling=xml` + `ignore_tags`
 * is the documented way to protect variables, but it treats the tag as a
 * repositionable inline element and corrupts the surrounding words: "you have
 * {{count}} films saved" came back as "Tienes guardadas{{count}}s películas".
 * Passing the braces as plain text leaves them untouched — verified 20/20 across
 * es/pt/tr/ru on strings with one, two, and leading placeholders.
 *
 * `verifyPlaceholders` below is the seatbelt in case that ever stops holding.
 */
async function deeplBatch(texts, target) {
  const body = new URLSearchParams();
  body.set('target_lang', target);
  body.set('source_lang', 'EN');
  // UI chrome is short imperative labels; stops DeepL re-flowing them.
  body.set('preserve_formatting', '1');
  for (const t of texts) body.append('text', t);

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    // Header auth: DeepL removed the `auth_key` form field in Nov 2025.
    headers: {
      Authorization: `DeepL-Auth-Key ${API_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`DeepL ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = await res.json();
  return json.translations.map((t) => t.text);
}

// ── json helpers ────────────────────────────────────────────────────────────
const isPlural = (key) => PLURAL_SUFFIXES.some((s) => key.endsWith(`_${s}`));

/** `wordCount_many` → `wordCount`, so plural variants group under one key. */
function pluralBase(key) {
  for (const suf of PLURAL_SUFFIXES) {
    if (key.endsWith(`_${suf}`)) return key.slice(0, -(suf.length + 1));
  }
  return key;
}

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v, key));
    else out[key] = String(v);
  }
  return out;
}

function setDeep(obj, dotted, value) {
  const parts = dotted.split('.');
  let node = obj;
  for (const p of parts.slice(0, -1)) {
    if (typeof node[p] !== 'object' || node[p] === null) node[p] = {};
    node = node[p];
  }
  node[parts.at(-1)] = value;
}

/** Remove a dotted key, then any parent objects it leaves empty. */
function deleteDeep(obj, dotted) {
  const parts = dotted.split('.');
  const chain = [obj];
  let node = obj;
  for (const p of parts.slice(0, -1)) {
    if (typeof node?.[p] !== 'object' || node[p] === null) return;
    node = node[p];
    chain.push(node);
  }
  delete node[parts.at(-1)];
  for (let i = chain.length - 1; i > 0; i -= 1) {
    if (Object.keys(chain[i]).length === 0) delete chain[i - 1][parts[i - 1]];
  }
}

/** Stable key order so diffs stay readable across runs. */
function sortDeep(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((k) => [k, sortDeep(value[k])]),
  );
}

// ── main ────────────────────────────────────────────────────────────────────
const namespaces = fs
  .readdirSync(path.join(LOCALES, SOURCE))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .filter((ns) => !ONLY_NS || ONLY_NS.includes(ns));

const targets = Object.keys(DEEPL_TARGET).filter((l) => !ONLY_LANG || ONLY_LANG.includes(l));

const pluralTodo = [];
const placeholderFailures = [];
let translatedCount = 0;
let prunedCount = 0;

for (const lang of targets) {
  for (const ns of namespaces) {
    const srcPath = path.join(LOCALES, SOURCE, `${ns}.json`);
    const dstDir = path.join(LOCALES, lang);
    const dstPath = path.join(dstDir, `${ns}.json`);

    const src = flatten(JSON.parse(fs.readFileSync(srcPath, 'utf8')));
    const existing = fs.existsSync(dstPath)
      ? JSON.parse(fs.readFileSync(dstPath, 'utf8'))
      : {};
    const existingFlat = flatten(existing);

    // Prune keys English no longer has. Without this, renaming an English key
    // leaves the old one orphaned in all four locales and the parity test fails
    // on "extra" keys — drift the translator created and should clean up.
    const srcBases = new Set(Object.keys(src).map(pluralBase));
    const stale = Object.keys(existingFlat).filter((k) => !srcBases.has(pluralBase(k)));
    for (const k of stale) {
      deleteDeep(existing, k);
      prunedCount += 1;
    }

    const todo = Object.keys(src).filter((k) => FORCE || !(k in existingFlat));
    const plural = todo.filter(isPlural);
    const plain = todo.filter((k) => !isPlural(k));

    for (const k of plural) pluralTodo.push(`${lang}/${ns}: ${k}`);

    if (plain.length === 0) {
      if (stale.length && !DRY) {
        fs.mkdirSync(dstDir, { recursive: true });
        fs.writeFileSync(dstPath, `${JSON.stringify(sortDeep(existing), null, 2)}\n`, 'utf8');
      }
      console.log(
        stale.length
          ? `· ${lang}/${ns}: pruned ${stale.length} stale key(s)`
          : `· ${lang}/${ns}: nothing to do`,
      );
      continue;
    }

    console.log(`→ ${lang}/${ns}: translating ${plain.length} key(s)`);
    if (DRY) {
      for (const k of plain) console.log(`    ${k} = ${src[k]}`);
      continue;
    }

    // DeepL accepts up to 50 texts per request.
    const out = { ...existing };
    for (let i = 0; i < plain.length; i += 50) {
      const chunk = plain.slice(i, i + 50);
      const results = await deeplBatch(
        chunk.map((k) => src[k]),
        DEEPL_TARGET[lang],
      );
      chunk.forEach((k, j) => {
        // Seatbelt: a translation that lost or renamed a placeholder would
        // render as literal "{{count}}" in the UI. Keep English instead and
        // report it — a wrong-language label beats a broken one.
        if (placeholdersOf(results[j]).join() !== placeholdersOf(src[k]).join()) {
          placeholderFailures.push(`${lang}/${ns}: ${k}\n      en: ${src[k]}\n      ${lang}: ${results[j]}`);
          setDeep(out, k, src[k]);
          return;
        }
        setDeep(out, k, results[j]);
      });
      translatedCount += chunk.length;
    }

    fs.mkdirSync(dstDir, { recursive: true });
    fs.writeFileSync(dstPath, `${JSON.stringify(sortDeep(out), null, 2)}\n`, 'utf8');
  }
}

console.log(`\nTranslated ${translatedCount} string(s); pruned ${prunedCount} stale key(s).`);
if (placeholderFailures.length) {
  console.log(
    `\n⚠ ${placeholderFailures.length} translation(s) mangled a placeholder and were\n` +
      'left in English. Translate these by hand:\n',
  );
  for (const f of placeholderFailures) console.log(`  ${f}`);
}
if (pluralTodo.length) {
  console.log(
    `\n${pluralTodo.length} plural key(s) need a human — English's two forms can't\n` +
      'produce the categories these languages require:\n',
  );
  for (const p of pluralTodo) console.log(`  ${p}`);
  console.log('\nThe locale parity test will fail until they are written.');
}
