/**
 * The Words page's level browser: the parts that are not a rendered view.
 *
 * Two of the three things here are agreements with the backend rather than
 * behaviour. A tab whose id the endpoint does not accept is a 400 the user
 * reads as "the admin page is broken", and neither side's type system can see
 * the other — so the agreement is asserted against the Python source, the way
 * `pronounceCallSites` pins its contract.
 *
 * The third is `isUngraded`, which decides whether a row is flagged as never
 * having been graded. That flag is the reason the browser exists: on
 * 2026-09-06 the A2 band was 56% rows written by an old `fallback`/0.0
 * default, and a list without the flag would have shown them as ordinary
 * beginner words — exactly what the bar chart above it already did.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { CEFR_LEVELS } from '../../../types/constants';
import { WORD_BROWSE_LEVELS, WORD_SORT_TABS, isUngraded, levelColor } from '../WordsView';

const adminPanelsPy = readFileSync(
  join(__dirname, '../../../../../../backend/src/services/admin_panels.py'),
  'utf8',
);

/** Keys of a `NAME = { ... }` dict literal in the Python source. */
function pythonDictKeys(source: string, name: string): string[] {
  const body = source.split(`${name} = {`)[1]?.split('}')[0] ?? '';
  return [...body.matchAll(/"([a-z_]+)":/g)].map((m) => m[1]);
}

describe('level tabs', () => {
  it('offers every CEFR band plus the holding pen', () => {
    expect(WORD_BROWSE_LEVELS).toEqual([...CEFR_LEVELS, 'UNKNOWN']);
  });

  it('can open UNKNOWN, which is the band most worth reading', () => {
    // It is the pile #91 created and every backfill tries to drain. A browser
    // that skipped it would omit the one band whose contents are the question.
    expect(WORD_BROWSE_LEVELS).toContain('UNKNOWN');
  });

  it('matches the levels the endpoint will accept', () => {
    // backend: REGISTRY_LEVELS = [*CEFR_LEVELS, "UNKNOWN"], and words_by_level
    // rejects anything outside it.
    expect(adminPanelsPy).toContain('REGISTRY_LEVELS = [*CEFR_LEVELS, "UNKNOWN"]');
  });

  it('colours UNKNOWN off the CEFR ramp', () => {
    // It is not a difficulty band, so giving it a band colour would rank it
    // between C1 and C2 to anyone reading the chips.
    expect(levelColor('UNKNOWN', '#999')).toBe('#999');
    expect(levelColor('B2', '#999')).not.toBe('#999');
  });
});

describe('sort chips', () => {
  it('offers only sorts the endpoint implements', () => {
    const backendSorts = pythonDictKeys(adminPanelsPy, 'WORD_SORTS');

    expect(backendSorts.length).toBeGreaterThan(0);
    expect(WORD_SORT_TABS.map((t) => t.id).sort()).toEqual(backendSorts.sort());
  });

  it('defaults to the commonest words first', () => {
    // The question this page usually answers is "what does a learner at this
    // level actually meet", and that is frequency order.
    expect(WORD_SORT_TABS[0].id).toBe('frequency');
  });
});

describe('isUngraded', () => {
  it('flags the old A2 default: fallback with no confidence', () => {
    expect(isUngraded({ source: 'fallback', confidence: 0 })).toBe(true);
  });

  it('spares the deliberate whitelists, which are also fallback', () => {
    // The kids and informal-slang lists carry source='fallback' but real
    // confidence (0.95 / 0.85). Splitting on source alone would flag them,
    // and a flag that fires on correct rows stops being read.
    expect(isUngraded({ source: 'fallback', confidence: 0.95 })).toBe(false);
    expect(isUngraded({ source: 'fallback', confidence: 0.85 })).toBe(false);
  });

  it('spares a real classification that happens to be tentative', () => {
    // frequency_backoff at 0.35 is the classifier's genuine verdict on a rare
    // word — 10k rows of the registry look like this. Only `fallback` means
    // "nothing decided".
    expect(isUngraded({ source: 'frequency_backoff', confidence: 0.35 })).toBe(false);
    expect(isUngraded({ source: 'efllex', confidence: 1 })).toBe(false);
  });

  it('splits on the same 0.5 the SQL does', () => {
    // Mirrors trusted_registry_sql: `source = 'fallback' AND confidence < 0.5`.
    expect(isUngraded({ source: 'fallback', confidence: 0.49 })).toBe(true);
    expect(isUngraded({ source: 'fallback', confidence: 0.5 })).toBe(false);
  });

  it('agrees with the SQL predicate it mirrors', () => {
    const registryPy = readFileSync(
      join(__dirname, '../../../../../../backend/src/services/cefr_registry.py'),
      'utf8',
    );
    expect(registryPy).toContain("source = 'fallback' AND ");
    expect(registryPy).toContain('confidence < 0.5');
  });
});
