/**
 * head-of-line.js — does one heavy request stall everybody else?
 *
 * The API is a single uvicorn process on a single replica by design (each
 * holds ~1GB of ML models), so it is one shared event loop. Anything
 * synchronous inside an `async def` blocks every concurrent request, not just
 * the caller's — measured once at a script parse pushing /health from 0.16s to
 * 7.86s (issue #117).
 *
 * Shape: a canary and a bully. The canary hits /health at a steady rate for
 * the whole run. Thirty seconds in, load ramps onto a heavy endpoint. The
 * canary's latency before and during that ramp is the entire result; the
 * heavy endpoint's own latency is almost beside the point.
 *
 * See loadtest/README.md before pointing this anywhere but localhost.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';
const TOKEN = __ENV.WW_TOKEN || '';
const MOVIE_ID = __ENV.WW_MOVIE_ID || '';
const ALLOW_REMOTE = __ENV.WW_ALLOW_REMOTE === 'yes';

/**
 * How hard to push, so a first run against an unfamiliar host can be gentle
 * and a later one can lean on it without editing the file. Defaults are the
 * gentle end on purpose: the useful escalation order is small-then-bigger, and
 * a default nobody chose should be the one that cannot hurt.
 */
const PEAK_VUS = Number(__ENV.WW_PEAK_VUS || 5);
const RAMP_SECONDS = Number(__ENV.WW_RAMP_SECONDS || 30);
const HOLD_SECONDS = Number(__ENV.WW_HOLD_SECONDS || 30);

/**
 * Which endpoint plays the bully.
 *
 *   by-cefr     — no auth, no throttle, and `cf-cache-status: DYNAMIC`, so every
 *                 request reaches the origin (the edge rule deliberately keeps
 *                 this path out of the cache). ~0.29s of real DB aggregation at
 *                 limit=100. The default, because it needs no credentials.
 *   vocabulary  — the full per-script classification payload. Heavier, but it
 *                 sits behind `get_current_active_user`, so it needs WW_TOKEN
 *                 and WW_MOVIE_ID.
 *
 * `/movies/{id}/vocabulary/preview` looks like the obvious choice and is not:
 * `rate_limit(5, 60.0)` means the sixth request in a minute is a 429, so it
 * would measure the rate limiter rather than the event loop.
 */
const HEAVY = __ENV.WW_HEAVY || (TOKEN && MOVIE_ID ? 'vocabulary' : 'by-cefr');

// A load test is one abusive client from the rate limiter's point of view, and
// there is one replica with no autoscaler behind it — a successful run
// degrades the API for whoever else is on it. So a non-local host is opt-in,
// out loud, rather than a default someone inherits from a stale shell.
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/.test(BASE_URL);
if (!isLocal && !ALLOW_REMOTE) {
  throw new Error(
    `Refusing to load-test ${BASE_URL}. Set WW_ALLOW_REMOTE=yes if you mean it — ` +
      'and read the production section of loadtest/README.md first.',
  );
}

/**
 * The app-wide rate limit, in requests per minute per client
 * (`settings.rate_limit_per_minute`, `GlobalRateLimitMiddleware`). Not set in
 * Railway as of 2026-09-10, so the code default is what prod runs.
 *
 * This is the ceiling on what a single machine can generate against prod, and
 * it is well below what saturates a one-process event loop: at ~0.29s per
 * by-cefr request, 600/min is about three concurrent requests. `/` and
 * `/health` are EXEMPT from it, so the canary sails through regardless — which
 * is exactly how a run can look healthy while the load never landed.
 */
const GLOBAL_RATE_LIMIT = 600;

const healthLatency = new Trend('health_latency', true);
const healthOk = new Rate('health_ok');
const heavyLatency = new Trend('heavy_latency', true);
const heavyOk = new Rate('heavy_ok');

/** Can the bully run at all? Only the authenticated variant needs credentials. */
const CAN_LOAD = HEAVY === 'by-cefr' || Boolean(TOKEN && MOVIE_ID);

const RAMP_START_S = 30;
const RAMP_START = `${RAMP_START_S}s`;
const TOTAL = `${RAMP_START_S + RAMP_SECONDS + HOLD_SECONDS + 15}s`;

export const options = {
  scenarios: {
    // The victim. Constant arrival rate, not constant VUs: if the loop stalls
    // we want the requests to pile up and the latency to show it, rather than
    // a fixed VU quietly sending fewer of them and reporting a flat line.
    canary: {
      executor: 'constant-arrival-rate',
      rate: 2,
      timeUnit: '1s',
      duration: TOTAL,
      preAllocatedVUs: 10,
      maxVUs: 40,
      exec: 'canary',
    },
    ...(CAN_LOAD
      ? {
          heavy: {
            executor: 'ramping-vus',
            startTime: RAMP_START,
            startVUs: 0,
            stages: [
              { duration: `${RAMP_SECONDS}s`, target: PEAK_VUS },
              { duration: `${HOLD_SECONDS}s`, target: PEAK_VUS },
              { duration: '10s', target: 0 },
            ],
            exec: 'heavy',
            gracefulRampDown: '10s',
          },
        }
      : {}),
  },
  thresholds: {
    // The loop when it is free. A local API with nothing else on it should be
    // comfortably inside this; if the baseline itself fails, the machine is
    // busy and the run says nothing.
    'health_latency{phase:baseline}': ['p(95)<400'],
    // …and while a heavy endpoint is being hammered. This is the assertion the
    // file exists for. It is a ratio question really — see the README — but a
    // threshold has to be a number, and 4x the baseline bound is generous
    // enough that only a real stall trips it.
    'health_latency{phase:under_load}': ['p(95)<1600'],
    'health_ok': ['rate>0.99'],
    // The run is only meaningful if the load actually reached a handler. See
    // the note on GLOBAL_RATE_LIMIT below — this threshold is what turns a
    // silently-invalid run into a failing one.
    'heavy_ok': ['rate>0.8'],
  },
};

export function setup() {
  if (!CAN_LOAD) {
    console.warn(
      `WW_HEAVY=${HEAVY} needs WW_TOKEN and WW_MOVIE_ID — running the canary ` +
        'alone. That exercises the harness but not the hypothesis: nothing ' +
        'will be competing with /health, so a flat line proves nothing.',
    );
  }
  const res = http.get(`${BASE_URL}/health`);
  check(res, { 'API is up before we start': (r) => r.status === 200 });
  return { startedAt: Date.now() };
}

/** Is the ramp on yet? Tagged rather than split into two scenarios so the two
 *  phases are the same request against the same connection pool. */
function phaseAt(elapsedMs) {
  return CAN_LOAD && elapsedMs > RAMP_START_S * 1000 ? 'under_load' : 'baseline';
}

export function canary(data) {
  const phase = phaseAt(Date.now() - data.startedAt);
  const res = http.get(`${BASE_URL}/health`, {
    tags: { phase, endpoint: 'health' },
    timeout: '30s',
  });
  healthLatency.add(res.timings.duration, { phase });
  healthOk.add(res.status === 200, { phase });
}

/** Levels rotated so consecutive requests cannot be served from one plan or
 *  one warm buffer — the point is to make the database work, not to measure
 *  how fast Postgres can repeat itself. */
const LEVELS = ['A2', 'B1', 'B2', 'C1'];

export function heavy() {
  const authed = HEAVY === 'vocabulary';
  const url = authed
    ? `${BASE_URL}/movies/${MOVIE_ID}/vocabulary/full`
    : `${BASE_URL}/movies/by-cefr?level=${LEVELS[__ITER % LEVELS.length]}&limit=100`;
  const res = http.get(url, {
    headers: authed ? { Authorization: `Bearer ${TOKEN}` } : {},
    tags: { endpoint: authed ? 'vocabulary_full' : 'by_cefr' },
    timeout: '60s',
  });
  heavyLatency.add(res.timings.duration);
  heavyOk.add(res.status === 200);
  // Split by status CLASS, not just ok/not-ok. "89% failed" is a fact with
  // three completely different explanations — throttled, origin erroring, or
  // the connection never completing — and they need different responses.
  check(res, {
    'heavy 2xx': (r) => r.status >= 200 && r.status < 300,
    'heavy 429 (rate limited)': (r) => r.status === 429,
    'heavy 5xx (origin error)': (r) => r.status >= 500,
    'heavy 0 (no response / timeout)': (r) => r.status === 0,
  });
  if (res.status !== 200 && __ITER % 20 === 0) {
    console.warn(`heavy -> ${res.status} ${res.error || ''} ${String(res.body).slice(0, 160)}`);
  }
  sleep(0.1);
}

export function handleSummary(data) {
  const stat = (name, key) => {
    const m = data.metrics[name];
    return m && m.values[key] != null ? m.values[key] : null;
  };
  const ms = (v) => (v == null ? '    n/a' : `${v.toFixed(0).padStart(5)}ms`);
  const row = (label, name) =>
    `  ${label.padEnd(22)} ${ms(stat(name, 'med'))}  ${ms(stat(name, 'p(95)'))}  ` +
    `${ms(stat(name, 'max'))}  ${String(stat(name, 'count') ?? '-').padStart(6)}`;

  const base = stat('health_latency{phase:baseline}', 'p(95)');
  const load = stat('health_latency{phase:under_load}', 'p(95)');
  const ratio = base && load ? load / base : null;

  // The ratio, not the absolute. An absolute number is mostly a measurement of
  // the network between this machine and the origin; the ratio cancels that
  // out, which is the whole reason both phases are the same request on the
  // same connection.
  // Did the load reach a handler at all? A 429 is answered by middleware
  // before any route runs and costs the event loop almost nothing, so a run
  // that was mostly throttled measures the rate limiter and reports a
  // beautiful ratio. That is the worst possible failure for a load test: a
  // green number with nothing behind it.
  const heavyRate = stat('heavy_ok', 'rate');
  const landed = !CAN_LOAD || heavyRate == null || heavyRate > 0.8;

  const verdict =
    !landed
      ? `INVALID - only ${(heavyRate * 100).toFixed(0)}% of load requests reached a handler`
    : ratio == null
      ? 'no comparison - the bully did not run'
      : ratio < 2
        ? `${ratio.toFixed(2)}x - the offloads are holding`
        : ratio < 4
          ? `${ratio.toFixed(2)}x - elevated; re-run before believing it`
          : `${ratio.toFixed(2)}x - SOMETHING IS BLOCKING THE LOOP`;

  const failed = Object.entries(data.metrics)
    .filter(([, m]) => m.thresholds)
    .flatMap(([name, m]) =>
      Object.entries(m.thresholds)
        .filter(([, t]) => !t.ok)
        .map(([expr]) => `${name}: ${expr}`),
    );

  const lines = [
    '',
    '  head-of-line blocking',
    '  =====================',
    `  target : ${BASE_URL}`,
    `  bully  : ${CAN_LOAD ? `${HEAVY} @ ${PEAK_VUS} VUs, ${RAMP_SECONDS}s ramp + ${HOLD_SECONDS}s hold` : 'not run'}`,
    '',
    '                              med      p95      max   count',
    row('/health baseline', 'health_latency{phase:baseline}'),
    row('/health under load', 'health_latency{phase:under_load}'),
    row('heavy endpoint', 'heavy_latency'),
    '',
    `  ratio under/baseline : ${verdict}`,
    `  /health success      : ${((stat('health_ok', 'rate') ?? 0) * 100).toFixed(2)}%`,
    `  heavy success        : ${CAN_LOAD ? `${((stat('heavy_ok', 'rate') ?? 0) * 100).toFixed(2)}%` : '-'}`,
    ...(landed
      ? []
      : [
          '',
          `  The global rate limit is ${GLOBAL_RATE_LIMIT} req/min per client and /health is`,
          '  exempt from it, so the canary stayed green while the load was',
          '  rejected at the middleware. Nothing here says anything about the',
          '  event loop. To actually test blocking: run against localhost, or',
          '  generate load from more than one address.',
        ]),
    ...(failed.length
      ? ['', '  THRESHOLDS FAILED:', ...failed.map((f) => `    ${f}`)]
      : ['', '  all thresholds passed']),
    '',
  ];
  return { stdout: lines.join('\n') + '\n' };
}
