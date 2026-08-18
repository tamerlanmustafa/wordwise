"""
Shared metric contract for the /admin/health/* reports.

Every health endpoint returns the same metric shape — value, unit, ok/warn/fail
status, the threshold band in both human and structured form — so the admin app
can render any of them with one component instead of one view per endpoint.
This module owns that shape and the band classifiers; each report (vocab
coverage, request latency, …) owns only its own thresholds and copy.

Pure: no DB, no clock, no I/O. Anything stateful belongs in the calling service.
"""
from __future__ import annotations

from typing import Any, Optional

OK = "ok"
WARN = "warn"
FAIL = "fail"

STATUS_RANK = {OK: 0, WARN: 1, FAIL: 2}


def status_min(value: float, warn: Optional[float], fail: Optional[float]) -> str:
    """Higher is better. warn/fail are lower bounds; None disables a band."""
    if fail is not None and value < fail:
        return FAIL
    if warn is not None and value < warn:
        return WARN
    return OK


def status_max(value: float, warn: Optional[float], fail: Optional[float]) -> str:
    """Higher is worse. warn/fail are upper bounds; None disables a band."""
    if fail is not None and value > fail:
        return FAIL
    if warn is not None and value > warn:
        return WARN
    return OK


def overall_status(metrics: list[dict]) -> str:
    """The worst status across a report — what the dashboard card shows."""
    worst = OK
    for m in metrics:
        if STATUS_RANK[m["status"]] > STATUS_RANK[worst]:
            worst = m["status"]
    return worst


def metric(
    key: str,
    label: str,
    value,
    unit: str,
    status: str,
    threshold: str,
    *,
    prev=None,
    detail: Optional[str] = None,
    warn_at: Optional[float] = None,
    fail_at: Optional[float] = None,
    direction: Optional[str] = None,
    max_value: Optional[float] = None,
) -> dict:
    """`threshold` is the human-readable band; warn_at/fail_at/direction/max_value
    are the same bands in structured form so the admin UI can draw a meter with
    threshold markers without re-declaring (and drifting from) these numbers.
    max_value present = the metric has a natural scale (a %, or spend vs cap) and
    renders as a meter; absent = an unbounded count, which renders as a stat tile.
    direction is "min" when higher is better, "max" when higher is worse."""
    m: dict[str, Any] = {
        "key": key,
        "label": label,
        "value": value,
        "unit": unit,
        "status": status,
        "threshold": threshold,
        "warn_at": warn_at,
        "fail_at": fail_at,
        "direction": direction,
        "max_value": max_value,
    }
    if detail is not None:
        m["detail"] = detail
    if prev is not None:
        m["previous"] = prev
        if isinstance(value, (int, float)) and isinstance(prev, (int, float)):
            delta = value - prev
            m["delta"] = round(delta, 2) if isinstance(delta, float) else delta
    return m
