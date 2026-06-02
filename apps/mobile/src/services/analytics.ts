/**
 * analytics — lightweight, transport-agnostic event tracking.
 *
 * No SDK dependency: events are handed to a pluggable transport. The default
 * logs in dev and no-ops in production, so instrumentation can land now and a
 * real destination (PostHog / Amplitude / Segment / …) can be wired later via
 * `setAnalyticsTransport` without touching call sites.
 *
 * Why this exists: the playbook (SMOOTHNESS_AND_DESIGN_PLAYBOOK §10) says to
 * measure the journeys users *feel* — app_open, lesson_start, lesson_end — and
 * optimize conversion, not just raw timing. This is the seam to do that. The
 * codebase already references unemitted events (PAYWALL_VIEW, TRIAL_START_TAP);
 * those can move onto `track()` when a destination is chosen.
 */

export type AnalyticsProps = Record<string, string | number | boolean | null | undefined>;
export type AnalyticsTransport = (event: string, props?: AnalyticsProps) => void;

const consoleTransport: AnalyticsTransport = (event, props) => {
  if (__DEV__) console.log(`[analytics] ${event}`, props ?? {});
};

let transport: AnalyticsTransport = consoleTransport;

/** Swap in a real analytics destination (call once at startup). */
export function setAnalyticsTransport(next: AnalyticsTransport): void {
  transport = next;
}

/** Record an event. Never throws — a broken transport must not break a flow. */
export function track(event: string, props?: AnalyticsProps): void {
  try {
    transport(event, props);
  } catch (e) {
    if (__DEV__) console.warn('[analytics] transport threw:', e);
  }
}
