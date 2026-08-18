"""
Unit tests for per-endpoint latency telemetry (GET /admin/health/latency, issue #130).

Three layers, no DB and no network:
- the registry's bookkeeping (route-template keying, rolling window, the
  cardinality cap that keeps a crawler from blowing up the key space),
- percentile maths asserted against a hand-checkable series,
- build_report's ok/warn/fail bands, which are pure.

Route-level guard assertion mirrors tests/test_vocab_coverage.py.
"""
from __future__ import annotations

import pytest

from src.middleware.auth import get_admin_user
from src.services import latency_stats as ls


@pytest.fixture
def reg() -> ls.LatencyRegistry:
    return ls.LatencyRegistry()


def _fill(reg: ls.LatencyRegistry, method: str, route: str, durations, status: int = 200) -> None:
    for d in durations:
        reg.record(method, route, status, d)


def _routes_by_key(snap: dict) -> dict[tuple[str, str], dict]:
    return {(r["method"], r["route"]): r for r in snap["routes"]}


# ── percentiles ──────────────────────────────────────────────────────────────

def test_percentile_nearest_rank():
    values = [float(n) for n in range(1, 101)]  # 1..100
    assert ls._percentile(values, 50) == 50.0
    assert ls._percentile(values, 95) == 95.0
    assert ls._percentile(values, 99) == 99.0
    assert ls._percentile(values, 100) == 100.0


def test_percentile_single_sample():
    assert ls._percentile([7.5], 95) == 7.5


def test_p95_tracks_the_tail_not_the_average(reg):
    """The point of a p95: 99 fast requests must not hide one 3 s stall the way
    a mean would. This is the shape the 21 s vocabulary endpoint had."""
    _fill(reg, "GET", "/movies/{movie_id}/words", [20.0] * 95 + [3000.0] * 5)
    route = _routes_by_key(reg.snapshot())[("GET", "/movies/{movie_id}/words")]

    assert route["p50_ms"] == 20.0
    assert route["p95_ms"] == 20.0      # the 95th of 100 is still the fast band
    assert route["p99_ms"] == 3000.0
    assert route["max_ms"] == 3000.0
    assert route["avg_ms"] == pytest.approx(169.0)


# ── registry bookkeeping ─────────────────────────────────────────────────────

def test_routes_are_keyed_by_method_and_template(reg):
    _fill(reg, "GET", "/movies/{movie_id}/words", [10.0])
    _fill(reg, "POST", "/movies/{movie_id}/words", [20.0])
    keys = set(_routes_by_key(reg.snapshot()))

    assert keys == {
        ("GET", "/movies/{movie_id}/words"),
        ("POST", "/movies/{movie_id}/words"),
    }


def test_unmatched_requests_collapse_into_one_bucket(reg):
    """A 404 has no route template. Bucketing those by raw path would let any
    scanner mint unbounded keys, so they all share one."""
    for path_hit in range(50):
        reg.record("GET", None, 404, float(path_hit))

    routes = _routes_by_key(reg.snapshot())
    assert list(routes) == [("GET", ls.UNMATCHED_ROUTE)]
    assert routes[("GET", ls.UNMATCHED_ROUTE)]["count"] == 50


def test_route_table_is_capped_and_overflow_is_flagged(reg):
    for n in range(ls.MAX_TRACKED_ROUTES + 25):
        reg.record("GET", f"/synthetic/{n}", 200, 5.0)

    snap = reg.snapshot()
    assert snap["routes_tracked"] == ls.MAX_TRACKED_ROUTES
    assert snap["routes_truncated"] is True
    # 199 real routes tracked + one shared spillover slot holding the rest.
    assert _routes_by_key(snap)[(ls.OVERFLOW_METHOD, ls.OVERFLOW_ROUTE)]["count"] == 26
    # Nothing is lost from the totals, only from the per-route breakdown.
    assert snap["total_requests"] == ls.MAX_TRACKED_ROUTES + 25


def test_window_bounds_memory_but_lifetime_counters_keep_counting(reg):
    _fill(reg, "GET", "/health", [1.0] * (ls.WINDOW_SAMPLES + 100))
    route = _routes_by_key(reg.snapshot())[("GET", "/health")]

    assert route["sampled"] == ls.WINDOW_SAMPLES
    assert route["count"] == ls.WINDOW_SAMPLES + 100


def test_window_is_rolling_so_a_fixed_regression_ages_out(reg):
    """After a fix ships, the percentiles must recover rather than stay red
    forever — that is what makes this usable as a before/after check."""
    _fill(reg, "GET", "/quiz/deck", [5000.0] * ls.WINDOW_SAMPLES)
    assert _routes_by_key(reg.snapshot())[("GET", "/quiz/deck")]["p95_ms"] == 5000.0

    _fill(reg, "GET", "/quiz/deck", [40.0] * ls.WINDOW_SAMPLES)
    route = _routes_by_key(reg.snapshot())[("GET", "/quiz/deck")]
    assert route["p95_ms"] == 40.0
    assert route["max_ms"] == 5000.0    # lifetime worst case is still on record


def test_status_classes_are_counted_separately(reg):
    _fill(reg, "GET", "/srs/feed", [10.0] * 90, status=200)
    _fill(reg, "GET", "/srs/feed", [10.0] * 6, status=401)
    _fill(reg, "GET", "/srs/feed", [10.0] * 4, status=500)

    route = _routes_by_key(reg.snapshot())[("GET", "/srs/feed")]
    assert (route["client_errors"], route["server_errors"]) == (6, 4)
    assert route["server_error_rate"] == 4.0


def test_empty_registry_snapshot_is_safe(reg):
    snap = reg.snapshot()
    assert snap["routes"] == []
    assert snap["overall_p95_ms"] is None
    assert snap["total_requests"] == 0


def test_overall_percentiles_are_traffic_weighted(reg):
    """A rarely-hit slow route must not drag the app-wide number: the pooled
    window is one sample per request, not one per route."""
    _fill(reg, "GET", "/health", [10.0] * 999)
    _fill(reg, "GET", "/admin/stats", [4000.0])

    snap = reg.snapshot()
    assert snap["overall_p50_ms"] == 10.0
    assert snap["overall_p95_ms"] == 10.0
    assert snap["overall_p99_ms"] == 10.0


# ── report bands ─────────────────────────────────────────────────────────────

def _report(reg: ls.LatencyRegistry) -> dict:
    return ls.build_report(reg.snapshot())


def _metrics(report: dict) -> dict[str, dict]:
    return {m["key"]: m for m in report["metrics"]}


def test_fast_api_reports_ok(reg):
    _fill(reg, "GET", "/health", [8.0] * 100)
    report = _report(reg)

    assert report["overall_status"] == ls.OK
    assert _metrics(report)["overall_p95_ms"]["value"] == 8.0


def test_slow_route_warns_then_fails(reg):
    _fill(reg, "GET", "/movies/{movie_id}/vocabulary/full", [800.0] * 50)
    assert _report(reg)["routes"][0]["status"] == ls.WARN

    reg.reset()
    _fill(reg, "GET", "/movies/{movie_id}/vocabulary/full", [21000.0] * 50)
    assert _report(reg)["routes"][0]["status"] == "fail"


def test_thin_sample_can_warn_but_never_fail(reg):
    """One cold-start request is not evidence that an endpoint is broken."""
    _fill(reg, "GET", "/movies/{movie_id}", [9000.0] * 3)
    report = _report(reg)

    assert report["routes"][0]["status"] == ls.WARN
    assert report["overall_status"] == ls.WARN


def test_server_errors_fail_even_when_fast(reg):
    _fill(reg, "GET", "/quiz/deck", [12.0] * 90, status=200)
    _fill(reg, "GET", "/quiz/deck", [12.0] * 10, status=500)
    report = _report(reg)

    assert _metrics(report)["server_error_rate"]["value"] == 10.0
    assert report["overall_status"] == "fail"


def test_slowest_route_is_named(reg):
    _fill(reg, "GET", "/health", [5.0] * 100)
    _fill(reg, "GET", "/movies/{movie_id}/vocabulary/full", [1200.0] * 30)
    slowest = _metrics(_report(reg))["slowest_route_p95_ms"]

    assert slowest["value"] == 1200.0
    assert "/movies/{movie_id}/vocabulary/full" in slowest["detail"]


def test_routes_are_sorted_slowest_first(reg):
    _fill(reg, "GET", "/health", [5.0] * 30)
    _fill(reg, "GET", "/srs/feed", [300.0] * 30)
    _fill(reg, "GET", "/movies/{movie_id}/vocabulary/full", [1200.0] * 30)

    assert [r["route"] for r in _report(reg)["routes"]] == [
        "/movies/{movie_id}/vocabulary/full",
        "/srs/feed",
        "/health",
    ]


def test_over_budget_count_tracks_the_whole_surface(reg):
    _fill(reg, "GET", "/health", [5.0] * 30)
    _fill(reg, "GET", "/srs/feed", [900.0] * 30)
    _fill(reg, "GET", "/movies/{movie_id}/vocabulary/full", [1200.0] * 30)

    m = _metrics(_report(reg))["routes_over_budget"]
    assert m["value"] == 2
    assert m["status"] == ls.WARN


def test_cold_report_is_ok_and_says_so(reg):
    report = _report(reg)
    metrics = _metrics(report)

    assert report["overall_status"] == ls.OK
    assert report["routes"] == []
    assert metrics["overall_p95_ms"]["value"] is None
    assert metrics["requests_observed"]["value"] == 0


def test_report_carries_the_shared_metric_contract(reg):
    """The admin app renders any /admin/health/* report with one component, so
    every metric must carry the same keys the vocab-coverage view expects."""
    _fill(reg, "GET", "/health", [8.0] * 30)
    required = {"key", "label", "value", "unit", "status", "threshold",
                "warn_at", "fail_at", "direction", "max_value"}

    for m in _report(reg)["metrics"]:
        assert required <= set(m)
        assert m["status"] in (ls.OK, ls.WARN, "fail")


# ── route-level guard (mirrors tests/test_vocab_coverage.py) ──────────────────

def _dependency_calls(router, path: str, method: str) -> set:
    for route in router.routes:
        if getattr(route, "path", None) == path and method in getattr(route, "methods", set()):
            calls: set = set()

            def walk(dependant):
                for sub in dependant.dependencies:
                    if sub.call is not None:
                        calls.add(sub.call)
                    walk(sub)

            walk(route.dependant)
            return calls
    raise AssertionError(f"route {method} {path} not found on router")


def test_latency_health_requires_admin_and_throttle():
    from src.routes.admin import router

    calls = _dependency_calls(router, "/admin/health/latency", "GET")
    assert get_admin_user in calls
    assert any(getattr(c, "__qualname__", "").startswith("rate_limit.") for c in calls)
