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

from src.utils.auth import create_access_token
from src.utils.rate_limit import (
    GlobalRateLimitMiddleware,
    _SlidingWindow,
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
