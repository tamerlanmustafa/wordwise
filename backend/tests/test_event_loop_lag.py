"""
Tests for the event-loop lag watchdog (GET /admin/health/event-loop, issue #146).

#141-#145 were each found by reading route files by hand, because a blocking
call inside an `async def` is invisible to ruff, to a single-user test and to
reviewing one function in isolation. The watchdog is the runtime layer that
catches the next one, so what matters here is:

1. It actually detects a real block — a `time.sleep` on the loop thread is
   measured as lateness of about that duration. This is the regression guard.
2. The probe keeps running afterwards, and a stall in bookkeeping can't kill
   it: a watchdog that dies silently reports a healthy loop forever.
3. Bookkeeping: rolling window, percentiles, stall classification, the
   lifetime worst with its timestamp, and the recent-stall ring that is the
   join key against /admin/health/latency.
4. `build_report`'s ok/warn/fail bands, which are pure.
5. The stale-probe check, which is the difference between "the loop is fine"
   and "nothing has measured the loop for a minute".

Route-level guard assertion mirrors tests/test_latency_stats.py.
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta, timezone

import pytest

from src.middleware.auth import get_admin_user
from src.services import event_loop_lag as ell


@pytest.fixture
def mon() -> ell.EventLoopLagMonitor:
    return ell.EventLoopLagMonitor()


def _fill(monitor: ell.EventLoopLagMonitor, lags, *, spacing_ms: float = 50.0) -> datetime:
    """Record a series of lags spaced along the monitor's own uptime.

    Anchored to the monitor's start (not a fixed date) because the report reads
    the gap between the last probe and now — a series floating free of the
    monitor's clock would always look like a dead watchdog. Returns the last
    probe's timestamp so callers can pick a sane `now`.
    """
    base = monitor._started_at
    at = base
    for i, lag in enumerate(lags):
        at = base + timedelta(milliseconds=spacing_ms * i)
        monitor.record(float(lag), at=at)
    return at


def _metrics(report: dict) -> dict[str, dict]:
    return {m["key"]: m for m in report["metrics"]}


# ── 1-2. it detects a real block, and survives it ────────────────────────────

async def test_measures_a_real_block_on_the_loop():
    """The whole point: work that pins the thread shows up as lateness of about
    its own duration. This is the shape of every one of #141-#145 — a 173ms
    bcrypt hash or a 2s spaCy parse sitting inside an `async def`."""
    monitor = ell.EventLoopLagMonitor()
    task = ell.start_watchdog(monitor, interval=0.01)
    try:
        await asyncio.sleep(0.05)          # let a few clean probes land
        time.sleep(0.3)                    # stands in for spaCy/bcrypt: blocking
        await asyncio.sleep(0.05)          # let the probe report the lateness
    finally:
        task.cancel()

    snap = monitor.snapshot()
    assert snap["stalls"] >= 1
    # ~300ms, generous on both sides for a loaded CI box.
    assert 250 <= snap["worst_ms"] <= 900
    assert snap["recent_stalls"][0]["severity"] == ell._STALL


async def test_probe_keeps_running_after_a_stall():
    """A watchdog that stops probing reports a permanently healthy loop, which
    is worse than no watchdog. It must keep measuring after it fires."""
    monitor = ell.EventLoopLagMonitor()
    task = ell.start_watchdog(monitor, interval=0.01)
    try:
        time.sleep(0.2)
        await asyncio.sleep(0.02)
        after_stall = monitor.snapshot()["probes"]
        await asyncio.sleep(0.05)
        later = monitor.snapshot()["probes"]
        still_running = not task.done()
    finally:
        task.cancel()

    assert later > after_stall
    assert still_running


async def test_a_free_loop_reports_near_zero_lag():
    """The negative control: with nothing blocking, lateness is jitter, not a
    stall. Without this the detector could be trivially always-on."""
    monitor = ell.EventLoopLagMonitor()
    task = ell.start_watchdog(monitor, interval=0.01)
    try:
        await asyncio.sleep(0.2)
    finally:
        task.cancel()

    snap = monitor.snapshot()
    assert snap["probes"] >= 5
    assert snap["stalls"] == 0
    assert snap["worst_ms"] < ell.STALL_MS


async def test_bookkeeping_failure_does_not_kill_the_probe(monkeypatch):
    monitor = ell.EventLoopLagMonitor()
    calls = {"n": 0}

    def exploding_record(lag_ms, at=None):
        calls["n"] += 1
        raise RuntimeError("boom")

    monkeypatch.setattr(monitor, "record", exploding_record)
    task = ell.start_watchdog(monitor, interval=0.01)
    try:
        await asyncio.sleep(0.08)
        still_running = not task.done()
    finally:
        task.cancel()

    assert calls["n"] > 2      # it kept probing despite every call raising
    assert still_running


# ── 3. bookkeeping ───────────────────────────────────────────────────────────

def test_classifies_jitter_stalls_and_severe_stalls(mon):
    assert mon.record(5.0) == ""
    assert mon.record(150.0) == ell._STALL
    assert mon.record(2500.0) == ell._SEVERE

    snap = mon.snapshot()
    assert snap["stalls"] == 2          # the severe one counts as a stall too
    assert snap["severe_stalls"] == 1
    assert snap["worst_ms"] == 2500.0


def test_percentiles_track_the_tail_not_the_average(mon):
    """99 quiet probes must not hide the one that stalled, the way a mean
    would — this is the same reason /admin/health/latency reports a p95."""
    _fill(mon, [1.0] * 99 + [2000.0])

    snap = mon.snapshot()
    assert snap["p50_ms"] == 1.0
    assert snap["p95_ms"] == 1.0
    assert snap["p99_ms"] == 1.0
    assert snap["worst_ms"] == 2000.0


def test_window_is_bounded_but_lifetime_counters_are_not():
    monitor = ell.EventLoopLagMonitor(window_samples=10)
    _fill(monitor, [1.0] * 50)

    snap = monitor.snapshot()
    assert snap["sampled"] == 10        # the percentile window rolls
    assert snap["probes"] == 50         # the lifetime count does not


def test_recent_stalls_are_newest_first_with_timestamps(mon):
    """The timestamps are the join key against the latency report and the
    access logs — attribution is correlation, not something lag can answer."""
    start = datetime(2026, 8, 18, 12, 0, tzinfo=timezone.utc)
    mon.record(500.0, at=start)
    mon.record(1.0, at=start + timedelta(seconds=1))
    mon.record(900.0, at=start + timedelta(seconds=2))

    recent = mon.snapshot()["recent_stalls"]
    assert [r["lag_ms"] for r in recent] == [900.0, 500.0]
    assert recent[0]["at"] == (start + timedelta(seconds=2)).isoformat()


def test_recent_stalls_ring_is_capped(mon):
    _fill(mon, [500.0] * (ell.RECENT_STALLS_KEPT + 15))
    assert len(mon.snapshot()["recent_stalls"]) == ell.RECENT_STALLS_KEPT


def test_worst_carries_the_moment_it_happened(mon):
    start = datetime(2026, 8, 18, 12, 0, tzinfo=timezone.utc)
    mon.record(120.0, at=start)
    mon.record(3000.0, at=start + timedelta(seconds=30))
    mon.record(200.0, at=start + timedelta(seconds=60))

    snap = mon.snapshot()
    assert snap["worst_ms"] == 3000.0
    assert snap["worst_at"] == (start + timedelta(seconds=30)).isoformat()


def test_stalled_pct_is_stall_time_over_wall_clock(mon):
    """Six seconds of stalls in a minute of uptime = 10% of the API's life
    spent serving nobody."""
    _fill(mon, [1000.0] * 6, spacing_ms=1000.0)

    snap = mon.snapshot(now=mon._started_at + timedelta(seconds=60))
    assert snap["stalled_ms"] == 6000.0
    assert snap["stalled_pct"] == pytest.approx(10.0, abs=0.5)


def test_ordinary_jitter_is_not_counted_as_stalled_time(mon):
    """A 0.5ms overshoot on a 50ms probe is 1% of wall clock but not a stall.
    Folding it in would make a healthy loop warn forever."""
    last = _fill(mon, [0.5] * 400)

    snap = mon.snapshot(now=last + timedelta(seconds=1))
    assert snap["stalled_ms"] == 0.0
    assert snap["stalled_pct"] == 0.0
    assert snap["p99_ms"] == 0.5


def test_stall_rate_is_not_extrapolated_from_a_young_process(mon):
    """One stall two seconds after boot is one stall, not thirty a minute."""
    mon.record(500.0)

    snap = mon.snapshot(now=mon._started_at + timedelta(seconds=2))
    assert snap["stalls_per_min"] == 1.0


def test_cold_monitor_reports_no_data_rather_than_zero_lag(mon):
    snap = mon.snapshot()
    assert snap["probes"] == 0
    assert snap["p99_ms"] is None
    assert snap["last_probe_at"] is None
    assert snap["recent_stalls"] == []


def test_reset_clears_everything(mon):
    _fill(mon, [500.0] * 5)
    mon.reset()

    snap = mon.snapshot()
    assert snap["probes"] == 0
    assert snap["stalls"] == 0
    assert snap["worst_ms"] == 0.0


# ── log throttle ─────────────────────────────────────────────────────────────

def test_stall_logs_are_capped_per_minute_and_carry_the_suppressed_count():
    """A continuously blocked loop would otherwise log 20 lines a second and
    bury the signal in its own noise."""
    throttle = ell._StallLogThrottle(per_minute=2)

    assert throttle.allow(now=0.0) == (True, 0)
    assert throttle.allow(now=1.0) == (True, 0)
    assert throttle.allow(now=2.0) == (False, 0)
    assert throttle.allow(now=3.0) == (False, 0)
    # New window: the line that gets through says how many it stood in for.
    assert throttle.allow(now=61.0) == (True, 2)


# ── 4. report bands ──────────────────────────────────────────────────────────

def _report(monitor: ell.EventLoopLagMonitor, now: datetime | None = None) -> dict:
    return ell.build_report(monitor.snapshot(now=now), now=now)


def test_healthy_loop_is_ok_across_the_board(mon):
    last = _fill(mon, [0.4] * (ell.MIN_SAMPLES_FOR_FAIL + 50))

    report = _report(mon, now=last + timedelta(seconds=1))
    assert report["overall_status"] == ell.OK
    assert _metrics(report)["loop_lag_p99_ms"]["value"] == 0.4


def test_one_long_stall_fails_the_longest_stall_metric(mon):
    last = _fill(mon, [0.4] * 500 + [7860.0])   # the #117 production stall, to the ms

    metrics = _metrics(_report(mon, now=last + timedelta(seconds=1)))
    assert metrics["worst_stall_ms"]["value"] == 7860.0
    assert metrics["worst_stall_ms"]["status"] == ell.FAIL


def test_a_thin_sample_can_warn_but_never_fails_the_dashboard(mon):
    """Boot noise on a handful of probes must not paint the report red."""
    last = _fill(mon, [900.0] * 5)

    metrics = _metrics(_report(mon, now=last + timedelta(seconds=1)))
    assert metrics["loop_lag_p99_ms"]["status"] == ell.WARN


def test_repeated_stalls_fail_the_rate_metric(mon):
    _fill(mon, [400.0] * 30, spacing_ms=1000.0)

    metrics = _metrics(_report(mon, now=mon._started_at + timedelta(seconds=60)))
    assert metrics["stall_rate_per_min"]["value"] == 30.0
    assert metrics["stall_rate_per_min"]["status"] == ell.FAIL


def test_stalled_time_renders_as_a_meter(mon):
    """max_value present = the admin app draws a meter with threshold markers
    rather than a bare stat tile."""
    last = _fill(mon, [1.0] * 300)

    m = _metrics(_report(mon, now=last + timedelta(seconds=1)))["stalled_time_pct"]
    assert m["max_value"] == 100.0
    assert m["warn_at"] == ell.STALLED_WARN_PCT
    assert m["fail_at"] == ell.STALLED_FAIL_PCT


# ── 5. the watchdog's own liveness ───────────────────────────────────────────

def test_a_dead_watchdog_fails_instead_of_reporting_health(mon):
    """The worst failure mode a monitor has: probes stop, and the report keeps
    saying the loop is fine because nothing new ever arrives."""
    last = _fill(mon, [0.4] * 500)
    stale = last + timedelta(seconds=ell.STALE_PROBE_S + 120)

    report = _report(mon, now=stale)
    watchdog = _metrics(report)["watchdog_probes"]
    assert watchdog["status"] == ell.FAIL
    assert report["overall_status"] == ell.FAIL
    assert "blocked right now" in watchdog["detail"]


def test_a_watchdog_that_never_reported_warns(mon):
    watchdog = _metrics(_report(mon))["watchdog_probes"]
    assert watchdog["status"] == ell.WARN
    assert "not reported yet" in watchdog["detail"]


def test_report_carries_the_shared_metric_contract(mon):
    """The admin app renders any /admin/health/* report with one component, so
    every metric must carry the same keys the other reports do."""
    last = _fill(mon, [1.0] * 300)
    required = {"key", "label", "value", "unit", "status", "threshold",
                "warn_at", "fail_at", "direction", "max_value"}

    for m in _report(mon, now=last + timedelta(seconds=1))["metrics"]:
        assert required <= set(m)
        assert m["status"] in (ell.OK, ell.WARN, ell.FAIL)


# ── route-level guard (mirrors tests/test_latency_stats.py) ───────────────────

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


def test_event_loop_health_requires_admin_and_throttle():
    from src.routes.admin import router

    calls = _dependency_calls(router, "/admin/health/event-loop", "GET")
    assert get_admin_user in calls
    assert any(getattr(c, "__qualname__", "").startswith("rate_limit.") for c in calls)
