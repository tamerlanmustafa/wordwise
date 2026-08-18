"""
Per-endpoint request-latency telemetry (issue #130).

Until now the backend recorded a duration on every access-log line but never
aggregated it, so there was no p50/p95 for any route: every figure in the
2026-08-17 performance analysis had to be measured by hand with curl. This
module is the aggregation layer. The access middleware calls `record()` with
the duration it already measures; GET /admin/health/latency reads `snapshot()`
and classifies it with the shared /admin/health/* metric contract.

Two deliberate constraints:

- **Route templates, not raw paths.** `/movies/{movie_id}/words`, never
  `/movies/8421/words`. Raw paths are unbounded — a crawler or a hot movie
  would blow the key space up and the numbers would mean nothing. Requests that
  match no route collapse into a single `<unmatched>` bucket for the same
  reason, and a hard cap on tracked keys backstops both.
- **In-process, bounded memory.** One rolling window of recent samples per
  route (exact percentiles over that window, not an approximation), and one
  pooled window for the traffic-weighted app-wide numbers. Nothing is
  persisted, so the window resets on deploy/restart — the per-request
  `duration_ms` + `route` fields in the structured logs remain the long-term
  record. The API runs as a single uvicorn process (see Dockerfile.backend), so
  this covers the whole instance.
"""
from __future__ import annotations

import threading
from collections import deque
from datetime import datetime, timezone
from math import ceil
from typing import Any, Optional

from .health_metrics import (
    OK,
    STATUS_RANK,
    WARN,
    capped_by_sample_size,
    metric,
    overall_status,
    status_max,
)

# Recent samples kept per route. 500 × ~200 tracked routes is a few MB worst
# case, and in practice only the handful of routes taking real traffic fill up.
WINDOW_SAMPLES = 500
# Pooled window for the app-wide percentiles. Bigger than the per-route window
# because it is traffic-weighted: hot routes should dominate it, as they
# dominate what a user actually feels.
GLOBAL_WINDOW_SAMPLES = 2000
# Hard ceiling on tracked keys — a backstop in case a future route template
# ever slips through with an interpolated value in it. One slot is reserved for
# the overflow bucket, so the table never holds more than this many entries.
MAX_TRACKED_ROUTES = 200

UNMATCHED_ROUTE = "<unmatched>"
OVERFLOW_ROUTE = "<other>"
# Everything folded into the overflow bucket shares one key regardless of
# method — the point is a single spillover slot, not one per verb.
OVERFLOW_METHOD = "*"

# p95 bands. 500 ms is roughly "the app still feels immediate on a phone";
# 2 s is where a screen visibly hangs — the 21 s vocabulary endpoint and the
# 7.86 s /health stall from the perf analysis would both have failed on sight.
P95_WARN_MS = 500.0
P95_FAIL_MS = 2000.0

# Share of requests answered with a 5xx.
ERROR_RATE_WARN_PCT = 1.0
ERROR_RATE_FAIL_PCT = 5.0

# A p95 off three requests is noise. Below this a slow route can still WARN,
# but it is never allowed to FAIL the whole dashboard on its own.
MIN_SAMPLES_FOR_FAIL = 20


def _percentile(sorted_values: list[float], pct: float) -> float:
    """Nearest-rank percentile over an already-sorted, non-empty list."""
    rank = max(1, ceil(pct / 100.0 * len(sorted_values)))
    return sorted_values[min(rank, len(sorted_values)) - 1]


class _RouteWindow:
    """Rolling stats for one (method, route template) pair."""

    __slots__ = ("samples", "count", "sum_ms", "max_ms", "server_errors", "client_errors")

    def __init__(self) -> None:
        self.samples: deque[float] = deque(maxlen=WINDOW_SAMPLES)
        self.count = 0          # lifetime, not just what the window retains
        self.sum_ms = 0.0       # lifetime
        self.max_ms = 0.0       # lifetime
        self.server_errors = 0  # lifetime 5xx
        self.client_errors = 0  # lifetime 4xx

    def record(self, duration_ms: float, status_code: int) -> None:
        self.samples.append(duration_ms)
        self.count += 1
        self.sum_ms += duration_ms
        if duration_ms > self.max_ms:
            self.max_ms = duration_ms
        if status_code >= 500:
            self.server_errors += 1
        elif status_code >= 400:
            self.client_errors += 1

    def as_dict(self, method: str, route: str) -> dict[str, Any]:
        ordered = sorted(self.samples)
        return {
            "method": method,
            "route": route,
            "count": self.count,
            "sampled": len(ordered),
            "p50_ms": round(_percentile(ordered, 50), 2),
            "p95_ms": round(_percentile(ordered, 95), 2),
            "p99_ms": round(_percentile(ordered, 99), 2),
            "max_ms": round(self.max_ms, 2),
            "avg_ms": round(self.sum_ms / self.count, 2),
            "server_errors": self.server_errors,
            "client_errors": self.client_errors,
            "server_error_rate": round(100.0 * self.server_errors / self.count, 2),
        }


class LatencyRegistry:
    """Thread-safe in-process store of recent request durations.

    Requests are served on the event loop, but NLP work runs on a worker thread
    (issue #117) and the admin read walks the whole table, so the lock is not
    ceremonial.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._routes: dict[tuple[str, str], _RouteWindow] = {}
        self._global: deque[float] = deque(maxlen=GLOBAL_WINDOW_SAMPLES)
        self._total = 0
        self._server_errors = 0
        self._started_at = datetime.now(timezone.utc)
        self._overflowed = False

    def record(self, method: str, route: Optional[str], status_code: int, duration_ms: float) -> None:
        """Add one observation. Called once per request from the middleware."""
        key = (method or "-", route or UNMATCHED_ROUTE)
        with self._lock:
            window = self._routes.get(key)
            if window is None:
                if len(self._routes) >= MAX_TRACKED_ROUTES - 1:
                    # Never grow past the cap: fold the newcomer into the one
                    # reserved bucket and flag that the table is truncated.
                    self._overflowed = True
                    key = (OVERFLOW_METHOD, OVERFLOW_ROUTE)
                window = self._routes.get(key) or self._routes.setdefault(key, _RouteWindow())
            window.record(duration_ms, status_code)
            self._global.append(duration_ms)
            self._total += 1
            if status_code >= 500:
                self._server_errors += 1

    def snapshot(self) -> dict[str, Any]:
        """Raw aggregates. Pure data — `build_report` turns it into metrics."""
        with self._lock:
            routes = [w.as_dict(m, r) for (m, r), w in self._routes.items() if w.count]
            pooled = sorted(self._global)
            total = self._total
            server_errors = self._server_errors
            started_at = self._started_at
            overflowed = self._overflowed

        routes.sort(key=lambda r: r["p95_ms"], reverse=True)
        return {
            "since": started_at.isoformat(),
            "total_requests": total,
            "server_errors": server_errors,
            "routes_tracked": len(routes),
            "routes_truncated": overflowed,
            "window_samples_per_route": WINDOW_SAMPLES,
            "overall_p50_ms": round(_percentile(pooled, 50), 2) if pooled else None,
            "overall_p95_ms": round(_percentile(pooled, 95), 2) if pooled else None,
            "overall_p99_ms": round(_percentile(pooled, 99), 2) if pooled else None,
            "routes": routes,
        }

    def reset(self) -> None:
        """Drop everything. Used by tests; there is no runtime caller."""
        with self._lock:
            self._routes.clear()
            self._global.clear()
            self._total = 0
            self._server_errors = 0
            self._started_at = datetime.now(timezone.utc)
            self._overflowed = False


# The one registry the middleware writes to and the admin endpoint reads.
registry = LatencyRegistry()


def record_request(method: str, route: Optional[str], status_code: int, duration_ms: float) -> None:
    """Module-level entry point so callers don't import the singleton directly."""
    registry.record(method, route, status_code, duration_ms)


# ── report assembly (pure) ──────────────────────────────────────────────────

def _capped_by_sample_size(status: str, sampled: int) -> str:
    """This report's sample-size floor, over the shared rule in health_metrics.

    Percentiles over a handful of requests swing wildly, and a single
    cold-start request should not paint the whole dashboard red.
    """
    return capped_by_sample_size(status, sampled, MIN_SAMPLES_FOR_FAIL)


def route_status(route: dict[str, Any]) -> str:
    """ok/warn/fail for one route, from its p95 and its 5xx rate."""
    p95_status = status_max(route["p95_ms"], warn=P95_WARN_MS, fail=P95_FAIL_MS)
    error_status = status_max(
        route["server_error_rate"], warn=ERROR_RATE_WARN_PCT, fail=ERROR_RATE_FAIL_PCT
    )
    worst = max(p95_status, error_status, key=lambda s: STATUS_RANK[s])
    return _capped_by_sample_size(worst, route["sampled"])


def build_report(snap: dict[str, Any]) -> dict[str, Any]:
    """Turn a registry snapshot into the standard /admin/health/* report."""
    routes = [dict(r, status=route_status(r)) for r in snap["routes"]]
    total = snap["total_requests"]
    pooled = min(total, GLOBAL_WINDOW_SAMPLES)

    metrics: list[dict] = []

    # 1. Traffic-weighted p95 — the single number for "how does the API feel".
    overall_p95 = snap["overall_p95_ms"]
    metrics.append(metric(
        "overall_p95_ms",
        "API p95 latency",
        overall_p95, "ms",
        _capped_by_sample_size(
            status_max(overall_p95, warn=P95_WARN_MS, fail=P95_FAIL_MS), pooled
        ) if overall_p95 is not None else OK,
        f"warn >{P95_WARN_MS:g}ms, fail >{P95_FAIL_MS:g}ms",
        detail=(
            f"95th percentile across the last {pooled:,} requests "
            f"(p50 {snap['overall_p50_ms']}ms, p99 {snap['overall_p99_ms']}ms)"
            if overall_p95 is not None
            else "no requests observed since this instance started"
        ),
        warn_at=P95_WARN_MS, fail_at=P95_FAIL_MS, direction="max",
    ))

    # 2. The single worst endpoint. The app-wide p95 hides a slow-but-rare
    # route behind a fast-and-hot one; this is what names it.
    slowest = routes[0] if routes else None
    metrics.append(metric(
        "slowest_route_p95_ms",
        "Slowest endpoint (p95)",
        slowest["p95_ms"] if slowest else None, "ms",
        slowest["status"] if slowest else OK,
        f"warn >{P95_WARN_MS:g}ms, fail >{P95_FAIL_MS:g}ms",
        detail=(
            f"{slowest['method']} {slowest['route']} — {slowest['count']:,} requests"
            if slowest else "no requests observed yet"
        ),
        warn_at=P95_WARN_MS, fail_at=P95_FAIL_MS, direction="max",
    ))

    # 3. How much of the surface is slow, not just the worst offender.
    over_budget = sum(1 for r in routes if r["p95_ms"] > P95_WARN_MS)
    metrics.append(metric(
        "routes_over_budget",
        "Endpoints over the latency budget",
        over_budget, "endpoints",
        status_max(over_budget, warn=1.0, fail=None),
        f"warn if any endpoint's p95 exceeds {P95_WARN_MS:g}ms",
        detail=f"{over_budget} of {len(routes)} tracked endpoints above the p95 budget",
        warn_at=1.0, direction="max",
    ))

    # 4. Server-error rate — a fast 500 is still a broken screen.
    error_rate = round(100.0 * snap["server_errors"] / total, 2) if total else 0.0
    metrics.append(metric(
        "server_error_rate",
        "Server error rate",
        error_rate, "%",
        _capped_by_sample_size(
            status_max(error_rate, warn=ERROR_RATE_WARN_PCT, fail=ERROR_RATE_FAIL_PCT), total
        ),
        f"warn >{ERROR_RATE_WARN_PCT:g}%, fail >{ERROR_RATE_FAIL_PCT:g}%",
        detail=f"{snap['server_errors']:,} of {total:,} requests answered 5xx",
        warn_at=ERROR_RATE_WARN_PCT, fail_at=ERROR_RATE_FAIL_PCT,
        direction="max", max_value=100.0,
    ))

    # 5. Sample size, so a green dashboard on 4 requests reads as what it is.
    metrics.append(metric(
        "requests_observed",
        "Requests observed",
        total, "requests",
        OK,
        "observation only — resets when the API restarts",
        detail=f"since {snap['since']}, across {len(routes)} endpoints",
        direction="min",
    ))

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "overall_status": overall_status(metrics),
        "window_started_at": snap["since"],
        "window_samples_per_route": snap["window_samples_per_route"],
        "routes_truncated": snap["routes_truncated"],
        "metrics": metrics,
        "routes": routes,
    }


def compute_latency_report() -> dict[str, Any]:
    """Live report off the process-wide registry."""
    return build_report(registry.snapshot())
