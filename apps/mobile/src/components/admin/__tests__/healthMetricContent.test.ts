/**
 * The metric formatting, geometry and status rollup shared by every
 * /admin/health/* view. Split out of vocabCoverageContent (with these tests)
 * when the latency report started using them, so both reports are guaranteed
 * to render a metric the same way.
 */
import {
  formatMetricValue,
  meterGeometry,
  statusCounts,
  worstStatus,
} from '../healthMetricContent';
import type { HealthMetric } from '../../../services/api';

const metric = (over: Partial<HealthMetric> & { key: string }): HealthMetric => ({
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

// ── added with the latency report ────────────────────────────────────────────

describe('shared across health reports', () => {
  it('formats a duration metric, which only the latency report sends', () => {
    expect(formatMetricValue(metric({ key: 'overall_p95_ms', value: 197, unit: 'ms' }))).toBe(
      '197 ms'
    );
  });

  it('rolls up anything carrying a status, not just metrics', () => {
    // The latency view rolls up its route rows with the same helper.
    expect(worstStatus([{ status: 'ok' }, { status: 'fail' }])).toBe('fail');
  });
});
