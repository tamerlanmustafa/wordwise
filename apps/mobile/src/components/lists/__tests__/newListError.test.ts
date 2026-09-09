/**
 * What the reader is told when a list cannot be created.
 *
 * Two refusals are the user's to act on, and only one of them had words. The
 * other — hitting the 50-per-kind cap — fell through to the server's own
 * sentence, "You can have at most 50 words lists": English however the app is
 * set, and written for whoever reads the logs. A localised app that prints
 * raw API English at its one refusal point is worse than one that never
 * translated anything, because the seam only shows where it hurts.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { newListErrorKey } from '../newListError';

describe('newListErrorKey', () => {
  it('has words for a duplicate name', () => {
    expect(newListErrorKey('duplicate_name')).toBe('new.errorDuplicate');
  });

  it('has words for the list cap', () => {
    // The one that was missing.
    expect(newListErrorKey('list_limit_reached')).toBe('new.errorLimit');
  });

  it('declines the codes it has no words for', () => {
    // `null` means "fall back to the raw message", which is unhelpful but
    // never silent — the right behaviour for an unexpected 500.
    expect(newListErrorKey('some_future_code')).toBeNull();
    expect(newListErrorKey(undefined)).toBeNull();
    expect(newListErrorKey(null)).toBeNull();
    expect(newListErrorKey(500)).toBeNull();
  });

  it('names keys that exist in the bundled copy', () => {
    // A missing key renders as the key itself, which is how
    // "new.errorLimit" ends up on a user's screen.
    /* eslint-disable @typescript-eslint/no-var-requires */
    const lists = require('../../../i18n/locales/en/lists.json');
    for (const code of ['duplicate_name', 'list_limit_reached']) {
      const key = newListErrorKey(code)!.replace('new.', '');
      expect(lists.new[key]).toBeTruthy();
    }
  });

  it('states no cap number, so the copy cannot go stale', () => {
    // The limit lives in `services/lists.MAX_LISTS_PER_KIND` and the error
    // carries a code, not a number — hardcoding 50 here would be a second
    // source of truth that silently drifts the day the cap moves.
    const lists = require('../../../i18n/locales/en/lists.json');
    expect(lists.new.errorLimit).not.toMatch(/\d/);
  });

  it('tells the reader what to do about it', () => {
    // "You've reached the maximum" alone is a dead end. The sentence that
    // matters is the next one.
    const lists = require('../../../i18n/locales/en/lists.json');
    expect(lists.new.errorLimit.toLowerCase()).toContain('delete');
  });
});

/**
 * The index is windowed, and must stay windowed.
 *
 * Not because of the row count — 50 rows of text would be fine — but because
 * a films row draws a `PosterFan` of up to three remote TMDB images. At the
 * 50-per-kind cap a plain `ScrollView` mounted up to 150 image requests the
 * instant the tab opened, ~147 of them for rows nobody had scrolled to.
 *
 * This is the kind of regression that reintroduces itself innocently: a
 * `ScrollView` is the obvious container for a short list, and the cost is
 * invisible on a test account with two lists.
 */
describe('the Lists index does not mount every row', () => {
  const raw = readFileSync(
    join(__dirname, '..', '..', 'screens', 'ListsIndexScreen.tsx'),
    'utf8',
  );
  // Comments first, or the guard trips on the prose explaining itself — the
  // file says the word `getItemLayout` precisely to record why it is absent.
  const source = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('renders through a FlatList, not a ScrollView', () => {
    expect(source).toContain('<FlatList');
    expect(source).not.toContain('<ScrollView');
    expect(source).not.toContain("ScrollView,");
  });

  it('caps what it mounts before the first scroll', () => {
    expect(source).toContain('initialNumToRender={INITIAL_ROWS}');
    expect(source).toContain('windowSize=');
  });

  it('does not claim rows are a fixed height', () => {
    // An empty pinned list carries an instruction line underneath it, so two
    // rows in every list are taller than the rest. `getItemLayout` with a
    // constant would misplace everything after them — measuring costs a
    // frame, wrong offsets cost correctness.
    expect(source).not.toContain('getItemLayout');
  });
});
