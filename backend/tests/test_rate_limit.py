"""
Tests for API rate limiting & cost-abuse protection (issue #74).

Covers the three layers:
  - the in-process sliding-window counter,
  - the per-endpoint `rate_limit` dependency (429 + Retry-After),
  - the app-wide `GlobalRateLimitMiddleware` (enforcement, per-user/IP keying,
    exempt health paths, disable switch),
  - and that the cost-incurring enrichment endpoints carry a throttle.

Middleware/dependency behaviour is exercised on throwaway FastAPI apps (not
src.main, whose lifespan connects to Postgres) so these stay DB-free.
"""
from __future__ import annotations

from datetime import timedelta

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from src.config import get_settings
from src.utils.auth import create_access_token
from src.utils.rate_limit import (
    GlobalRateLimitMiddleware,
    _SlidingWindow,
    _client_ip,
    rate_limit,
)


# --- _SlidingWindow -------------------------------------------------------

def test_sliding_window_allows_up_to_limit_then_blocks():
    window = _SlidingWindow(limit=3, window_seconds=60.0)
    assert [window.check("k") for _ in range(5)] == [True, True, True, False, False]


def test_sliding_window_keys_are_independent():
    window = _SlidingWindow(limit=1, window_seconds=60.0)
    assert window.check("a") is True
    assert window.check("a") is False
    # A different key has its own untouched budget.
    assert window.check("b") is True


def test_sliding_window_prunes_expired_hits():
    # A zero-length window means every prior hit is always outside the window,
    # so the caller is never blocked (each check prunes then admits).
    window = _SlidingWindow(limit=1, window_seconds=0.0)
    assert all(window.check("k") for _ in range(10))


# --- rate_limit dependency ------------------------------------------------

def _dependency_app(limit: int) -> FastAPI:
    app = FastAPI()
    throttle = rate_limit(limit, 60.0, scope="test-dep")

    @app.get("/ping")
    def ping(_: None = Depends(throttle)):
        return {"ok": True}

    return app


def test_rate_limit_dependency_returns_429_with_retry_after():
    client = TestClient(_dependency_app(limit=2))
    assert client.get("/ping").status_code == 200
    assert client.get("/ping").status_code == 200

    blocked = client.get("/ping")
    assert blocked.status_code == 429
    assert blocked.headers["Retry-After"] == "60"
    assert "Too many requests" in blocked.json()["detail"]


# --- GlobalRateLimitMiddleware -------------------------------------------

def _global_app(limit: int) -> FastAPI:
    app = FastAPI()
    app.add_middleware(GlobalRateLimitMiddleware, limit=limit, window_seconds=60.0)

    @app.get("/ping")
    def ping():
        return {"ok": True}

    @app.get("/health")
    def health():
        return {"status": "healthy"}

    return app


def _token(user_id: str) -> str:
    return create_access_token({"sub": user_id}, expires_delta=timedelta(minutes=5))


def test_global_middleware_enforces_limit_with_retry_after():
    client = TestClient(_global_app(limit=3))
    for _ in range(3):
        assert client.get("/ping").status_code == 200

    blocked = client.get("/ping")
    assert blocked.status_code == 429
    assert blocked.headers["Retry-After"] == "60"
    assert "Too many requests" in blocked.json()["detail"]


def test_global_middleware_exempts_health_probe():
    client = TestClient(_global_app(limit=2))
    # Far more than the limit — uptime probes must never be throttled.
    for _ in range(10):
        assert client.get("/health").status_code == 200


def test_global_middleware_keys_authenticated_users_independently():
    client = TestClient(_global_app(limit=2))
    alice = {"Authorization": f"Bearer {_token('1')}"}
    bob = {"Authorization": f"Bearer {_token('2')}"}

    # Alice exhausts her own budget.
    assert client.get("/ping", headers=alice).status_code == 200
    assert client.get("/ping", headers=alice).status_code == 200
    assert client.get("/ping", headers=alice).status_code == 429

    # Bob is keyed by his own user id, so he still has a full budget.
    assert client.get("/ping", headers=bob).status_code == 200
    assert client.get("/ping", headers=bob).status_code == 200
    assert client.get("/ping", headers=bob).status_code == 429


def test_global_middleware_disabled_when_limit_zero():
    client = TestClient(_global_app(limit=0))
    for _ in range(20):
        assert client.get("/ping").status_code == 200


# --- cost-incurring endpoint registration --------------------------------

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


def _has_rate_limit(calls: set) -> bool:
    return any(
        getattr(c, "__qualname__", "").startswith("rate_limit.") for c in calls
    )


def test_enrichment_batch_sentences_is_throttled():
    # Batch slow path authors example sentences with Claude — must be throttled.
    from src.routes.enrichment import router

    calls = _dependency_calls(
        router, "/api/enrichment/movies/{movie_id}/sentences/batch", "POST"
    )
    assert _has_rate_limit(calls)


def test_enrichment_single_sentence_is_throttled():
    # Single endpoint translates on-demand via a paid MT provider on a miss.
    from src.routes.enrichment import router

    calls = _dependency_calls(
        router, "/api/enrichment/movies/{movie_id}/sentences/{word}", "GET"
    )
    assert _has_rate_limit(calls)


# --- client IP behind the platform edge proxy ----------------------------
#
# In prod the API sits behind Railway's proxy and uvicorn runs without
# --proxy-headers, so the socket peer is the proxy for every request. Keying
# on it alone put all unauthenticated callers in ONE shared bucket — a
# per-endpoint limit would then have throttled every logged-out user
# collectively rather than the caller who was abusing it.

def test_client_ip_counts_hops_from_the_right():
    # client -> edge -> internal -> app leaves "<client>, <edge>" in the header
    # and the internal hop as the socket peer. With two appending proxies in
    # front, the caller is two entries from the right.
    xff = "203.0.113.9, 152.233.47.65"
    assert _client_ip(xff, peer="100.64.0.21", trusted_hops=2) == "203.0.113.9"


def test_client_ip_ignores_a_spoofed_prefix():
    # A caller who sends their own header only PREPENDS to it. Counting from
    # the right still lands on the address a proxy actually observed, so the
    # forged entry buys nothing.
    xff = "1.2.3.4, 203.0.113.9, 152.233.47.65"
    assert _client_ip(xff, peer="100.64.0.21", trusted_hops=2) == "203.0.113.9"


def test_client_ip_taking_the_rightmost_entry_returns_the_proxy_not_the_caller():
    # Why trusted_hops exists. Measured on Railway 2026-08-17: hops=1 resolved
    # to a rotating pool of five edge addresses instead of the caller, so every
    # request landed in a different bucket and no limit ever bound.
    xff = "203.0.113.9, 152.233.47.65"
    assert _client_ip(xff, peer="100.64.0.21", trusted_hops=1) == "152.233.47.65"


def test_client_ip_ignores_the_header_when_no_proxies_are_trusted():
    # The default. Fails CLOSED: a misconfigured deployment shares buckets
    # rather than letting every caller mint their own identity via a header.
    xff = "1.2.3.4"
    assert _client_ip(xff, peer="198.51.100.7", trusted_hops=0) == "198.51.100.7"


def test_client_ip_handles_a_shorter_chain_than_configured():
    # A request that skipped a hop must not fall off the front of the list.
    assert _client_ip("203.0.113.9", peer="10.0.0.1", trusted_hops=2) == "203.0.113.9"


def test_client_ip_falls_back_to_the_socket_peer_without_the_header():
    assert _client_ip(None, peer="127.0.0.1", trusted_hops=2) == "127.0.0.1"
    assert _client_ip("", peer="127.0.0.1", trusted_hops=2) == "127.0.0.1"
    assert _client_ip("  ,  ", peer="127.0.0.1", trusted_hops=2) == "127.0.0.1"


def test_client_ip_reports_unknown_when_there_is_nothing_to_key_on():
    assert _client_ip(None, peer=None) == "unknown"


def test_dependency_gives_separate_budgets_to_callers_behind_one_proxy(monkeypatch):
    """The regression guard: two users arriving through the same proxy chain
    must not share a bucket. TestClient reports the same socket peer for both,
    so only the forwarded address can tell them apart."""
    monkeypatch.setattr(get_settings(), "trusted_proxy_hops", 2)
    client = TestClient(_dependency_app(limit=2))
    a = {"X-Forwarded-For": "203.0.113.9, 152.233.47.65"}
    b = {"X-Forwarded-For": "198.51.100.7, 152.233.47.65"}

    assert client.get("/ping", headers=a).status_code == 200
    assert client.get("/ping", headers=a).status_code == 200
    assert client.get("/ping", headers=a).status_code == 429  # A spent its own

    # B is untouched by A's abuse. Before the fix this was 429.
    assert client.get("/ping", headers=b).status_code == 200
    assert client.get("/ping", headers=b).status_code == 200


def test_global_middleware_also_keys_on_the_forwarded_address(monkeypatch):
    monkeypatch.setattr(get_settings(), "trusted_proxy_hops", 2)
    client = TestClient(_global_app(limit=1))
    a = {"X-Forwarded-For": "203.0.113.9, 152.233.47.65"}
    b = {"X-Forwarded-For": "198.51.100.7, 152.233.47.65"}
    assert client.get("/ping", headers=a).status_code == 200
    assert client.get("/ping", headers=a).status_code == 429
    # A different caller through the same chain still has its full budget.
    assert client.get("/ping", headers=b).status_code == 200


# --- unauthenticated, CPU-heavy endpoints --------------------------------

def test_movie_vocabulary_preview_is_throttled():
    """Public (no auth) and ~12s of spaCy + ~600 MB per call. #117 stopped it
    blocking the event loop; this stops one caller monopolising the single NLP
    worker thread."""
    from src.routes.movies import router

    calls = _dependency_calls(router, "/movies/{movie_id}/vocabulary/preview", "GET")
    assert _has_rate_limit(calls)
