"""
Tests for CDN client-IP resolution and GET /admin/health/client-ip (issue #139).

Rate limiting is only as good as the address it keys on. Measured on Railway
2026-08-17: the caller's address reaches the process at no index of any header,
because Railway discards the `X-Forwarded-For` Cloudflare sends and rebuilds
its own. Every anonymous throttle — login, registration, forgot/reset password
— was therefore keying on a rotating pool of infrastructure addresses while
still returning 429s and still looking enforced.

The fix trusts Cloudflare's `CF-Connecting-IP`, which survives the rewrite, but
only when a shared secret proves Cloudflare set it. That proviso is the point:
the Railway origin still answers requests that never went through Cloudflare,
so a client-IP header trusted on its own would let any caller mint a private
rate-limit identity — strictly worse than the shared bucket it replaces. The
tests that matter most here are the ones asserting the header is REFUSED.

The sliding window, the dependency and the middleware are covered in
tests/test_rate_limit.py; this file covers only which address they key on.
"""
from __future__ import annotations

import pytest
from fastapi import Depends, FastAPI, Request
from fastapi.testclient import TestClient

from src.config import get_settings
from src.middleware.auth import get_admin_user
from src.services.client_ip_health import build_report
from src.utils.rate_limit import (
    CLIENT_IP_HEADER_CANDIDATES,
    client_ip_observation,
    rate_limit,
    rate_limit_key_for_ip,
    resolve_client_ip_with_source,
)

CF = "CF-Connecting-IP"
SECRET_HEADER = "X-Origin-Secret"
SECRET = "s3cr3t-value"

# What the app actually receives in prod: Cloudflare's egress then the Railway
# edge, with a Railway-internal socket peer. The caller is at no index of it.
PROD_XFF = "104.22.100.36, 152.233.47.66"
PROD_PEER = "100.64.0.4"
CALLER = "71.117.29.127"


def _getter(headers: dict[str, str]):
    """A case-insensitive HeaderGetter over a plain dict."""
    lowered = {k.lower(): v for k, v in headers.items()}
    return lambda name: lowered.get(name.lower())


@pytest.fixture
def cdn(monkeypatch):
    """Settings as they look once the CDN and the origin secret are wired up."""
    settings = get_settings()
    monkeypatch.setattr(settings, "trusted_client_ip_header", CF)
    monkeypatch.setattr(settings, "trusted_client_ip_secret_header", SECRET_HEADER)
    monkeypatch.setattr(settings, "trusted_client_ip_secret", SECRET)
    monkeypatch.setattr(settings, "trusted_proxy_hops", 0)
    return settings


@pytest.fixture
def unconfigured(monkeypatch):
    """The default, and what prod runs until the Cloudflare rule exists."""
    settings = get_settings()
    monkeypatch.setattr(settings, "trusted_client_ip_header", "")
    monkeypatch.setattr(settings, "trusted_client_ip_secret_header", "")
    monkeypatch.setattr(settings, "trusted_client_ip_secret", "")
    monkeypatch.setattr(settings, "trusted_proxy_hops", 0)
    return settings


# --- resolution order -----------------------------------------------------

def test_trusted_header_wins_when_the_origin_secret_matches(cdn):
    ip, source = resolve_client_ip_with_source(
        _getter({CF: CALLER, SECRET_HEADER: SECRET, "X-Forwarded-For": PROD_XFF}),
        PROD_PEER,
    )
    # The address that appears nowhere in X-Forwarded-For is now the key.
    assert (ip, source) == (CALLER, "trusted-header")


def test_client_ip_header_is_refused_without_the_origin_secret(monkeypatch):
    """The fail-closed guard, and the reason this feature is two settings.

    Railway's origin answers requests that never went through Cloudflare. If
    the header alone were enough, anyone could hit the origin with a header of
    their choosing and get a private bucket per request — no limit would ever
    bind again. Refusing it leaves the shared bucket, which is weak but not
    forgeable.
    """
    settings = get_settings()
    monkeypatch.setattr(settings, "trusted_client_ip_header", CF)
    monkeypatch.setattr(settings, "trusted_client_ip_secret_header", "")
    monkeypatch.setattr(settings, "trusted_client_ip_secret", "")
    monkeypatch.setattr(settings, "trusted_proxy_hops", 0)

    ip, source = resolve_client_ip_with_source(_getter({CF: "1.2.3.4"}), PROD_PEER)
    assert (ip, source) == (PROD_PEER, "socket-peer")


def test_client_ip_header_is_refused_when_the_secret_is_wrong(cdn):
    ip, source = resolve_client_ip_with_source(
        _getter({CF: "1.2.3.4", SECRET_HEADER: "guessed"}), PROD_PEER
    )
    assert (ip, source) == (PROD_PEER, "socket-peer")


def test_client_ip_header_is_refused_when_the_secret_is_absent(cdn):
    """A request that reached the origin without passing through the CDN."""
    ip, source = resolve_client_ip_with_source(_getter({CF: "1.2.3.4"}), PROD_PEER)
    assert (ip, source) == (PROD_PEER, "socket-peer")


def test_a_malformed_trusted_header_does_not_become_a_key(cdn):
    """Every distinct junk value would otherwise be a fresh bucket — a rate
    limit dissolvable by sending garbage, even with the secret in hand."""
    for junk in ("not-an-ip", "", "   ", "1.2.3.4, 5.6.7.8", "example.com"):
        ip, source = resolve_client_ip_with_source(
            _getter({CF: junk, SECRET_HEADER: SECRET}), PROD_PEER
        )
        assert (ip, source) == (PROD_PEER, "socket-peer"), junk


def test_ipv6_is_accepted(cdn):
    ip, source = resolve_client_ip_with_source(
        _getter({CF: "2606:4700:4700::1111", SECRET_HEADER: SECRET}), PROD_PEER
    )
    assert (ip, source) == ("2606:4700:4700::1111", "trusted-header")


def test_falls_back_to_forwarded_for_then_peer(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "trusted_client_ip_header", "")
    monkeypatch.setattr(settings, "trusted_proxy_hops", 2)

    assert resolve_client_ip_with_source(
        _getter({"X-Forwarded-For": "203.0.113.9, 152.233.47.65"}), PROD_PEER
    ) == ("203.0.113.9", "forwarded-for")
    assert resolve_client_ip_with_source(_getter({}), PROD_PEER) == (
        PROD_PEER,
        "socket-peer",
    )
    assert resolve_client_ip_with_source(_getter({}), None) == ("unknown", "none")


def test_the_secret_header_is_matched_case_insensitively(cdn):
    """Header names are case-insensitive over the wire; the *value* is not."""
    ip, _ = resolve_client_ip_with_source(
        _getter({CF.lower(): CALLER, SECRET_HEADER.upper(): SECRET}), PROD_PEER
    )
    assert ip == CALLER


# --- which bucket an address counts against -------------------------------

def test_ipv4_keys_on_the_whole_address():
    assert rate_limit_key_for_ip("71.117.29.127") == "71.117.29.127"


def test_ipv6_keys_on_the_subscriber_prefix_not_the_device():
    """The defeat this closes: a phone's IPv6 suffix rotates (privacy
    extensions), so keying on the full address hands the same caller a fresh
    budget every time their device picks new low bits."""
    assert (
        rate_limit_key_for_ip("2600:4040:27ed:9700:a93d:371:696a:34dc")
        == "2600:4040:27ed:9700::/64"
    )


def test_ipv4_mapped_addresses_are_not_collapsed():
    """::ffff:1.2.3.4 is IPv4 in an IPv6 shape. Treating it as IPv6 would put
    EVERY such caller in the single bucket ::/64 — a total loss of limiting."""
    assert rate_limit_key_for_ip("::ffff:203.0.113.9") == "::ffff:203.0.113.9"
    assert rate_limit_key_for_ip("::ffff:198.51.100.7") != rate_limit_key_for_ip(
        "::ffff:203.0.113.9"
    )


def test_a_non_address_passes_through_rather_than_raising():
    """`unknown` is a real value from `resolve_client_ip_with_source`; the
    limiter must bucket it, not crash on it."""
    assert rate_limit_key_for_ip("unknown") == "unknown"


# --- what the throttles actually do with it -------------------------------

def _app(limit: int) -> FastAPI:
    app = FastAPI()
    throttle = rate_limit(limit, 60.0, scope="test-cdn-ip")

    @app.get("/ping")
    def ping(_: None = Depends(throttle)):
        return {"ok": True}

    return app


def test_two_callers_behind_one_cdn_get_separate_budgets(cdn):
    """The regression guard. Both requests carry the same forwarded chain and
    the same socket peer — only CF-Connecting-IP tells them apart."""
    client = TestClient(_app(limit=2))
    base = {"X-Forwarded-For": PROD_XFF, SECRET_HEADER: SECRET}
    a = {**base, CF: CALLER}
    b = {**base, CF: "198.51.100.7"}

    assert client.get("/ping", headers=a).status_code == 200
    assert client.get("/ping", headers=a).status_code == 200
    assert client.get("/ping", headers=a).status_code == 429

    # B never touched A's budget.
    assert client.get("/ping", headers=b).status_code == 200
    assert client.get("/ping", headers=b).status_code == 200


def test_one_ipv6_caller_cannot_rotate_its_suffix_into_a_fresh_budget(cdn):
    """The regression guard for the /64 collapse. Same subscriber, three
    different device suffixes — one budget, not three."""
    client = TestClient(_app(limit=2))
    base = {SECRET_HEADER: SECRET}
    same_sub = [
        {**base, CF: "2600:4040:27ed:9700:a93d:371:696a:34dc"},
        {**base, CF: "2600:4040:27ed:9700:26:51aa:90f4:e446"},
        {**base, CF: "2600:4040:27ed:9700:dead:beef:1:2"},
    ]

    assert client.get("/ping", headers=same_sub[0]).status_code == 200
    assert client.get("/ping", headers=same_sub[1]).status_code == 200
    # Before the collapse this was a 200 — a third free request from rotation.
    assert client.get("/ping", headers=same_sub[2]).status_code == 429

    # A genuinely different subscriber still has its own budget.
    other = {**base, CF: "2600:4040:27ed:9701:a93d:371:696a:34dc"}
    assert client.get("/ping", headers=other).status_code == 200


def test_unconfigured_callers_share_one_bucket_rather_than_minting_their_own(
    unconfigured,
):
    """Prod today. Weak — everyone shares a budget — but not forgeable: sending
    a CF-Connecting-IP of your own buys no extra requests."""
    client = TestClient(_app(limit=2))
    a = {"X-Forwarded-For": PROD_XFF, CF: CALLER}
    b = {"X-Forwarded-For": PROD_XFF, CF: "198.51.100.7"}

    assert client.get("/ping", headers=a).status_code == 200
    assert client.get("/ping", headers=b).status_code == 200
    assert client.get("/ping", headers=b).status_code == 429


# --- /admin/health/client-ip ----------------------------------------------

def _observe(headers: dict[str, str]) -> dict:
    """Run one request through the real dependency chain and report it."""
    app = FastAPI()

    @app.get("/obs")
    def obs(request: Request):
        return client_ip_observation(request)

    return TestClient(app).get("/obs", headers=headers).json()


def test_report_fails_when_a_cdn_header_arrives_and_is_ignored(unconfigured):
    """Prod's current state: Cloudflare is telling us the caller and nothing is
    listening. This is the finding the issue was filed for, so it must read as
    a failure rather than a default."""
    report = build_report(_observe({CF: CALLER, "X-Forwarded-For": PROD_XFF}))

    assert report["overall_status"] == "fail"
    by_key = {m["key"]: m for m in report["metrics"]}
    assert by_key["throttles_bind_per_caller"]["value"] == "no"
    assert by_key["client_ip_source"]["status"] == "fail"
    # Step one of the issue: the header does reach the app.
    assert by_key["cdn_client_ip_header"]["status"] == "ok"
    assert CALLER in by_key["cdn_client_ip_header"]["detail"]
    assert "Transform Rule" in report["next_step"]


def test_report_passes_once_the_secret_proves_the_cdn(cdn):
    report = build_report(_observe({CF: CALLER, SECRET_HEADER: SECRET}))

    assert report["overall_status"] == "ok"
    by_key = {m["key"]: m for m in report["metrics"]}
    assert by_key["throttles_bind_per_caller"]["value"] == "yes"
    assert by_key["origin_proof"]["status"] == "ok"
    assert report["observed"]["client_ip"] == CALLER
    # IPv4: the address and the bucket it counts against are the same thing.
    assert report["observed"]["rate_limit_key"] == CALLER
    assert report["next_step"].startswith("nothing")


def test_report_shows_the_ipv6_bucket_alongside_the_exact_address(cdn):
    """The log keeps the full address for forensics; the key is the /64. Both
    are reported so the grouping isn't an invisible transform between them."""
    report = build_report(
        _observe({CF: "2600:4040:27ed:9700:a93d:371:696a:34dc", SECRET_HEADER: SECRET})
    )

    assert report["observed"]["client_ip"] == "2600:4040:27ed:9700:a93d:371:696a:34dc"
    assert report["observed"]["rate_limit_key"] == "2600:4040:27ed:9700::/64"


def test_report_flags_a_configured_header_whose_secret_did_not_match(cdn):
    """Half-wired: the Railway variable is set but the Cloudflare rule isn't
    (or this request bypassed the CDN). The header is refused, so the report
    must not read as healthy."""
    report = build_report(_observe({CF: CALLER}))

    assert report["overall_status"] == "fail"
    by_key = {m["key"]: m for m in report["metrics"]}
    assert by_key["origin_proof"]["status"] == "fail"
    assert "did not match" in by_key["origin_proof"]["detail"]


def test_report_is_ok_for_an_unproxied_deployment(unconfigured):
    """Local dev and any directly-exposed process: the socket peer really is
    the caller, so an unset header is correct rather than a gap."""
    report = build_report(_observe({}))

    assert report["overall_status"] == "ok"
    by_key = {m["key"]: m for m in report["metrics"]}
    assert by_key["throttles_bind_per_caller"]["value"] == "yes"
    assert by_key["cdn_client_ip_header"]["status"] == "ok"


def test_report_never_leaks_the_origin_secret(cdn):
    report = build_report(_observe({CF: CALLER, SECRET_HEADER: SECRET}))
    assert SECRET not in repr(report)
    assert report["observed"]["origin_secret_header"] == SECRET_HEADER


def test_observation_lists_every_candidate_header_that_arrived(unconfigured):
    obs = _observe({name: "203.0.113.9" for name in CLIENT_IP_HEADER_CANDIDATES})
    assert set(obs["candidate_headers"]) == set(CLIENT_IP_HEADER_CANDIDATES)


# --- route-level guard (mirrors tests/test_event_loop_lag.py) --------------

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


def test_client_ip_health_requires_admin_and_throttle():
    from src.routes.admin import router

    calls = _dependency_calls(router, "/admin/health/client-ip", "GET")
    assert get_admin_user in calls
    assert any(getattr(c, "__qualname__", "").startswith("rate_limit.") for c in calls)
