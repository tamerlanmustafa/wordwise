"""The load tests cannot be pointed at production by accident.

`loadtest/head-of-line.js` exists to find the request that blocks the event
loop. Run against prod, a *successful* run is an outage: there is one uvicorn
process on one replica with no autoscaler behind it, so the load competes with
real users for the same loop, and the thing the test is hunting for is by
definition the thing that stalls everyone.

The guard that stops that is four lines of JavaScript nobody will read again.
This is the reason it stays: a default that quietly becomes `BASE_URL=$PROD`
in someone's shell profile is not a hypothetical, it is the ordinary way this
goes wrong, and the failure is not a red test — it is a pager.

Deliberately source-reading rather than executing: k6 scripts run on k6's own
JS runtime (`import http from 'k6/http'`), which is not node and is not
installed in CI. Asserting on the source is the only check available here, and
a weak check on the safety property beats no check.
"""

from __future__ import annotations

import re
from pathlib import Path

LOADTEST = Path(__file__).resolve().parent.parent / "loadtest"


def _scripts() -> list[Path]:
    return sorted(LOADTEST.glob("*.js"))


def test_there_are_scripts_to_check() -> None:
    # A guard whose input silently became empty reports no problems and looks
    # like success for ever.
    assert _scripts(), f"no k6 scripts found in {LOADTEST}"


def test_base_url_defaults_to_localhost() -> None:
    for script in _scripts():
        src = script.read_text()
        assert re.search(r"BASE_URL\s*=\s*__ENV\.BASE_URL\s*\|\|\s*'http://localhost:\d+'", src), (
            f"{script.name} must default BASE_URL to localhost"
        )


def test_a_remote_host_is_opt_in_out_loud() -> None:
    """Anything but localhost needs a second, explicit environment variable.

    One variable is a typo away from prod. Two, where the second says
    ALLOW_REMOTE and does nothing else, cannot be set by accident.
    """
    for script in _scripts():
        src = script.read_text()
        assert "WW_ALLOW_REMOTE" in src, f"{script.name} has no remote opt-in"
        # …and the guard must actually stop the run, not warn and continue.
        assert re.search(r"throw new Error\(", src), (
            f"{script.name} must refuse a remote host, not merely warn about it"
        )


def test_the_guard_recognises_every_way_of_writing_localhost() -> None:
    """`localhost`, `127.0.0.1` and `0.0.0.0` are the same machine.

    A guard that only knew the word "localhost" would refuse a perfectly local
    run against 127.0.0.1 — and a refused local run teaches people to set
    ALLOW_REMOTE as a matter of course, which is how the guard stops working.
    """
    for script in _scripts():
        # The hosts live inside a JS regex literal, where the dots are escaped
        # (`127\.0\.0\.1`). Dropping backslashes before looking is what makes
        # this a check on the guard rather than on how it was spelled.
        src = script.read_text().replace("\\", "")
        for host in ("localhost", "127.0.0.1", "0.0.0.0"):
            assert host in src, f"{script.name} does not recognise {host} as local"


def test_the_readme_says_what_a_prod_run_costs() -> None:
    readme = (LOADTEST / "README.md").read_text().lower()
    for phrase in ("one replica", "rate limit", "429"):
        assert phrase in readme, f"loadtest/README.md should mention {phrase!r}"


def test_the_canary_measures_an_endpoint_that_does_no_work() -> None:
    """The victim has to be trivial, or it measures itself.

    `/health` returns a dict literal — no DB, no models, no I/O. Its latency is
    therefore how long the request waited for the loop, which is the entire
    quantity this test exists to report. Point the canary at anything that
    touches Postgres and a slow query becomes indistinguishable from a stalled
    loop.
    """
    src = (LOADTEST / "head-of-line.js").read_text()
    assert "/health" in src
    assert "health_latency" in src


def test_a_run_that_never_landed_cannot_report_a_clean_ratio() -> None:
    """The trap this file's sibling README documents, caught in the source.

    A 429 is answered by middleware before any route runs, so it costs the
    event loop nothing. A run that was mostly throttled therefore measures an
    idle server and reports a beautiful ratio — which is the worst failure a
    load test has, because it is indistinguishable from good news. Measured on
    prod on 2026-09-10: 84% of load requests 429'd and the summary said
    "0.94x - the offloads are holding".
    """
    src = (LOADTEST / "head-of-line.js").read_text()
    # k6 itself must fail the run...
    assert re.search(r"'heavy_ok':\s*\['rate>", src), "heavy_ok needs a threshold, or a throttled run exits 0"
    # ...and the human-readable summary must say so in words.
    assert "INVALID" in src


def test_the_two_phases_stay_comparable() -> None:
    """Baseline and under-load must be the same request, tagged, not two
    different scenarios — otherwise the comparison is between two connection
    pools rather than between a free loop and a busy one."""
    src = (LOADTEST / "head-of-line.js").read_text()
    assert "phase:baseline" in src
    assert "phase:under_load" in src
