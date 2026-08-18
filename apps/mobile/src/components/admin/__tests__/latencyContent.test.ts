import {
  LATENCY_EXPLANATIONS,
  ROUTE_SORTS,
  explanationForLatencyMetric,
  formatCount,
  formatMs,
  routeBarPct,
  sortRoutes,
  windowSummary,
} from '../latencyContent';
import type { LatencyRoute } from '../../../services/api';

const route = (over: Partial<LatencyRoute> & { route: string }): LatencyRoute => ({
  method: 'GET',
  count: 100,
  sampled: 100,
  p50_ms: 10,
  p95_ms: 20,
  p99_ms: 30,
  max_ms: 40,
  avg_ms: 12,
  server_errors: 0,
  client_errors: 0,
  server_error_rate: 0,
  status: 'ok',
  ...over,
});

describe('formatMs', () => {
  it('keeps sub-10ms readable and switches to seconds when it matters', () => {
    expect(formatMs(0.4)).toBe('0.4 ms');
    expect(formatMs(9.55)).toBe('9.6 ms');
    expect(formatMs(197)).toBe('197 ms');
    expect(formatMs(1200)).toBe('1.2 s');
    // The 21 s vocabulary endpoint from the perf analysis.
    expect(formatMs(21000)).toBe('21 s');
  });

  it('renders a missing measurement as a dash rather than NaN', () => {
    expect(formatMs(null)).toBe('—');
    expect(formatMs(undefined)).toBe('—');
  });
});

describe('formatCount', () => {
  it('abbreviates so long route rows do not wrap', () => {
    expect(formatCount(42)).toBe('42');
    expect(formatCount(1500)).toBe('1.5k');
    expect(formatCount(24000)).toBe('24k');
    expect(formatCount(2_400_000)).toBe('2.4M');
  });
});

describe('sortRoutes', () => {
  const routes = [
    route({ route: '/health', p95_ms: 5, count: 9000, server_error_rate: 0 }),
    route({ route: '/srs/feed', p95_ms: 300, count: 500, server_error_rate: 2 }),
    route({ route: '/books/{book_id}/vocabulary', p95_ms: 21000, count: 40, server_error_rate: 0 }),
  ];

  it('ranks by p95 by default', () => {
    expect(sortRoutes(routes, 'p95').map((r) => r.route)).toEqual([
      '/books/{book_id}/vocabulary',
      '/srs/feed',
      '/health',
    ]);
  });

  it('ranks by traffic — where a slowdown hurts the most people', () => {
    expect(sortRoutes(routes, 'traffic')[0].route).toBe('/health');
  });

  it('ranks by error rate', () => {
    expect(sortRoutes(routes, 'errors')[0].route).toBe('/srs/feed');
  });

  it('does not mutate the report it was handed', () => {
    const original = routes.map((r) => r.route);
    sortRoutes(routes, 'traffic');
    expect(routes.map((r) => r.route)).toEqual(original);
  });

  it('has a blurb for every sort the view offers', () => {
    for (const s of ROUTE_SORTS) {
      expect(sortRoutes(routes, s.id)).toHaveLength(3);
      expect(s.blurb.length).toBeGreaterThan(0);
    }
  });
});

describe('routeBarPct', () => {
  it('scales against the slowest route so the comparison is relative', () => {
    expect(routeBarPct(route({ route: '/a', p95_ms: 21000 }), 21000)).toBe(100);
    expect(routeBarPct(route({ route: '/b', p95_ms: 10500 }), 21000)).toBe(50);
  });

  it('keeps a fast route visible instead of collapsing it to nothing', () => {
    // 5ms against a 21s worst case is 0.02% — still needs to be drawable.
    expect(routeBarPct(route({ route: '/health', p95_ms: 5 }), 21000)).toBe(2);
  });

  it('is safe on a cold report where nothing has been measured', () => {
    expect(routeBarPct(route({ route: '/health', p95_ms: 0 }), 0)).toBe(0);
  });
});

describe('windowSummary', () => {
  it('says the window resets on deploy, so green is read in context', () => {
    const text = windowSummary({
      window_started_at: new Date(Date.now() - 30 * 60_000).toISOString(),
      routes_truncated: false,
      routes: [route({ route: '/health', count: 1200 })],
    });
    expect(text).toContain('1.2k requests');
    expect(text).toContain('1 endpoint');
    expect(text).toContain('30 min');
    expect(text).toContain('Deploying resets this');
  });

  it('flags a truncated route table rather than quietly under-reporting', () => {
    const text = windowSummary({
      window_started_at: new Date(Date.now() - 90 * 60_000).toISOString(),
      routes_truncated: true,
      routes: [route({ route: '/health' })],
    });
    expect(text).toContain('2 h');
    expect(text).toContain('grouped together');
  });
});

describe('explanationForLatencyMetric', () => {
  it('explains every metric the endpoint returns', () => {
    for (const key of [
      'overall_p95_ms',
      'slowest_route_p95_ms',
      'routes_over_budget',
      'server_error_rate',
      'requests_observed',
    ]) {
      expect(LATENCY_EXPLANATIONS[key]).toBeTruthy();
      expect(explanationForLatencyMetric(key)).toBe(LATENCY_EXPLANATIONS[key]);
    }
  });

  it('falls back rather than rendering "undefined" for a metric we do not know', () => {
    expect(explanationForLatencyMetric('some_future_metric')).toMatch(/No description/);
  });
});
