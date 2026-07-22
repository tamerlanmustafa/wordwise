import {
  COVERAGE_CATEGORIES,
  METRIC_EXPLANATIONS,
  explanationFor,
  formatMetricValue,
  formatTrend,
  groupMetricsByCategory,
  meterGeometry,
  statusCounts,
  worstStatus,
} from '../vocabCoverageContent';
import type { VocabCoverageMetric } from '../../../services/api';

const metric = (over: Partial<VocabCoverageMetric> & { key: string }): VocabCoverageMetric => ({
  label: over.key,
  value: 0,
  unit: 'rows',
  status: 'ok',
  threshold: '',
  warn_at: null,
  fail_at: null,
  direction: 'max',
  max_value: null,
  ...over,
});

describe('groupMetricsByCategory', () => {
  it('groups metrics into their declared category and order', () => {
    const metrics = [
      metric({ key: 'uncovered_visible_lemmas' }),
      metric({ key: 'llm_cost_last_24h' }),
      metric({ key: 'usage_weighted_sentence_coverage' }),
    ];
    const sections = groupMetricsByCategory(metrics);
    const coverage = sections.find((s) => s.category.id === 'coverage');
    // Declared order wins over the order the server sent them in.
    expect(coverage?.metrics.map((m) => m.key)).toEqual([
      'usage_weighted_sentence_coverage',
      'uncovered_visible_lemmas',
    ]);
    expect(sections.find((s) => s.category.id === 'cost')?.metrics).toHaveLength(1);
  });

  it('drops categories with no matching metrics', () => {
    const sections = groupMetricsByCategory([metric({ key: 'llm_cost_last_24h' })]);
    expect(sections.map((s) => s.category.id)).toEqual(['cost']);
  });

  it('never loses a metric the app does not know about', () => {
    // Guards the case where the backend adds a metric before the app ships a
    // category for it — it must still be visible, not silently dropped.
    const sections = groupMetricsByCategory([
      metric({ key: 'usage_weighted_sentence_coverage' }),
      metric({ key: 'brand_new_server_metric' }),
    ]);
    const other = sections.find((s) => s.category.id === 'other');
    expect(other?.metrics.map((m) => m.key)).toEqual(['brand_new_server_metric']);
  });

  it('returns nothing for an empty metric list', () => {
    expect(groupMetricsByCategory([])).toEqual([]);
  });
});

describe('category + explanation copy', () => {
  it('every categorised key has a plain-language explanation', () => {
    for (const category of COVERAGE_CATEGORIES) {
      for (const key of category.keys) {
        expect(METRIC_EXPLANATIONS[key]).toBeTruthy();
      }
    }
  });

  it('falls back rather than showing undefined for an unknown key', () => {
    expect(explanationFor('nope')).toMatch(/no description/i);
  });

  it('uses no category key twice', () => {
    const all = COVERAGE_CATEGORIES.flatMap((c) => c.keys);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('statusCounts / worstStatus', () => {
  it('counts each status', () => {
    const counts = statusCounts([
      metric({ key: 'a', status: 'ok' }),
      metric({ key: 'b', status: 'warn' }),
      metric({ key: 'c', status: 'warn' }),
      metric({ key: 'd', status: 'fail' }),
    ]);
    expect(counts).toEqual({ ok: 1, warn: 2, fail: 1 });
  });

  it('rolls up to the worst status present', () => {
    expect(worstStatus([metric({ key: 'a', status: 'ok' })])).toBe('ok');
    expect(
      worstStatus([metric({ key: 'a', status: 'ok' }), metric({ key: 'b', status: 'warn' })])
    ).toBe('warn');
    expect(
      worstStatus([metric({ key: 'a', status: 'fail' }), metric({ key: 'b', status: 'warn' })])
    ).toBe('fail');
    expect(worstStatus([])).toBe('ok');
  });
});

describe('meterGeometry', () => {
  it('returns null for an unbounded count so it renders as a stat tile', () => {
    expect(meterGeometry(metric({ key: 'uncovered_visible_lemmas', value: 69317 }))).toBeNull();
  });

  it('scales value and threshold markers against max_value', () => {
    const geo = meterGeometry(
      metric({
        key: 'usage_weighted_sentence_coverage',
        value: 93.9,
        unit: '%',
        warn_at: 90,
        fail_at: 80,
        direction: 'min',
        max_value: 100,
      })
    );
    expect(geo).toEqual({ fillPct: 93.9, warnPct: 90, failPct: 80 });
  });

  it('scales cost against the cap rather than 100', () => {
    const geo = meterGeometry(
      metric({
        key: 'llm_cost_last_24h',
        value: 15,
        unit: '$',
        warn_at: 24,
        fail_at: 30,
        direction: 'max',
        max_value: 30,
      })
    );
    expect(geo?.fillPct).toBe(50);
    expect(geo?.failPct).toBe(100);
  });

  it('clamps a value that overshoots its max', () => {
    const geo = meterGeometry(
      metric({ key: 'llm_cost_last_24h', value: 45, max_value: 30, direction: 'max' })
    );
    expect(geo?.fillPct).toBe(100);
  });

  it('treats a null value (n/a) as an empty track, not a crash', () => {
    const geo = meterGeometry(
      metric({ key: 'word_sentence_gloss_share', value: null, max_value: 100 })
    );
    expect(geo?.fillPct).toBe(0);
  });

  it('returns null for a nonsensical max so we never divide by zero', () => {
    expect(meterGeometry(metric({ key: 'x', value: 5, max_value: 0 }))).toBeNull();
  });
});

describe('formatMetricValue', () => {
  it('formats percents, dollars and counted units', () => {
    expect(formatMetricValue(metric({ key: 'a', value: 93.9, unit: '%' }))).toBe('93.9%');
    expect(formatMetricValue(metric({ key: 'b', value: 0, unit: '$' }))).toBe('$0');
    expect(formatMetricValue(metric({ key: 'c', value: 69317, unit: 'lemmas' }))).toBe(
      '69,317 lemmas'
    );
  });

  it('shows an em dash when the metric is not applicable', () => {
    expect(formatMetricValue(metric({ key: 'a', value: null, unit: '%' }))).toBe('—');
  });
});

describe('formatTrend', () => {
  it('is null without a prior snapshot to compare against', () => {
    expect(formatTrend(metric({ key: 'a' }))).toBeNull();
  });

  it('is null when nothing moved', () => {
    expect(formatTrend(metric({ key: 'a', delta: 0 }))).toBeNull();
  });

  it('reads a rise as bad when lower is better', () => {
    // noop_translations climbing is a regression.
    const t = formatTrend(metric({ key: 'noop_translations', delta: 7, direction: 'max' }));
    expect(t).toEqual({ text: '▲ 7 since last snapshot', good: false });
  });

  it('reads a fall as good when lower is better', () => {
    const t = formatTrend(metric({ key: 'uncovered_visible_lemmas', delta: -1200, direction: 'max' }));
    expect(t?.good).toBe(true);
    expect(t?.text).toBe('▼ 1,200 since last snapshot');
  });

  it('reads a rise as good when higher is better', () => {
    const t = formatTrend(
      metric({ key: 'usage_weighted_sentence_coverage', delta: 1.5, direction: 'min' })
    );
    expect(t).toEqual({ text: '▲ 1.50 since last snapshot', good: true });
  });
});
