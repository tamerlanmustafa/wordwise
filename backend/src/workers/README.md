# Adaptive movie pre-processing worker

Background pool that walks the TMDB catalog, fetches scripts, and runs the
CEFR pipeline so a movie page is instant on first user click.

## Quick start

The FastAPI server **must already be running** — workers call it for script
fetching and CEFR classification.

```bash
# 1. Install deps (adds asyncpg).
pip install -r backend/requirements.txt

# 2. Create the worker tables (one-time).
psql "$DATABASE_URL" -f backend/src/workers/schema.sql

# 3. Set required env.
export TMDB_API_KEY=...
export DATABASE_URL=postgresql://...
export WORKER_API_BASE_URL=http://localhost:8000   # optional, this is the default

# 4. Seed the queue. Top 250 first (priority 0), then a popular backlog.
cd backend
python -m src.workers.seed                         # ~250 movies
python -m src.workers.seed --backlog               # popular backlog at priority 1

# 5. Run the controller and one or more workers (separate shells).
cd backend
python -m src.workers.controller                   # one process, always
python -m src.workers.worker                       # one or more

# Or fan out via honcho:
pip install honcho
honcho -f backend/src/workers/Procfile start -c worker=4,controller=1
```

## Pieces

| File             | What it is                                                          |
| ---------------- | ------------------------------------------------------------------- |
| `schema.sql`     | `movie_jobs`, `rate_state`, `api_events` tables + indexes           |
| `db.py`          | asyncpg pool. One per process.                                      |
| `queue.py`       | `claim_one` (FOR UPDATE SKIP LOCKED), `mark_done`, `mark_failed`    |
| `rate.py`        | Token bucket + AIMD knobs, all stored in the `rate_state` row       |
| `processor.py`   | Per-job logic. Calls the local FastAPI server over httpx.           |
| `worker.py`      | Long-running process. Run N copies.                                 |
| `controller.py`  | Single process. Adjusts target QPS every few seconds.               |
| `seed.py`        | One-shot script that pulls TMDB top_rated → priority 0 jobs.        |
| `Procfile`       | For `honcho start` / `foreman start` local fan-out.                 |

## Why Postgres for the queue?

We already run Postgres. `FOR UPDATE SKIP LOCKED` gives us atomic claim
without coordination, the `rate_state` row gives us a globally-shared
token bucket without Redis, and the `api_events` table gives us a sliding
window the controller can `PERCENTILE_CONT` over without a metrics stack.
One database, three roles.

## Why AIMD?

We don't know the right rate to call STANDS4 / OpenSubtitles / TMDB. They
don't publish it, and it changes. AIMD doesn't pick a number — it walks the
QPS up gently when things look healthy and slams it down (×0.5) the moment
we see a 429, a 5xx, or a latency spike. It's TCP congestion control,
because the underlying problem is the same: a shared resource with an
unknown ceiling and a punishing failure mode.

## First-time setup

```bash
# 1. Create the worker tables.
psql "$DATABASE_URL" -f backend/src/workers/schema.sql

# 2. Make sure the env has TMDB and the API server is reachable.
export TMDB_API_KEY=...
export DATABASE_URL=postgresql://...
export WORKER_API_BASE_URL=http://localhost:8000   # optional, this is the default

# 3. Seed the queue (Top 250 first, then a popular backlog).
python -m src.workers.seed                # priority 0, ~250 movies
python -m src.workers.seed --backlog      # priority 1, popular pages
```

## Running

The FastAPI server **must be running** — workers call it for script
fetching and CEFR classification. In a separate shell:

```bash
# Single worker + controller (development)
python -m src.workers.controller &
python -m src.workers.worker

# Or fan out via honcho:
pip install honcho
honcho -f backend/src/workers/Procfile start -c worker=4,controller=1
```

## Tunables (env vars)

| Var                          | Default | What it does                                  |
| ---------------------------- | ------- | --------------------------------------------- |
| `WORKER_API_BASE_URL`        | http://localhost:8000 | Where the FastAPI server lives    |
| `WORKER_PG_POOL_MAX`         | 4       | asyncpg pool size per process                 |
| `WORKER_IDLE_SLEEP`          | 5       | Seconds to wait when the queue is empty       |
| `CONTROLLER_INTERVAL`        | 5       | AIMD tick period (seconds)                    |
| `CONTROLLER_WINDOW`          | 30      | api_events lookback window (seconds)          |
| `CONTROLLER_AI_STEP`         | 0.05    | QPS to add per healthy tick                   |
| `CONTROLLER_MD_FACTOR`       | 0.5     | Multiplicative decrease on distress           |
| `CONTROLLER_ERR_RATE`        | 0.10    | Error rate that triggers MD                   |
| `CONTROLLER_P95_MS`          | 8000    | p95 latency that triggers MD                  |
| `CONTROLLER_MIN_SAMPLES`     | 5       | Minimum events in window before AI            |

The hard floors and ceilings live in `rate_state` (`min_qps`, `max_qps`)
so an env-var fat-finger can't ask the controller to push 100 QPS into
TMDB. Edit the row directly to change them.

## Watching it run

```sql
-- queue health
SELECT status, COUNT(*) FROM movie_jobs GROUP BY status;

-- current target
SELECT target_qps, tokens, max_qps FROM rate_state WHERE id = 1;

-- recent API behavior
SELECT
    DATE_TRUNC('minute', occurred_at) AS minute,
    COUNT(*)                          AS calls,
    AVG(latency_ms)::int              AS avg_ms,
    SUM((NOT success)::int)           AS errors
FROM api_events
WHERE occurred_at > now() - interval '15 minutes'
GROUP BY 1
ORDER BY 1 DESC;

-- the dead letter queue
SELECT id, tmdb_id, title, attempts, last_error
  FROM movie_jobs
 WHERE status = 'dead'
 ORDER BY finished_at DESC
 LIMIT 50;
```

## Recovering a dead job

```sql
-- requeue a single job
UPDATE movie_jobs
   SET status = 'pending', attempts = 0, run_after = now(), last_error = NULL
 WHERE id = $JOB_ID;

-- requeue all dead jobs
UPDATE movie_jobs
   SET status = 'pending', attempts = 0, run_after = now(), last_error = NULL
 WHERE status = 'dead';
```
