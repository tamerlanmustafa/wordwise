/**
 * Source-level guards against the two i18n regressions that no runtime test
 * can catch, because both produce *plausible* output rather than an error:
 *
 *  1. `toLocaleString()` with no argument formats using the DEVICE locale, so a
 *     Spanish-UI user on an English phone silently gets English number and date
 *     formatting. Nothing throws; the screen just looks subtly wrong.
 *
 *  2. A raw English string added to a component that already imports `t` is
 *     invisible until someone runs the app in another language.
 *
 * Scanning source is crude, but it is the only thing that runs on every push.
 * Admin screens are exempt throughout — they are deliberately English-only
 * (see I18N_PLAN.md §2), so device formatting there is not a bug.
 */

import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', '..');

/** Files that are deliberately English and so exempt from these guards. */
const EXEMPT = [
  path.join('components', 'AdminScreen.tsx'),
  path.join('components', 'admin') + path.sep,
  path.join('components', 'PrivacyScreen.tsx'), // legal copy — see issue #100
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'i18n') sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const FILES = sourceFiles(SRC).filter((f) => {
  const rel = path.relative(SRC, f);
  return !EXEMPT.some((e) => rel.startsWith(e) || rel === e);
});

describe('locale-aware formatting', () => {
  it('never calls toLocale*() without an explicit locale', () => {
    // `getFormattingLocale()` from src/i18n returns the active app language.
    const bare = /\.toLocale(?:String|DateString|TimeString)\(\s*\)/;
    const bareCompare = /\.localeCompare\([^,)]*\)/;

    const offenders: string[] = [];
    for (const file of FILES) {
      const src = fs.readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        if (line.trim().startsWith('*') || line.trim().startsWith('//')) return;
        if (bare.test(line) || bareCompare.test(line)) {
          offenders.push(`${path.relative(SRC, file)}:${i + 1}  ${line.trim().slice(0, 80)}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});

describe('no raw English left in localized components', () => {
  // A file that imports `t` has been through extraction, so any remaining
  // literal JSX text or user-facing prop in it is an oversight, not a to-do.
  // Requires a space or end-of-tag before the text so TypeScript generics and
  // arrow-function return types (`() => Promise<void>;`) don't read as JSX.
  const RAW_JSX = /<\/?[A-Za-z][^<>]*>\s*[A-Z][A-Za-z][^<>{}\n]{2,}\s*<\//;
  const RAW_PROP =
    /\b(?:placeholder|accessibilityLabel|accessibilityHint|ctaLabel|eyebrow)\s*=\s*"[A-Za-z][^"]{2,}"/;
  const RAW_ALERT = /Alert\.alert\(\s*['"][A-Za-z]/;

  it('has no literal user-facing strings in files that use t()', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const src = fs.readFileSync(file, 'utf8');
      if (!src.includes('useTranslation') && !src.includes("from '../i18n'")) continue;
      // Brand and product names are never translated.
      const stripped = src.replace(/WordWise|Anki|Google|Apple|TMDB/g, '');

      stripped.split('\n').forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('*') || trimmed.startsWith('//')) return;
        if (RAW_JSX.test(line) || RAW_PROP.test(line) || RAW_ALERT.test(line)) {
          offenders.push(`${path.relative(SRC, file)}:${i + 1}  ${trimmed.slice(0, 80)}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
