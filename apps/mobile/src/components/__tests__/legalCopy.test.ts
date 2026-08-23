/**
 * Source-level guards on the store-facing legal copy (issue #100b).
 *
 * The privacy policy and terms exist twice — `PrivacyScreen.tsx` in the app and
 * the public pages under `frontend/` that both app stores link to — and the two
 * copies drifted: for months they printed `privacy@wordwise.app` while the
 * account-deletion flow told people to write to `privacy@getwordwise.us`. A user
 * exercising a GDPR deletion right by the address in the policy was writing to a
 * domain with no MX record at all, and nothing failed loudly enough to notice.
 *
 * These are text scans because `frontend/` is frozen (no test runner) and mobile
 * tests never render components — so the only thing that runs on every push is
 * reading the files. Crude, but it is what catches the next edit that updates one
 * copy of a document and forgets the other.
 */

import fs from 'fs';
import path from 'path';

const REPO = path.join(__dirname, '..', '..', '..', '..', '..');

/** The only domain the project actually controls. `wordwise.app` is not ours. */
const CONTACT_DOMAIN = 'getwordwise.us';

/**
 * Every file that renders legal or deletion copy a store reviewer or a user
 * exercising a data right will read.
 */
const LEGAL_FILES = [
  path.join('apps', 'mobile', 'src', 'components', 'PrivacyScreen.tsx'),
  path.join('frontend', 'src', 'pages', 'PrivacyPage.tsx'),
  path.join('frontend', 'src', 'pages', 'TermsPage.tsx'),
  path.join('frontend', 'src', 'pages', 'DeleteAccountPage.tsx'),
];

/** Source trees that can contain user-facing copy. */
const USER_FACING_TREES = [
  path.join('apps', 'mobile', 'src'),
  path.join('frontend', 'src'),
];

function read(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), 'utf8');
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // `__tests__` is exempt for the same reason as in i18n/sourceGuards: this
      // file has to name the dead address in order to ban it.
      if (entry.name !== 'node_modules' && entry.name !== '__tests__') sourceFiles(full, out);
    } else if (/\.(tsx?|jsx?|json)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Requires a local part before the `@`, so the Android package id
 * `com.wordwise.app` and the storage key `wordwise.appLanguage.v1` don't match.
 */
const DEAD_ADDRESS = /[\w.+-]+@wordwise\.app\b/g;
const ANY_ADDRESS = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

describe('legal contact addresses', () => {
  it('never prints an @wordwise.app address in user-facing source', () => {
    const offenders: string[] = [];
    for (const tree of USER_FACING_TREES) {
      for (const file of sourceFiles(path.join(REPO, tree))) {
        const src = fs.readFileSync(file, 'utf8');
        src.split('\n').forEach((line, i) => {
          if (DEAD_ADDRESS.test(line)) {
            offenders.push(`${path.relative(REPO, file)}:${i + 1}  ${line.trim().slice(0, 90)}`);
          }
          DEAD_ADDRESS.lastIndex = 0;
        });
      }
    }

    expect(offenders).toEqual([]);
  });

  it.each(LEGAL_FILES)('%s contacts only @' + CONTACT_DOMAIN, (rel) => {
    const addresses = read(rel).match(ANY_ADDRESS) ?? [];

    // A legal document with no way to reach anyone is its own defect.
    expect(addresses.length).toBeGreaterThan(0);
    for (const address of addresses) {
      expect(address.endsWith(`@${CONTACT_DOMAIN}`)).toBe(true);
    }
  });
});

describe('legal document metadata', () => {
  const DATED = LEGAL_FILES.filter((rel) => read(rel).includes('Last updated:'));

  it('dates every document that carries a date, identically across both apps', () => {
    // The app and the web pages publish the same two documents. One "Last
    // updated" moving without the other means a reviewer and a user are being
    // shown different revisions of the same policy.
    const dates = new Set<string>();
    for (const rel of DATED) {
      for (const match of read(rel).matchAll(/Last updated:\s*([^<\n]+)/g)) {
        dates.add(match[1].trim());
      }
    }

    expect(DATED.length).toBeGreaterThan(0);
    expect([...dates]).toHaveLength(1);
  });

  it.each(DATED)('%s states that the English version is authoritative', (rel) => {
    // Keeping the documents English-only is a defensible position only if they
    // say so — see issue #100 half 1, which stays deferred. JSX wraps the
    // sentence across lines, so match against collapsed whitespace.
    const src = read(rel).replace(/\s+/g, ' ');
    const clauses = src.match(/the English version is authoritative/g) ?? [];

    // PrivacyScreen.tsx holds both documents, so it needs the clause twice.
    const documents = (src.match(/Last updated:/g) ?? []).length;
    expect(clauses).toHaveLength(documents);
  });
});
