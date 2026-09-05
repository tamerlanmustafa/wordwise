/**
 * Sign-out forgets the person and keeps the phone.
 *
 * Two kinds of test here, and the second is the one that will still be earning
 * its keep in a year.
 *
 * The behavioural tests check that a sign-out actually clears the right keys.
 * The **source guard** checks that every storage key in `src/` has been
 * classified as the account's or the device's at all. That is the failure mode
 * this whole module exists for: nobody decided that `srs.reviewSession.v2`
 * should outlive a sign-out and be handed to the next account — it was never
 * a decision, just what happens when a key is written and forgotten. A list
 * you have to update is only as good as the thing that notices you didn't.
 */

import fs from 'fs';
import path from 'path';

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  ACCOUNT_KEYS,
  ACCOUNT_KEY_PREFIXES,
  DEVICE_KEYS,
  DEVICE_KEY_PREFIXES,
  clearAccountStorage,
  isAccountKey,
  resetAccountState,
} from '../accountState';

const SRC = path.resolve(__dirname, '../..');

/** Every .ts/.tsx file under src/, excluding tests. */
function sourceFiles(dir: string = SRC, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'test-utils') sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Storage keys declared or used in one file.
 *
 * Three shapes cover every call site in the app: a literal handed straight to
 * AsyncStorage; a `const SOMETHING_KEY = '...'`; and a key built by template,
 * `const bookmarkKey = \`movie_bookmark_${id}\``, whose static head is the
 * prefix the registry has to know about.
 *
 * A named constant only counts when it actually *reaches* AsyncStorage —
 * directly, or via a template that another key is built from. Without that
 * condition the scan picks up things that merely look like keys: the first
 * run of this guard flagged `spacing_first_repeat_v1`, which is a tip id
 * stored inside `tips.dismissed.v1` rather than a key of its own.
 */
function keysDeclaredIn(source: string): string[] {
  if (!source.includes('AsyncStorage')) return [];
  const found = new Set<string>();

  // 1. A literal passed straight in.
  const inline = /AsyncStorage\.\w+\(\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = inline.exec(source)) !== null) found.add(m[1]);

  // 2 & 3. Named constants, kept only when they are used as a key.
  const declared =
    /\b(?:const|let)\s+(\w*(?:key|prefix)\w*)\s*(?::[^=]+)?=\s*(?:'([^']+)'|`([^`$]*)\$\{)/gi;
  while ((m = declared.exec(source)) !== null) {
    const [, name, literal, templateHead] = m;
    const usedAsKey =
      new RegExp(`AsyncStorage\\.\\w+\\(\\s*${name}\\b`).test(source) ||
      new RegExp(`\\$\\{${name}\\}`).test(source);
    const value = literal ?? templateHead;
    if (usedAsKey && value) found.add(value);
  }
  return [...found];
}

describe('the storage keyspace is classified', () => {
  const classified = new Set([...ACCOUNT_KEYS, ...DEVICE_KEYS]);
  const prefixes = [...ACCOUNT_KEY_PREFIXES, ...DEVICE_KEY_PREFIXES];
  const isClassified = (key: string) =>
    classified.has(key) || prefixes.some((p) => key.startsWith(p) || p.startsWith(key));

  it('has every key in src/ listed as the account’s or the device’s', () => {
    const unclassified: string[] = [];
    for (const file of sourceFiles()) {
      // The registry itself is the list; it would match all of its own entries.
      if (file.endsWith('accountState.ts')) continue;
      for (const key of keysDeclaredIn(fs.readFileSync(file, 'utf8'))) {
        if (!isClassified(key)) unclassified.push(`${path.relative(SRC, file)} → '${key}'`);
      }
    }
    // A new key is not a failure of this test; it is a decision nobody has
    // made yet. Add it to ACCOUNT_KEYS or DEVICE_KEYS in services/accountState.
    expect(unclassified).toEqual([]);
  });

  it('is actually finding keys', () => {
    // A scanner that matches nothing passes every assertion above it. This is
    // the canary: if a regex here is broken by a refactor, the guard goes
    // quiet rather than red, which is the one way a source guard fails
    // uselessly. The floor tracks the real count, which fell to 30 when the
    // Word of the Hour and review reminders were retired and the auto-collapse
    // toggle removed — four keys nothing writes any more.
    const seen = new Set<string>();
    for (const file of sourceFiles()) {
      if (file.endsWith('accountState.ts')) continue;
      keysDeclaredIn(fs.readFileSync(file, 'utf8')).forEach((k) => seen.add(k));
    }
    expect(seen.size).toBeGreaterThanOrEqual(30);
    expect(seen).toContain('srs.reviewSession.v2');
    expect(seen).toContain('movie_bookmark_'); // the template-built family
  });

  it('does not classify the same key both ways', () => {
    const both = ACCOUNT_KEYS.filter((k) => DEVICE_KEYS.includes(k));
    expect(both).toEqual([]);
  });
});

describe('isAccountKey', () => {
  it('recognises the exact keys', () => {
    expect(isAccountKey('srs.reviewSession.v2')).toBe(true);
    expect(isAccountKey('onboarding.v1')).toBe(true);
  });

  it('recognises the prefix families, which cannot be enumerated', () => {
    expect(isAccountKey('movie_bookmark_812')).toBe(true);
    expect(isAccountKey('practice.path.cursor.v2:7')).toBe(true);
    expect(isAccountKey('swr_movies_page_2')).toBe(true);
  });

  it('leaves the phone’s own settings alone', () => {
    // Clearing these would be its own bug: signing out and back in must not
    // reset your theme or replay the splash.
    for (const key of DEVICE_KEYS) expect(isAccountKey(key)).toBe(false);
    expect(isAccountKey('word_of_hour_v1:2026-09-04T12:es:skip0')).toBe(false);
  });
});

describe('clearAccountStorage', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('removes the previous account’s data', async () => {
    await AsyncStorage.setItem('srs.reviewSession.v2', '{"deck":1}');
    await AsyncStorage.setItem('journey.dailyGoal.v1', '{"streak":9}');
    await AsyncStorage.setItem('movie_bookmark_42', '{"line":10}');

    await clearAccountStorage();

    expect(await AsyncStorage.getItem('srs.reviewSession.v2')).toBeNull();
    expect(await AsyncStorage.getItem('journey.dailyGoal.v1')).toBeNull();
    expect(await AsyncStorage.getItem('movie_bookmark_42')).toBeNull();
  });

  it('keeps the phone’s settings', async () => {
    await AsyncStorage.setItem('wordwise.theme.v1', 'dark');
    await AsyncStorage.setItem('notif_review', 'off');

    await clearAccountStorage();

    expect(await AsyncStorage.getItem('wordwise.theme.v1')).toBe('dark');
    expect(await AsyncStorage.getItem('notif_review')).toBe('off');
  });

  it('clears the pre-migration practice cursor too', async () => {
    // It is un-scoped by definition — that was the bug — so an install that
    // signs out before it has synced must not hand it to the next account.
    await AsyncStorage.setItem('practice.path.cursor.v1', '{"cursor":34}');

    await clearAccountStorage();

    expect(await AsyncStorage.getItem('practice.path.cursor.v1')).toBeNull();
  });

  it('does not throw when storage is unavailable', async () => {
    // A failed wipe must not strand the user in a session they asked to end.
    const spy = jest.spyOn(AsyncStorage, 'getAllKeys').mockRejectedValue(new Error('nope'));
    await expect(clearAccountStorage()).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

describe('resetAccountState', () => {
  it('empties the in-memory stores as well as storage', async () => {
    // The half the user actually sees: these stores are singletons that
    // outlive a sign-out and mostly refuse to re-hydrate once `hydrated` is
    // true, so clearing AsyncStorage alone would leave the previous account's
    // deck and streak on screen until the app was killed.
    const { useDailyGoalStore } = require('../../stores/dailyGoalStore');
    const { useWordFeedStore } = require('../../stores/wordFeedStore');
    const { usePracticePathStore } = require('../../stores/practicePathStore');

    useDailyGoalStore.setState({ streak: 12, done: 3, hydrated: true });
    useWordFeedStore.setState({ items: [{ lemma_id: 1 }], hydrated: true });
    usePracticePathStore.setState({ cursor: 34, hydrated: true });

    await resetAccountState();

    expect(useDailyGoalStore.getState().streak).toBe(0);
    expect(useDailyGoalStore.getState().hydrated).toBe(false);
    expect(useWordFeedStore.getState().items).toEqual([]);
    expect(usePracticePathStore.getState().cursor).toBe(0);
  });

  it('survives one store throwing without skipping the rest', async () => {
    const { useDailyGoalStore } = require('../../stores/dailyGoalStore');
    const { useListsStore } = require('../../stores/listsStore');
    const boom = jest.spyOn(useListsStore.getState(), 'reset').mockImplementation(() => {
      throw new Error('boom');
    });
    useDailyGoalStore.setState({ streak: 7 });

    await resetAccountState();

    expect(useDailyGoalStore.getState().streak).toBe(0);
    boom.mockRestore();
  });
});
