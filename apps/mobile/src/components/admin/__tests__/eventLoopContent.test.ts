import {
  ATTRIBUTION_NOTE,
  EVENT_LOOP_EXPLANATIONS,
  describeStall,
  explanationForEventLoopMetric,
  formatAgo,
  stallBarPct,
  windowSummary,
} from '../eventLoopContent';
import type { EventLoopStall } from '../../../services/api';

const NOW = new Date('2026-08-18T12:00:00Z').getTime();

const stall = (over: Partial<EventLoopStall> = {}): EventLoopStall => ({
  at: new Date(NOW - 60_000).toISOString(),
  lag_ms: 300,
  severity: 'stall',
  ...over,
});

describe('formatAgo', () => {
  it('answers "just now or before the last deploy" rather than printing a clock', () => {
    expect(formatAgo(new Date(NOW - 20_000).toISOString(), NOW)).toBe('20s ago');
    expect(formatAgo(new Date(NOW - 25 * 60_000).toISOString(), NOW)).toBe('25 min ago');
    expect(formatAgo(new Date(NOW - 5 * 3600_000).toISOString(), NOW)).toBe('5 h ago');
    expect(formatAgo(new Date(NOW - 3 * 86400_000).toISOString(), NOW)).toBe('3 d ago');
  });

  it('never renders a negative age from a clock skew between phone and server', () => {
    expect(formatAgo(new Date(NOW + 30_000).toISOString(), NOW)).toBe('0s ago');
  });

  it('falls back to the raw value rather than "NaN ago" on a malformed stamp', () => {
    expect(formatAgo('not-a-date', NOW)).toBe('not-a-date');
  });
});

describe('describeStall', () => {
  it('says who else waited, not just how long it took', () => {
    // The misreading this screen exists to prevent is "one slow request".
    const text = describeStall(stall({ lag_ms: 300 }), NOW);
    expect(text).toContain('every request waited');
    expect(text).toContain('300 ms');
    expect(text).toContain('1 min ago');
  });

  it('calls out a stall long enough for a user to see the app hang', () => {
    const text = describeStall(stall({ lag_ms: 7860, severity: 'severe' }), NOW);
    expect(text).toContain('7.9 s');
    expect(text).toContain('hang');
  });
});

describe('stallBarPct', () => {
  it('scales against the worst stall on screen', () => {
    expect(stallBarPct(stall({ lag_ms: 7860 }), 7860)).toBe(100);
    expect(stallBarPct(stall({ lag_ms: 3930 }), 7860)).toBe(50);
  });

  it('keeps a small stall visible instead of collapsing it to nothing', () => {
    expect(stallBarPct(stall({ lag_ms: 120 }), 7860)).toBe(4);
  });

  it('is safe when nothing has been recorded', () => {
    expect(stallBarPct(stall({ lag_ms: 0 }), 0)).toBe(0);
  });
});

describe('windowSummary', () => {
  it('states the window and that a deploy resets it, so green is read in context', () => {
    const text = windowSummary(
      {
        window_started_at: new Date(NOW - 45 * 60_000).toISOString(),
        probe_interval_ms: 50,
        stall_threshold_ms: 100,
        recent_stalls: [],
      },
      NOW
    );
    expect(text).toContain('every 50 ms');
    expect(text).toContain('45 min');
    expect(text).toContain('100 ms');
    expect(text).toContain('Deploying resets this');
  });

  it('rolls up to hours on a long-lived instance', () => {
    const text = windowSummary(
      {
        window_started_at: new Date(NOW - 5 * 3600_000).toISOString(),
        probe_interval_ms: 50,
        stall_threshold_ms: 100,
        recent_stalls: [],
      },
      NOW
    );
    expect(text).toContain('5 h');
  });
});

describe('explanationForEventLoopMetric', () => {
  it('explains every metric the endpoint returns', () => {
    for (const key of [
      'loop_lag_p99_ms',
      'worst_stall_ms',
      'stall_rate_per_min',
      'stalled_time_pct',
      'watchdog_probes',
    ]) {
      expect(EVENT_LOOP_EXPLANATIONS[key]).toBeTruthy();
      expect(explanationForEventLoopMetric(key)).toBe(EVENT_LOOP_EXPLANATIONS[key]);
    }
  });

  it('falls back rather than rendering "undefined" for a metric we do not know', () => {
    expect(explanationForEventLoopMetric('some_future_metric')).toMatch(/No description/);
  });
});

describe('ATTRIBUTION_NOTE', () => {
  it('states the limitation on the screen, not only in the docs', () => {
    // Lag says *that* the loop stalled, never *which handler did it* — the
    // number cannot contain that, and someone will try to read it out anyway.
    expect(ATTRIBUTION_NOTE).toContain('never which request did it');
    expect(ATTRIBUTION_NOTE).toContain('every unrelated endpoint slow');
  });
});
