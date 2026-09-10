# Load tests

## What these are actually looking for

Not throughput. The interesting question for this API is not "how many
requests a second" — it is **"does one heavy request stall everybody else?"**

The API is a single uvicorn process on a single replica, on purpose: each one
holds ~1GB of ML models. That makes it a shared event loop, and anything
synchronous inside an `async def` blocks *every* concurrent request, not just
the caller's. It has happened: one script parse pushed `/health` from 0.16s to
7.86s (issue #117). The known offenders are documented in CLAUDE.md — password
hashing at ~173ms, spaCy at 0.6ms/word, PDF and EPUB extraction, and loading a
whole table to filter it in Python.

That failure mode is invisible to every other kind of test. Ruff's `ASYNC`
rules only know about *known* blocking APIs (`open`, `time.sleep`, `requests`);
they cannot tell that an ordinary function call is CPU-heavy. A unit test runs
one request at a time and never notices. Reviewing the function in isolation
shows nothing, because each piece is individually correct — the defect lives in
the composition.

So `head-of-line.js` is built as a **victim and a bully**. A canary hits
`/health` at a steady 2/s for the whole run and records how long it takes. Half
a minute in, load ramps onto a heavy endpoint. If the offload helpers are doing
their job, the canary's latency barely moves; if something slipped back onto
the loop, the canary is the thing that screams, and it screams with a
timestamp you can take to `/admin/health/event-loop` and the access logs.

## Running

k6 is a standalone binary, not a project dependency:

```sh
brew install k6
```

Against a local API — the default, and the only host that needs no argument:

```sh
cd backend && uvicorn src.main:app --port 8000     # in one shell
k6 run loadtest/head-of-line.js                    # in another
```

The heavy scenario needs a bearer token (`/movies/{id}/vocabulary/full` is
behind `get_current_active_user`). Without one, k6 runs the canary alone, which
exercises the harness but not the hypothesis, and says so:

```sh
WW_TOKEN="$(...)" WW_MOVIE_ID=123 k6 run loadtest/head-of-line.js
```

## What a prod run can and cannot tell you (measured 2026-09-10)

Run against `api.getwordwise.us` at three ramps. The short version: **you
cannot load-test this API from one machine, and the first run that looked
healthy was measuring the wrong thing.**

`GlobalRateLimitMiddleware` caps a single client at
`settings.rate_limit_per_minute` — 600/min, and confirmed *not* overridden in
Railway, so the code default is what prod runs. At ~0.29s per `by-cefr`
request that is about three concurrent requests, which is nowhere near enough
to saturate a one-process event loop. `/` and `/health` are on the
middleware's `_EXEMPT_PATHS`, so the canary sails through no matter what.

Those two facts combine into a trap. At 25 VUs the summary read
`ratio 0.94x - the offloads are holding` and every threshold passed — while
**84% of the load requests were 429s**, answered by middleware before any route
ran. A 429 costs the event loop nothing, so the canary was measuring an idle
server and reporting it as a clean bill of health.

The script now refuses to do that: `heavy_ok` has a threshold, and the summary
prints `INVALID` with the reason when the load did not land.

Kept under the limit (3 VUs, 100% landed), the honest numbers are:

| | med | p95 | max |
|---|---|---|---|
| `/health` baseline | 115ms | 201ms | 295ms |
| `/health` under load | 95ms | 156ms | 485ms |
| `by-cefr` (the load) | 210ms | 243ms | 532ms |

Ratio 0.78x — no head-of-line blocking **at three concurrent requests**. That
is a real result and a narrow one. It does not show the offloads hold under
pressure; it shows they hold under the most a single legitimate client is
allowed to apply. To test the actual hypothesis you need either a local run
(no middleware limit in the way) or load from more than one address.

The useful thing the prod runs *did* prove: the global rate limiter works, and
`/health` stayed 100% available at ~170ms p95 throughout — so being throttled
does not itself stall the loop.

## Never point this at production without saying so out loud

`BASE_URL` defaults to `http://localhost:8000` and the script **refuses any
other host** unless `WW_ALLOW_REMOTE=yes` is also set. That guard is not
paranoia about a config typo; it is about what this specific test does to this
specific deployment.

There is one replica. There is no autoscaler to absorb a ramp. Every request
this test makes competes with a real user's, and the whole point of the test is
to find the request that blocks the loop — which means a successful run
degrades the API for everyone on it. The rate limiter (`utils/rate_limit`)
counts per user id or client IP in this process's memory, so a load test from
one machine looks exactly like one abusive client and will start collecting
429s, which also makes the results meaningless.

If you do want a production number, ask first, run it at a genuinely quiet
hour, keep the ramp short, and watch `/admin/health/event-loop` while it goes.

## Reading the output

`health_latency` is tagged by phase. What matters is the *ratio*, not the
absolute:

```
health_latency{phase:baseline}    p(95)=...
health_latency{phase:under_load}  p(95)=...
```

Baseline is the loop when it is free. If `under_load` is within ~2x of it, the
offloads are holding. If it is 10x, something on the heavy path is running on
the event loop, and the next question is which — take the timestamp to
`/admin/health/latency` and look for the #117 signature: one endpoint slow
**and** every unrelated endpoint slow in the same window.
