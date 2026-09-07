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
import {
  EXCLUSION_LABELS,
  SAFETY_FILTERS,
  WORD_BROWSE_LEVELS,
  WORD_FILTER_TABS,
  WORD_SORT_TABS,
  countLine,
  isUngraded,
  levelColor,
} from '../WordsView';

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

  it('offers both ends of the frequency ordering', () => {
    const ids = WORD_SORT_TABS.map((t) => t.id);
    expect(ids).toContain('frequency');
    expect(ids).toContain('rarest');
  });

  it('defaults to the commonest words first', () => {
    // The question this page usually answers is "what does a learner at this
    // level actually meet", and that is frequency order.
    expect(WORD_SORT_TABS[0].id).toBe('frequency');
  });
});

describe('filter chips', () => {
  it('offers exactly the filters the endpoint implements', () => {
    const body = adminPanelsPy.split('WORD_FILTERS = (')[1]?.split(')')[0] ?? '';
    const backend = [...body.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

    expect(backend.length).toBeGreaterThan(3);
    expect(WORD_FILTER_TABS.map((t) => t.id).sort()).toEqual(backend.sort());
  });

  it('defaults to what a learner can see', () => {
    // The registry is 1.6x the servable set, so the raw list overstates every
    // band. The first chip is the default, and it answers the real question.
    expect(WORD_FILTER_TABS[0].id).toBe('learner');
  });

  it('keeps a way to see the removed words', () => {
    // Without this the page becomes a mirror of the app and is blind, by
    // construction, to the class of bug it was built to expose.
    expect(WORD_FILTER_TABS.map((t) => t.id)).toContain('removed');
  });

  it('groups the chips so eleven of them stay scannable', () => {
    // Each group must be contiguous, or the dividers land mid-group.
    const groups = WORD_FILTER_TABS.map((t) => t.group);
    expect([...new Set(groups)]).toEqual([...new Set(groups)].filter(Boolean));
    const firstIndex = new Map<string, number>();
    const lastIndex = new Map<string, number>();
    groups.forEach((g, i) => {
      if (!firstIndex.has(g)) firstIndex.set(g, i);
      lastIndex.set(g, i);
    });
    for (const g of firstIndex.keys()) {
      const span = lastIndex.get(g)! - firstIndex.get(g)! + 1;
      expect(groups.filter((x) => x === g).length).toBe(span);
    }
  });

  it('treats the offensive-word checks as their own group', () => {
    // They are not subsets of "removed": they ask whether anything we refuse
    // to teach is still reachable, which is a bug report, not a statistic.
    expect(SAFETY_FILTERS).toEqual(['slur', 'profane']);
  });

  it('gives every chip a blurb saying what it selects', () => {
    for (const tab of WORD_FILTER_TABS) {
      expect(tab.blurb.length).toBeGreaterThan(20);
      expect(tab.label.length).toBeGreaterThan(0);
    }
  });
});

describe('countLine', () => {
  it('reconciles the chip count with the list for the default view', () => {
    expect(countLine('learner', 1618, 1930)).toBe(
      '1,618 of 1,930 reach a learner · 312 removed',
    );
  });

  it('drops the removed clause when nothing was removed', () => {
    expect(countLine('learner', 500, 500)).toBe('500 of 500 reach a learner');
  });

  it('does not claim a subset when showing everything', () => {
    expect(countLine('all', 1930, 1930)).toBe('1,930 in the registry');
  });

  it('states the complement plainly', () => {
    expect(countLine('removed', 312, 1930)).toBe('312 of 1,930 never reach a learner');
  });

  it('falls back to a band-relative count for the single-cause filters', () => {
    expect(countLine('hidden', 131, 1930)).toBe('131 of 1,930 in this band');
    expect(countLine('slur', 0, 1930)).toBe('0 of 1,930 in this band');
  });
});

describe('exclusion labels', () => {
  it('names every reason the endpoint can return', () => {
    const body = adminPanelsPy.split('def excluded_reason_sql')[1]?.split('\ndef ')[0] ?? '';
    const backend = [...body.matchAll(/THEN '([a-z_]+)'/g)].map((m) => m[1]);

    expect(backend.length).toBeGreaterThan(0);
    expect(Object.keys(EXCLUSION_LABELS).sort()).toEqual([...new Set(backend)].sort());
  });

  it('says what happened, not which column was read', () => {
    // An admin reading "no_sentence" has to know the schema; "no sentence yet"
    // says the same thing and also says it is temporary.
    for (const label of Object.values(EXCLUSION_LABELS)) {
      expect(label).not.toMatch(/_/);
    }
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
