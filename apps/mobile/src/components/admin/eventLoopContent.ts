/**
 * eventLoopContent — the plain-English layer over /admin/health/event-loop.
 *
 * The API answers in percentiles of lateness. This module owns (a) what each
 * metric means in terms of what a user would have felt, (b) how a stall row is
 * worded, and (c) the relative-time formatting the correlation story needs.
 * All pure — no React, no fetching — so the view stays presentation-only.
 *
 * Thresholds are NOT redeclared here: the server classifies every metric and
 * the app renders what it is told. Shared metric formatting lives in
 * healthMetricContent; duration formatting is reused from latencyContent so a
 * millisecond reads the same on both health screens.
 */

import type { EventLoopStall } from '../../services/api';
import { formatMs } from './latencyContent';

/**
 * High-level, jargon-free. The thing to get across is that this is not one
 * slow screen — while the loop is held, *every* request waits, including the
 * ones that touch nothing.
 */
export const EVENT_LOOP_EXPLANATIONS: Readonly<Record<string, string>> = {
  loop_lag_p99_ms:
    'The API is one process that handles every request by taking turns. This measures how long a turn is delayed when work refuses to hand the turn back. Under a millisecond is healthy; tens of milliseconds means something heavy is running where it should have been handed to a worker thread.',
  worst_stall_ms:
    'The longest single freeze since the server last restarted, and when it happened. During that time nothing was answered — a word tap, a quiz card and a health check all waited the same amount. Take the timestamp to the API latency screen to find what was running.',
  stall_rate_per_min:
    'How often the freeze happens, not just how bad the worst one was. One is a fluke worth watching; a steady rate means whatever is blocking sits on a path real users keep hitting.',
  stalled_time_pct:
    'The share of the server’s life spent frozen. This is capacity, not speed: at 5% the API is effectively offline for three minutes of every hour, no matter how fast each individual query is.',
  watchdog_probes:
    'Whether the thing doing the measuring is still alive. If probes stop arriving, every number above is stale — a monitor that quietly dies reports a perfectly healthy server forever.',
};

export function explanationForEventLoopMetric(key: string): string {
  return EVENT_LOOP_EXPLANATIONS[key] ?? 'No description available for this metric yet.';
}

/**
 * Relative time for a stall. Absolute clock times are the wrong unit when the
 * question is "was this just now, or before the last deploy?".
 */
export function formatAgo(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const seconds = Math.max(0, (now - then) / 1000);
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} d ago`;
}

/**
 * One stall in a sentence. Deliberately says who else waited rather than just
 * printing a duration — the duration alone reads like one slow request, which
 * is exactly the misunderstanding this screen exists to fix.
 */
export function describeStall(stall: EventLoopStall, now: number = Date.now()): string {
  const when = formatAgo(stall.at, now);
  const held = formatMs(stall.lag_ms);
  return stall.severity === 'severe'
    ? `${when} — every request waited ${held}. Long enough for a user to see the app hang.`
    : `${when} — every request waited ${held}.`;
}

/** Bar width for a stall row, relative to the worst one on screen. */
export function stallBarPct(stall: EventLoopStall, worstMs: number): number {
  if (worstMs <= 0) return 0;
  return Math.max(4, Math.min(100, (stall.lag_ms / worstMs) * 100));
}

/**
 * The line under the hero. Two jobs: say how long the window is (a green
 * report five minutes after a deploy is not evidence of much), and say what
 * lag can and cannot tell you — it never names the handler that stalled.
 */
export function windowSummary(
  report: {
    window_started_at: string;
    probe_interval_ms: number;
    stall_threshold_ms: number;
    recent_stalls: readonly EventLoopStall[];
  },
  now: number = Date.now()
): string {
  const minutes = Math.max(1, Math.round((now - new Date(report.window_started_at).getTime()) / 60000));
  const age =
    minutes < 60 ? `${minutes} min` : minutes < 1440 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / 1440)} d`;
  return (
    `Checked every ${report.probe_interval_ms} ms for the ${age} since the API last restarted; ` +
    `anything over ${report.stall_threshold_ms} ms late counts as a stall. Deploying resets this.`
  );
}

/** The attribution caveat, stated wherever stalls are shown. */
export const ATTRIBUTION_NOTE =
  'Lag says the server froze and when — never which request did it, because every request froze equally. ' +
  'To find the culprit, match a stall’s time against the API latency screen and look for the giveaway: ' +
  'one endpoint slow AND every unrelated endpoint slow in the same moment.';
