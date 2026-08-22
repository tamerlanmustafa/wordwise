"""
The JWT is verified once per request, not twice (issue #138).

`GlobalRateLimitMiddleware` has to decode the bearer token before routing so it
can key its counter by user id — otherwise everyone behind one mobile carrier's
NAT shares a budget. The auth dependency then decoded the identical string a
second time on every authenticated request. Signature verification is a real
HMAC over the token, and it is a fixed tax on 100% of authenticated traffic.

What is protected here:

1. Two lookups of the same token in one request verify it once.
2. The memo is keyed on the exact token, so a request that presents a
   *different* credential than the middleware saw is verified afresh — a cache
   that ignored this would let one caller's payload authenticate another's
   request.
3. A rejected token stays rejected, and does not re-run the failed check.
4. It survives the real middleware stack: the value the ASGI middleware writes
   into the request scope is the one the route handler's dependency reads.
5. Nothing carries between requests.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import Depends, FastAPI, Request
from fastapi.testclient import TestClient

from src.middleware.auth import get_current_user
from src.utils import auth as auth_utils
from src.utils.auth import create_access_token, verify_token_once
from src.utils.rate_limit import GlobalRateLimitMiddleware


@pytest.fixture
def decode_counter(monkeypatch):
    """Count real `verify_token` calls, whatever route reaches it."""
    calls: list[str] = []
    real = auth_utils.verify_token

    def counting(token):
        calls.append(token)
        return real(token)

    monkeypatch.setattr(auth_utils, "verify_token", counting)
    return calls


class TestVerifyTokenOnce:
    def test_second_lookup_reuses_the_first(self, decode_counter):
        token = create_access_token({"sub": "1"})
        state: dict = {}

        first = verify_token_once(token, state)
        second = verify_token_once(token, state)

        assert first == second
        assert first["sub"] == "1"
        assert len(decode_counter) == 1

    def test_a_different_token_is_verified_afresh(self, decode_counter):
        state: dict = {}
        a = create_access_token({"sub": "1"})
        b = create_access_token({"sub": "2"})

        assert verify_token_once(a, state)["sub"] == "1"
        assert verify_token_once(b, state)["sub"] == "2"
        # And going back to the first one must not return user 2.
        assert verify_token_once(a, state)["sub"] == "1"
        assert len(decode_counter) == 3

    def test_a_rejected_token_is_not_rechecked(self, decode_counter):
        state: dict = {}

        assert verify_token_once("not-a-jwt", state) is None
        assert verify_token_once("not-a-jwt", state) is None
        assert len(decode_counter) == 1

    def test_no_state_means_plain_verification(self, decode_counter):
        token = create_access_token({"sub": "1"})

        assert verify_token_once(token, None)["sub"] == "1"
        assert verify_token_once(token, None)["sub"] == "1"
        assert len(decode_counter) == 2

    def test_separate_requests_share_nothing(self, decode_counter):
        token = create_access_token({"sub": "1"})

        verify_token_once(token, {})
        verify_token_once(token, {})

        assert len(decode_counter) == 2


class TestThroughTheRealStack:
    """The saving only exists if the scope dict actually reaches the handler."""

    def _app(self, monkeypatch):
        async def fake_get_db():
            async def find_unique(where):
                return SimpleNamespace(id=where["id"], isActive=True)

            return SimpleNamespace(user=SimpleNamespace(find_unique=find_unique))

        app = FastAPI()

        @app.get("/whoami")
        async def whoami(request: Request, user=Depends(get_current_user)):
            return {"id": user.id}

        from src.database import get_db

        app.dependency_overrides[get_db] = fake_get_db
        app.add_middleware(GlobalRateLimitMiddleware, limit=1000, window_seconds=60.0)
        return app

    def test_middleware_and_dependency_share_one_decode(self, monkeypatch, decode_counter):
        app = self._app(monkeypatch)
        token = create_access_token({"sub": "5", "type": "access"})

        with TestClient(app) as client:
            resp = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})

        assert resp.status_code == 200, resp.text
        assert resp.json() == {"id": 5}
        # The middleware decoded it to key the rate limiter; the dependency
        # reused that decode rather than repeating the HMAC.
        assert len(decode_counter) == 1

    def test_two_requests_each_decode_once(self, monkeypatch, decode_counter):
        app = self._app(monkeypatch)
        token = create_access_token({"sub": "5", "type": "access"})

        with TestClient(app) as client:
            for _ in range(2):
                client.get("/whoami", headers={"Authorization": f"Bearer {token}"})

        assert len(decode_counter) == 2

    def test_a_forged_token_is_still_rejected(self, monkeypatch, decode_counter):
        app = self._app(monkeypatch)

        with TestClient(app) as client:
            resp = client.get("/whoami", headers={"Authorization": "Bearer forged.jwt.here"})

        assert resp.status_code == 401

    def test_the_rate_limiter_still_keys_by_user(self, monkeypatch):
        # Regression guard: the memo is a side effect of the keying, so the
        # keying itself must keep working.
        from src.utils.rate_limit import _client_key_from_scope

        token = create_access_token({"sub": "77"})
        scope: dict = {"headers": [], "client": ("1.2.3.4", 0)}

        assert _client_key_from_scope(scope, token) == "user:77"
        # ...and it left the decode behind for the dependency.
        assert verify_token_once(token, scope["state"])["sub"] == "77"


def test_verify_token_once_is_awaitable_free():
    """It must stay a plain function — it is called from pure-ASGI middleware
    that has no dependency-injection context to await into."""
    assert not asyncio.iscoroutinefunction(verify_token_once)
