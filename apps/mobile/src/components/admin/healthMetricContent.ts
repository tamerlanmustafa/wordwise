/**
 * healthMetricContent — the presentation layer shared by every /admin/health/*
 * report (vocab coverage, request latency, …).
 *
 * The server returns one metric shape for all of them, so value formatting,
 * meter geometry and the status rollup are written once here and each report's
 * own module owns only its copy, grouping and thresholds.
 *
 * Thresholds are never redeclared client-side: warn_at/fail_at/max_value come
 * from the server so a marker can't drift from the band the backend classifies
 * against.
 */

import type { HealthMetric, HealthStatus } from '../../services/api';

export const STATUS_RANK: Record<HealthStatus, number> = { ok: 0, warn: 1, fail: 2 };

export function statusCounts(metrics: readonly HealthMetric[]): Record<HealthStatus, number> {
  const counts: Record<HealthStatus, number> = { ok: 0, warn: 0, fail: 0 };
  for (const m of metrics) counts[m.status] += 1;
  return counts;
}

/** Worst status in the list — mirrors the server's overall rollup. */
export function worstStatus(metrics: readonly { status: HealthStatus }[]): HealthStatus {
  let worst: HealthStatus = 'ok';
  for (const m of metrics) {
    if (STATUS_RANK[m.status] > STATUS_RANK[worst]) worst = m.status;
  }
  return worst;
}

export interface MeterGeometry {
  /** Fill width as a 0–100 percentage of the track. */
  fillPct: number;
  /** Marker positions along the track, or null when that band doesn't apply. */
  warnPct: number | null;
  failPct: number | null;
}

const clampPct = (n: number): number => Math.max(0, Math.min(100, n));

/**
 * Meter geometry for a bounded metric, or null when the metric is an unbounded
 * count (which renders as a stat tile instead).
 */
export function meterGeometry(metric: HealthMetric): MeterGeometry | null {
  const max = metric.max_value;
  if (max == null || max <= 0) return null;
  const toPct = (n: number | null): number | null =>
    n == null ? null : clampPct((n / max) * 100);
  return {
    fillPct: metric.value == null ? 0 : clampPct((metric.value / max) * 100),
    warnPct: toPct(metric.warn_at),
    failPct: toPct(metric.fail_at),
  };
}

/** Display string for a metric value, respecting its unit. */
export function formatMetricValue(metric: HealthMetric): string {
  const { value, unit } = metric;
  if (value == null) return '—';
  const n = Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (unit === '%') return `${n}%`;
  if (unit === '$') return `$${n}`;
  if (unit === 'ms') return `${n} ms`;
  return `${n} ${unit}`;
}
