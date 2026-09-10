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

const healthLatency = new Trend('health_latency', true);
const healthOk = new Rate('health_ok');
const heavyLatency = new Trend('heavy_latency', true);
const heavyOk = new Rate('heavy_ok');

/** The heavy scenario needs a token; without one we can only run the canary. */
const CAN_LOAD = Boolean(TOKEN && MOVIE_ID);

const RAMP_START = '30s';

export const options = {
  scenarios: {
    // The victim. Constant arrival rate, not constant VUs: if the loop stalls
    // we want the requests to pile up and the latency to show it, rather than
    // a fixed VU quietly sending fewer of them and reporting a flat line.
    canary: {
      executor: 'constant-arrival-rate',
      rate: 2,
      timeUnit: '1s',
      duration: '2m30s',
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
              { duration: '30s', target: 5 },
              { duration: '45s', target: 20 },
              { duration: '15s', target: 0 },
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
  },
};

export function setup() {
  if (!CAN_LOAD) {
    console.warn(
      'WW_TOKEN and WW_MOVIE_ID are not both set — running the canary alone. ' +
        'That exercises the harness but not the hypothesis: nothing will be ' +
        'competing with /health, so a flat line proves nothing.',
    );
  }
  const res = http.get(`${BASE_URL}/health`);
  check(res, { 'API is up before we start': (r) => r.status === 200 });
  return { startedAt: Date.now() };
}

/** Is the ramp on yet? Tagged rather than split into two scenarios so the two
 *  phases are the same request against the same connection pool. */
function phaseAt(elapsedMs) {
  return CAN_LOAD && elapsedMs > 30_000 ? 'under_load' : 'baseline';
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

export function heavy() {
  // The vocabulary payload: a whole script's classifications, grouped and
  // sorted server-side. One of the endpoints the offload rules exist for.
  const res = http.get(`${BASE_URL}/movies/${MOVIE_ID}/vocabulary/full`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    tags: { endpoint: 'vocabulary_full' },
    timeout: '60s',
  });
  heavyLatency.add(res.timings.duration);
  heavyOk.add(res.status === 200);
  check(res, {
    'heavy endpoint answered': (r) => r.status === 200,
    // 429 means the rate limiter counted this as one abusive client, which it
    // is. The run is still valid but the load is not what the stages say.
    'not rate limited': (r) => r.status !== 429,
  });
  sleep(0.1);
}

export function handleSummary(data) {
  const p = (name, phase) => {
    const m = data.metrics[name];
    if (!m) return 'n/a';
    const key = phase ? `p(95)` : 'p(95)';
    return m.values[key] != null ? `${m.values[key].toFixed(0)}ms` : 'n/a';
  };
  const lines = [
    '',
    '  head-of-line blocking',
    '  ---------------------',
    `  /health p95 overall : ${p('health_latency')}`,
    `  heavy   p95         : ${CAN_LOAD ? p('heavy_latency') : 'not run (no token)'}`,
    '',
    '  The number that matters is the RATIO of health_latency{phase:under_load}',
    '  to {phase:baseline}. Within ~2x, the offloads are holding. 10x means',
    '  something on the heavy path is running on the event loop — take the',
    '  timestamp to /admin/health/event-loop and /admin/health/latency.',
    '',
  ];
  return { stdout: lines.join('\n') };
}
