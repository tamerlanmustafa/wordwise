"""
Event-loop lag watchdog (issue #146).

#141-#145 were all found by reading route files by hand. That does not scale,
because a blocking call inside an `async def` is invisible three separate ways:

- **It looks exactly like correct code.** `verify_password(...)` and
  `nlp(text)` are ordinary function calls. Python has no notion of "this one
  blocks", so there is no error, no warning and no type to check.
- **One user never sees it.** The symptom needs >=2 concurrent requests; every
  one of #141-#145 was tested, worked, and shipped.
- **Static analysis cannot see it either.** Verified, not assumed: ruff's
  `ASYNC` ruleset over all of `backend/src` finds two blocking `open()` calls
  and *none* of #141-#145. A linter knows the blocking APIs it was taught
  (`open`, `time.sleep`, `requests`); it cannot know `verify_password` costs
  173ms.

So the only layer that catches what nobody predicted is runtime detection, and
that is this module: a task that sleeps a fixed interval and measures how
*late* it comes back. When something monopolises the loop, `asyncio.sleep`
returns late by exactly the blocking duration — a direct measurement of the
one property the offload rule in `utils/offload.py` exists to protect.

What it can and cannot tell you
-------------------------------
Lag says **that** the loop stalled, **for how long**, and **when**. It does not
say **which handler did it** — every coroutine is stalled equally, including
this one, so there is nothing in the measurement that names a culprit.

Attribution comes from correlating a stall's timestamp with the per-endpoint
data from #130, looking for the #117 signature: the offending endpoint slow
**and** every unrelated endpoint slow in the same window (`/health` at 7.86s
while one vocabulary preview ran). That is why `recent_stalls` carries
timestamps — they are the join key against `/admin/health/latency` and the
`duration_ms` / `route` fields on the access log lines.

If that proves too weak in practice the next step is tracking in-flight
request paths so a stall can name what was running. Deliberately not built up
front (issue #146).

Shape of the numbers
--------------------
In-process and bounded, exactly like `latency_stats`: one rolling window of
recent samples for the percentiles, lifetime counters for the totals, and a
short ring of the most recent stalls. Nothing is persisted, so a deploy resets
the window — the WARNING log lines this emits are the durable record.
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time
from collections import deque
from datetime import datetime, timezone
from math import ceil
from typing import Any, Optional

from .health_metrics import FAIL, OK, WARN, capped_by_sample_size, metric, overall_status, status_max

logger = logging.getLogger(__name__)

# How often the probe wakes. 50ms is fine-grained enough to catch a stall the
# size of one password hash (~173ms) while costing 20 no-op wakeups a second.
PROBE_INTERVAL_S = 0.05

# ~5 minutes of probes at the default interval. Recent enough that the
# percentiles describe *now* rather than an average over the whole uptime.
WINDOW_SAMPLES = 6000

# Lateness that counts as a stall rather than scheduling jitter. The offload
# rule draws its line at ~10ms; this sits well above it so ordinary jitter and
# GC pauses don't cry wolf, while a single bcrypt hash still trips it.
STALL_MS = 100.0
# A stall a user would describe as the app hanging.
SEVERE_STALL_MS = 1000.0
# Most recent stalls kept with their timestamps, for correlating against the
# latency report and the access logs.
RECENT_STALLS_KEPT = 20

# Percentile bands over the recent window. A healthy loop sits under a
# millisecond; tens of milliseconds at p99 means something is regularly
# running too long between awaits.
P99_WARN_MS = 50.0
P99_FAIL_MS = 250.0

# Worst single stall since start. 2s matches the latency report's p95 fail
# band — the point where a screen visibly hangs.
WORST_WARN_MS = 250.0
WORST_FAIL_MS = 2000.0

# Stalls per minute. One is a fluke worth watching; ten a minute means the
# blocking call is on a path real traffic keeps hitting.
STALL_RATE_WARN_PER_MIN = 1.0
STALL_RATE_FAIL_PER_MIN = 10.0

# Share of wall-clock time lost to stalls. Only lateness past STALL_MS counts:
# summing *all* lag would fold ordinary timer jitter into the number (0.5ms of
# overshoot on a 50ms probe is already 1%), and jitter is not the loop being
# held. Sub-threshold drift is the p99 metric's job.
STALLED_WARN_PCT = 1.0
STALLED_FAIL_PCT = 5.0

# No probe for this long means the watchdog task is dead — or the loop is
# blocked *right now*, which is the same headline either way.
STALE_PROBE_S = 30.0

# A p99 over a second of probes is noise. Below this a stall can still WARN but
# never fails the dashboard on its own.
MIN_SAMPLES_FOR_FAIL = 200

# Ceiling on stall WARNING lines per minute. A systemically blocked loop would
# otherwise emit one every probe and bury the rest of the log; the suppressed
# count rides along on the next line that gets through.
MAX_STALL_LOGS_PER_MIN = 6

_NONE = ""
_STALL = "stall"
_SEVERE = "severe"


def _percentile(sorted_values: list[float], pct: float) -> float:
    """Nearest-rank percentile over an already-sorted, non-empty list."""
    rank = max(1, ceil(pct / 100.0 * len(sorted_values)))
    return sorted_values[min(rank, len(sorted_values)) - 1]


class EventLoopLagMonitor:
    """Thread-safe rolling record of how late the probe came back.

    The probe writes from the event loop, but the admin read sorts the whole
    window and can land on any worker thread, so the lock is not ceremonial.
    """

    def __init__(
        self,
        *,
        window_samples: int = WINDOW_SAMPLES,
        stall_ms: float = STALL_MS,
        severe_ms: float = SEVERE_STALL_MS,
        interval_s: float = PROBE_INTERVAL_S,
    ) -> None:
        self._lock = threading.Lock()
        self._window_samples = window_samples
        self._stall_ms = stall_ms
        self._severe_ms = severe_ms
        self._interval_s = interval_s
        self._samples: deque[float] = deque(maxlen=window_samples)
        self._recent_stalls: deque[dict[str, Any]] = deque(maxlen=RECENT_STALLS_KEPT)
        self._count = 0
        self._stalled_ms = 0.0
        self._stalls = 0
        self._severe_stalls = 0
        self._worst_ms = 0.0
        self._worst_at: Optional[datetime] = None
        self._last_probe_at: Optional[datetime] = None
        self._started_at = datetime.now(timezone.utc)

    def note_interval(self, interval_s: float) -> None:
        """The probe declares the cadence it is actually running at.

        Without this the report could claim one interval while the watchdog ran
        at another — the screen prints "checked every 50 ms" as fact, so the
        probe, not the constant, has to be the source of it.
        """
        with self._lock:
            self._interval_s = interval_s

    def record(self, lag_ms: float, at: Optional[datetime] = None) -> str:
        """Add one probe result. Returns "", "stall" or "severe".

        The severity is returned rather than logged here so the monitor stays
        pure bookkeeping and the caller owns log throttling.
        """
        moment = at or datetime.now(timezone.utc)
        with self._lock:
            self._samples.append(lag_ms)
            self._count += 1
            self._last_probe_at = moment
            if lag_ms > self._worst_ms:
                self._worst_ms = lag_ms
                self._worst_at = moment

            if lag_ms < self._stall_ms:
                return _NONE

            self._stalled_ms += lag_ms
            self._stalls += 1
            severity = _STALL
            if lag_ms >= self._severe_ms:
                self._severe_stalls += 1
                severity = _SEVERE
            self._recent_stalls.append(
                {"at": moment.isoformat(), "lag_ms": round(lag_ms, 1), "severity": severity}
            )
            return severity

    def snapshot(self, now: Optional[datetime] = None) -> dict[str, Any]:
        """Raw aggregates. Pure data — `build_report` turns it into metrics."""
        moment = now or datetime.now(timezone.utc)
        with self._lock:
            ordered = sorted(self._samples)
            count = self._count
            stalled_ms = self._stalled_ms
            stalls = self._stalls
            severe = self._severe_stalls
            worst_ms = self._worst_ms
            worst_at = self._worst_at
            last_probe_at = self._last_probe_at
            started_at = self._started_at
            recent = list(reversed(self._recent_stalls))

        uptime_s = max((moment - started_at).total_seconds(), 0.0)
        # Guard the rate maths on a just-started process: a stall in the first
        # second must not report as 60/min.
        rate_window_min = max(uptime_s, 60.0) / 60.0
        return {
            "since": started_at.isoformat(),
            "uptime_seconds": round(uptime_s, 1),
            "probes": count,
            "sampled": len(ordered),
            "probe_interval_ms": round(self._interval_s * 1000, 1),
            "window_samples": self._window_samples,
            "stall_threshold_ms": self._stall_ms,
            "severe_threshold_ms": self._severe_ms,
            "last_probe_at": last_probe_at.isoformat() if last_probe_at else None,
            "seconds_since_probe": (
                round((moment - last_probe_at).total_seconds(), 1) if last_probe_at else None
            ),
            "p50_ms": round(_percentile(ordered, 50), 2) if ordered else None,
            "p95_ms": round(_percentile(ordered, 95), 2) if ordered else None,
            "p99_ms": round(_percentile(ordered, 99), 2) if ordered else None,
            "worst_ms": round(worst_ms, 2),
            "worst_at": worst_at.isoformat() if worst_at else None,
            "stalls": stalls,
            "severe_stalls": severe,
            "stalls_per_min": round(stalls / rate_window_min, 2),
            "stalled_ms": round(stalled_ms, 1),
            # Every probe covers `interval + lag` of wall clock, so the summed
            # lateness of the stalling probes, over the elapsed time, is the
            # share of the loop's life spent unavailable to everyone else.
            # Clamped: a share of wall clock cannot exceed all of it.
            "stalled_pct": (
                round(min(100.0, 100.0 * stalled_ms / (uptime_s * 1000.0)), 2)
                if uptime_s > 0 else 0.0
            ),
            "recent_stalls": recent,
        }

    def reset(self) -> None:
        """Drop everything. Used by tests; there is no runtime caller."""
        with self._lock:
            self._samples.clear()
            self._recent_stalls.clear()
            self._count = 0
            self._stalled_ms = 0.0
            self._stalls = 0
            self._severe_stalls = 0
            self._worst_ms = 0.0
            self._worst_at = None
            self._last_probe_at = None
            self._started_at = datetime.now(timezone.utc)


# The one monitor the probe writes to and the admin endpoint reads.
monitor = EventLoopLagMonitor()


class _StallLogThrottle:
    """Cap stall WARNINGs per minute, carrying the suppressed count forward.

    A loop that is blocked continuously would otherwise log on every probe,
    which turns the one signal worth reading into the noise around it.
    """

    def __init__(self, per_minute: int = MAX_STALL_LOGS_PER_MIN) -> None:
        self._per_minute = per_minute
        self._window_started = 0.0
        self._emitted = 0
        self._suppressed = 0

    def allow(self, now: Optional[float] = None) -> tuple[bool, int]:
        """Returns (may log, stalls suppressed since the last line that did)."""
        moment = time.monotonic() if now is None else now
        if moment - self._window_started >= 60.0:
            self._window_started = moment
            self._emitted = 0
        if self._emitted >= self._per_minute:
            self._suppressed += 1
            return False, 0
        self._emitted += 1
        suppressed, self._suppressed = self._suppressed, 0
        return True, suppressed


async def watch_event_loop(
    mon: Optional[EventLoopLagMonitor] = None,
    interval: float = PROBE_INTERVAL_S,
) -> None:
    """Probe forever, recording how late each wake-up is. Cancel it to stop.

    `asyncio.sleep(interval)` can only return on time if the loop is free to
    run this coroutine at the moment the timer fires. Anything that holds the
    thread past then — a spaCy parse, a bcrypt hash, a PDF extraction — shows
    up here as lateness equal to its own duration.
    """
    target = mon if mon is not None else monitor
    target.note_interval(interval)
    throttle = _StallLogThrottle()

    while True:
        started = time.perf_counter()
        await asyncio.sleep(interval)
        lag_ms = max(0.0, (time.perf_counter() - started) - interval) * 1000.0

        try:
            severity = target.record(lag_ms)
            if severity:
                allowed, suppressed = throttle.allow()
                if allowed:
                    logger.warning(
                        "event loop blocked for %.0fms", lag_ms,
                        extra={
                            "event": "event_loop_stall",
                            "lag_ms": round(lag_ms, 1),
                            "severity": severity,
                            "suppressed_stalls": suppressed,
                        },
                    )
        except Exception:  # pragma: no cover - defensive
            # Bookkeeping must never be able to kill the probe: a watchdog that
            # dies silently is worse than no watchdog, because the report then
            # shows a healthy loop forever.
            logger.debug("event loop lag bookkeeping failed", exc_info=True)


def start_watchdog(
    mon: Optional[EventLoopLagMonitor] = None,
    interval: float = PROBE_INTERVAL_S,
) -> asyncio.Task:
    """Launch the probe on the running loop. Cancel the task on shutdown."""
    return asyncio.create_task(watch_event_loop(mon, interval), name="event-loop-watchdog")


# ── report assembly (pure) ──────────────────────────────────────────────────

def _describe_when(iso: Optional[str], now: Optional[datetime] = None) -> str:
    """"4 min ago" for a stall timestamp — relative reads faster than a clock."""
    if not iso:
        return "never"
    moment = now or datetime.now(timezone.utc)
    try:
        when = datetime.fromisoformat(iso)
    except ValueError:  # pragma: no cover - defensive
        return iso
    seconds = max((moment - when).total_seconds(), 0.0)
    if seconds < 90:
        return f"{int(seconds)}s ago"
    if seconds < 5400:
        return f"{int(seconds / 60)} min ago"
    return f"{seconds / 3600:.1f} h ago"


def build_report(snap: dict[str, Any], now: Optional[datetime] = None) -> dict[str, Any]:
    """Turn a monitor snapshot into the standard /admin/health/* report."""
    moment = now or datetime.now(timezone.utc)
    sampled = snap["sampled"]
    metrics: list[dict] = []

    # 1. p99 lateness — the everyday number. A healthy single-process API sits
    # under a millisecond here; anything else means work is running between
    # awaits that should have been offloaded.
    p99 = snap["p99_ms"]
    metrics.append(metric(
        "loop_lag_p99_ms",
        "Event loop lag (p99)",
        p99, "ms",
        capped_by_sample_size(
            status_max(p99, warn=P99_WARN_MS, fail=P99_FAIL_MS), sampled, MIN_SAMPLES_FOR_FAIL
        ) if p99 is not None else WARN,
        f"warn >{P99_WARN_MS:g}ms, fail >{P99_FAIL_MS:g}ms",
        detail=(
            f"99th percentile of {sampled:,} probes {snap['probe_interval_ms']:g}ms apart "
            f"(p50 {snap['p50_ms']}ms, p95 {snap['p95_ms']}ms)"
            if p99 is not None
            else "no probes recorded yet — the watchdog may not be running"
        ),
        warn_at=P99_WARN_MS, fail_at=P99_FAIL_MS, direction="max",
    ))

    # 2. The worst single stall, and when. This is the one that names an
    # incident: its timestamp is what you take to the latency report and the
    # access logs to find what was running.
    worst = snap["worst_ms"]
    metrics.append(metric(
        "worst_stall_ms",
        "Longest stall",
        worst, "ms",
        status_max(worst, warn=WORST_WARN_MS, fail=WORST_FAIL_MS),
        f"warn >{WORST_WARN_MS:g}ms, fail >{WORST_FAIL_MS:g}ms",
        detail=(
            f"every other request waited this long — {_describe_when(snap['worst_at'], moment)}"
            if snap["worst_at"]
            else "no stall recorded since this instance started"
        ),
        warn_at=WORST_WARN_MS, fail_at=WORST_FAIL_MS, direction="max",
    ))

    # 3. How often it happens. One stall is a fluke; a rate means the blocking
    # call sits on a path that real traffic keeps hitting.
    metrics.append(metric(
        "stall_rate_per_min",
        "Stalls per minute",
        snap["stalls_per_min"], "per min",
        status_max(
            snap["stalls_per_min"], warn=STALL_RATE_WARN_PER_MIN, fail=STALL_RATE_FAIL_PER_MIN
        ),
        f"warn >{STALL_RATE_WARN_PER_MIN:g}/min, fail >{STALL_RATE_FAIL_PER_MIN:g}/min",
        detail=(
            f"{snap['stalls']:,} waits over {snap['stall_threshold_ms']:g}ms "
            f"({snap['severe_stalls']:,} over {snap['severe_threshold_ms']:g}ms) "
            f"in the {_uptime_phrase(snap['uptime_seconds'])} since this instance started"
        ),
        warn_at=STALL_RATE_WARN_PER_MIN, fail_at=STALL_RATE_FAIL_PER_MIN, direction="max",
    ))

    # 4. Total time the API was unavailable to everyone. Bounded, so it renders
    # as a meter: "the loop spent 6% of its life serving nobody".
    metrics.append(metric(
        "stalled_time_pct",
        "Time the loop was stalled",
        snap["stalled_pct"], "%",
        capped_by_sample_size(
            status_max(snap["stalled_pct"], warn=STALLED_WARN_PCT, fail=STALLED_FAIL_PCT),
            sampled, MIN_SAMPLES_FOR_FAIL,
        ),
        f"warn >{STALLED_WARN_PCT:g}%, fail >{STALLED_FAIL_PCT:g}%",
        detail=(
            f"{snap['stalled_ms'] / 1000:.1f}s spent in stalls over "
            f"{snap['stall_threshold_ms']:g}ms, out of the "
            f"{_uptime_phrase(snap['uptime_seconds'])} this instance has been up"
        ),
        warn_at=STALLED_WARN_PCT, fail_at=STALLED_FAIL_PCT,
        direction="max", max_value=100.0,
    ))

    # 5. Is the watchdog itself alive? Without this a dead probe reads as a
    # perfectly healthy loop forever, which is the worst failure mode a
    # monitor can have.
    metrics.append(metric(
        "watchdog_probes",
        "Watchdog probes",
        snap["probes"], "probes",
        _watchdog_status(snap),
        f"fail if no probe for {STALE_PROBE_S:g}s",
        detail=_watchdog_detail(snap),
        direction="min",
    ))

    return {
        "generated_at": moment.isoformat(),
        "overall_status": overall_status(metrics),
        "window_started_at": snap["since"],
        "probe_interval_ms": snap["probe_interval_ms"],
        "stall_threshold_ms": snap["stall_threshold_ms"],
        "severe_threshold_ms": snap["severe_threshold_ms"],
        "metrics": metrics,
        "recent_stalls": snap["recent_stalls"],
    }


def _uptime_phrase(seconds: float) -> str:
    if seconds < 90:
        return f"{int(seconds)}s"
    if seconds < 5400:
        return f"{int(seconds / 60)} min"
    return f"{seconds / 3600:.1f} h"


def _watchdog_status(snap: dict[str, Any]) -> str:
    """OK while probes keep arriving; FAIL once they stop.

    A gap this long is either a dead task or a loop blocked right now, and the
    report must not claim health in either case.
    """
    if snap["probes"] == 0:
        return WARN
    since = snap["seconds_since_probe"]
    if since is not None and since > STALE_PROBE_S:
        return FAIL
    return OK


def _watchdog_detail(snap: dict[str, Any]) -> str:
    if snap["probes"] == 0:
        return "the watchdog has not reported yet — every other number here is meaningless until it does"
    since = snap["seconds_since_probe"]
    if since is not None and since > STALE_PROBE_S:
        return (
            f"no probe for {since:.0f}s — the watchdog task died, or the loop is blocked right now"
        )
    return (
        f"probing every {snap['probe_interval_ms']:g}ms; "
        f"the last {snap['sampled']:,} are what the percentiles above describe"
    )


def compute_event_loop_report() -> dict[str, Any]:
    """Live report off the process-wide monitor."""
    return build_report(monitor.snapshot())


__all__ = [
    "EventLoopLagMonitor",
    "build_report",
    "compute_event_loop_report",
    "monitor",
    "start_watchdog",
    "watch_event_loop",
]
