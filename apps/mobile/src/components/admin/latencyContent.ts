/**
 * latencyContent — the plain-English layer over /admin/health/latency.
 *
 * The API answers in percentiles and route templates. This module owns (a) what
 * each headline metric actually means, (b) how a route row is worded and
 * ordered, and (c) duration formatting that stays readable from 0.4 ms to 21 s.
 * All pure — no React, no fetching — so the view stays presentation-only.
 *
 * Thresholds are NOT redeclared here: the server classifies every route and
 * metric, and the app renders what it is told. Shared metric formatting lives
 * in healthMetricContent.
 */

import type { LatencyRoute } from '../../services/api';

/**
 * What each number means, in the plainest words that are still true. Same
 * house style as the coverage report: one sentence on what it is, one on what
 * good and bad look like.
 */
export const LATENCY_EXPLANATIONS: Readonly<Record<string, string>> = {
  overall_p95_ms:
    'How long the slowest 1 request in 20 takes. Lower is better. Averages hide stalls — this is the number that matches how slow the app actually feels.',
  slowest_route_p95_ms:
    'The single worst screen right now, and how slow it is. The whole-app number can look fine while one screen is unusable; this names it.',
  routes_over_budget:
    'How many screens are slower than we allow, not just the worst. One is a bug in that screen. Several at once usually means something shared is struggling — the database, or a worker hogging the server.',
  server_error_rate:
    'How often a request fails outright. A fast crash is still a broken screen, so it belongs next to the timings.',
  requests_observed:
    'How many requests these numbers come from. A green dashboard built on twenty requests proves nothing — check this before trusting the rest.',
};

export function explanationForLatencyMetric(key: string): string {
  return LATENCY_EXPLANATIONS[key] ?? 'No description available for this metric yet.';
}

/**
 * Human duration. Sub-millisecond timings keep a decimal, anything over a
 * second switches to seconds — "21000 ms" is much harder to read than "21.0 s",
 * and the whole point of this screen is spotting the slow ones at a glance.
 */
export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} s`;
  if (ms >= 10) return `${Math.round(ms)} ms`;
  return `${ms.toFixed(1)} ms`;
}

/** Request count, abbreviated so long route rows don't wrap on a narrow phone. */
export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

export type RouteSortId = 'p95' | 'traffic' | 'errors';

export const ROUTE_SORTS: ReadonlyArray<{ id: RouteSortId; label: string; blurb: string }> = [
  { id: 'p95', label: 'Slowest', blurb: 'Worst screens first, by how slow their slow requests are.' },
  { id: 'traffic', label: 'Busiest', blurb: 'Most-used screens first — where a slowdown hurts the most people.' },
  { id: 'errors', label: 'Failing', blurb: 'Screens that break most often, first.' },
];

/** Sorted copy of the route table. Ties fall back to p95 so order is stable. */
export function sortRoutes(routes: readonly LatencyRoute[], sort: RouteSortId): LatencyRoute[] {
  const copy = [...routes];
  if (sort === 'traffic') {
    copy.sort((a, b) => b.count - a.count || b.p95_ms - a.p95_ms);
  } else if (sort === 'errors') {
    copy.sort(
      (a, b) => b.server_error_rate - a.server_error_rate || b.server_errors - a.server_errors || b.p95_ms - a.p95_ms
    );
  } else {
    copy.sort((a, b) => b.p95_ms - a.p95_ms);
  }
  return copy;
}

/**
 * Bar width for a route row, as a share of the slowest route's p95. Relative
 * rather than absolute because the range is enormous — 5 ms next to 21 s — and
 * the question the row answers is "how does this compare to the worst one".
 */
export function routeBarPct(route: LatencyRoute, slowestP95: number): number {
  if (slowestP95 <= 0) return 0;
  return Math.max(2, Math.min(100, (route.p95_ms / slowestP95) * 100));
}

/**
 * One line of context under the hero: what window these numbers cover and how
 * far to trust them. The window is in-process, so a deploy resets it — saying
 * so is the difference between "the API is healthy" and "the API has been
 * healthy for the four minutes since it restarted".
 */
export function windowSummary(report: {
  window_started_at: string;
  routes_truncated: boolean;
  routes: readonly LatencyRoute[];
}): string {
  const total = report.routes.reduce((sum, r) => sum + r.count, 0);
  const started = new Date(report.window_started_at);
  const minutes = Math.max(1, Math.round((Date.now() - started.getTime()) / 60000));
  const age =
    minutes < 60
      ? `${minutes} min`
      : minutes < 1440
        ? `${Math.round(minutes / 60)} h`
        : `${Math.round(minutes / 1440)} d`;
  const truncated = report.routes_truncated
    ? ' Some endpoints are grouped together — more were seen than the API tracks separately.'
    : '';
  return (
    `${formatCount(total)} requests across ${report.routes.length} endpoints, ` +
    `measured over the ${age} since the API last restarted. Deploying resets this.${truncated}`
  );
}
