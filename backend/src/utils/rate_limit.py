"""
Lightweight in-process rate limiting for FastAPI.

A dependency factory that bounds how many times a single client (keyed by
authenticated user id when available, otherwise client IP) may hit an
endpoint within a sliding time window. Returns HTTP 429 when exceeded.

Limitation: counters live in this process's memory, so on a multi-instance
deployment each instance enforces the limit independently (the effective
global limit is roughly limit * instance_count). This is intentional —
it adds a meaningful abuse ceiling with zero new dependencies or infra.
Swap the `_Bucket` store for Redis (settings.redis_url is already wired)
if you need accurate cross-instance limits.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict

from fastapi import Depends, HTTPException, Request, status

from ..utils.auth import verify_token


class _SlidingWindow:
    """Per-key deque of request timestamps, pruned to the active window."""

    def __init__(self, limit: int, window_seconds: float) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str) -> bool:
        """Record a hit for `key`; return True if still within the limit."""
        now = time.monotonic()
        cutoff = now - self.window
        with self._lock:
            hits = self._hits[key]
            while hits and hits[0] < cutoff:
                hits.popleft()
            if len(hits) >= self.limit:
                return False
            hits.append(now)
            # Opportunistic cleanup so idle keys don't leak memory forever.
            if len(self._hits) > 10_000:
                self._gc(cutoff)
            return True

    def _gc(self, cutoff: float) -> None:
        empty = [k for k, v in self._hits.items() if not v or v[-1] < cutoff]
        for k in empty:
            del self._hits[k]


def _user_key_from_token(token: str | None) -> str | None:
    """Stable per-user key from a bearer token, or None if unauthenticated.

    Keying authenticated callers by user id stops one user behind a shared
    NAT/proxy from exhausting everyone else's budget.
    """
    if token:
        payload = verify_token(token)
        if payload and payload.get("sub"):
            return f"user:{payload['sub']}"
    return None


def _client_ip(forwarded_for: str | None, peer: str | None) -> str:
    """Resolve the caller's IP from behind the platform edge proxy.

    In prod the API sits behind Railway's proxy, so the socket peer is the
    proxy for *every* request — keying on it alone puts all unauthenticated
    callers in one shared bucket. uvicorn is started without `--proxy-headers`
    (and its default `forwarded_allow_ips` is 127.0.0.1, which the edge never
    matches), so the header has to be read here.

    The RIGHTMOST `X-Forwarded-For` entry is the address the edge itself
    observed. The leftmost is whatever the caller sent and is trivially
    spoofed, so it must never be trusted: a client sending
    `X-Forwarded-For: 1.2.3.4` produces `1.2.3.4, <real ip>` once the edge
    appends, and only the right-hand value is real. This holds for exactly one
    trusted proxy in front, which is the deployment (docker/Dockerfile.backend).

    Falls back to the socket peer when there is no header — local runs, tests,
    and any direct connection behave exactly as before.
    """
    if forwarded_for:
        hops = [h.strip() for h in forwarded_for.split(",") if h.strip()]
        if hops:
            return hops[-1]
    return peer or "unknown"


def _client_key(request: Request, token: str | None) -> str:
    """Prefer a stable user id from the bearer token; fall back to IP."""
    user = _user_key_from_token(token)
    if user:
        return user
    client = request.client
    ip = _client_ip(
        request.headers.get("X-Forwarded-For"),
        client.host if client else None,
    )
    return f"ip:{ip}"


def rate_limit(limit: int, window_seconds: float, *, scope: str):
    """Build a FastAPI dependency enforcing `limit` requests per window.

    `scope` namespaces the counter so different endpoints don't share a
    budget. Use the same scope across endpoints that should share one.
    """
    window = _SlidingWindow(limit, window_seconds)

    async def _dependency(
        request: Request,
        token: str | None = Depends(_optional_bearer),
    ) -> None:
        key = f"{scope}:{_client_key(request, token)}"
        if not window.check(key):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Please slow down and try again shortly.",
                headers={"Retry-After": str(int(window_seconds))},
            )

    return _dependency


async def _optional_bearer(request: Request) -> str | None:
    """Extract a bearer token without requiring one (unauthenticated
    endpoints still need rate limiting keyed by IP)."""
    auth = request.headers.get("Authorization")
    if auth and auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return None


def _bearer_from_scope(scope) -> str | None:
    """Bearer token off a raw ASGI scope (headers are lowercased bytes)."""
    for key, value in scope.get("headers", []):
        if key == b"authorization":
            raw = value.decode("latin-1")
            if raw.lower().startswith("bearer "):
                return raw[7:].strip()
            return None
    return None


def _forwarded_for_from_scope(scope) -> str | None:
    """X-Forwarded-For off a raw ASGI scope (headers are lowercased bytes)."""
    for key, value in scope.get("headers", []):
        if key == b"x-forwarded-for":
            return value.decode("latin-1")
    return None


def _client_key_from_scope(scope, token: str | None) -> str:
    """Scope-based twin of `_client_key` for the ASGI middleware."""
    user = _user_key_from_token(token)
    if user:
        return user
    client = scope.get("client")
    ip = _client_ip(
        _forwarded_for_from_scope(scope),
        client[0] if client else None,
    )
    return f"ip:{ip}"


class GlobalRateLimitMiddleware:
    """App-wide sliding-window rate limit, keyed per user/IP.

    A coarse abuse ceiling covering *every* route — the per-endpoint
    ``rate_limit`` dependencies stack on top for cost-sensitive paths. Pure
    ASGI (like RequestIDMiddleware) so it runs before routing and can reject
    with a 429 + ``Retry-After`` without materializing the request body.

    Shares the same in-process limitation as ``rate_limit``: counters live in
    this process's memory, so on a multi-instance deployment the effective
    ceiling is roughly ``limit * instance_count``.
    """

    # Uptime probes must never trip the limit.
    _EXEMPT_PATHS = frozenset({"/", "/health"})

    def __init__(
        self,
        app,
        *,
        limit: int,
        window_seconds: float = 60.0,
        scope_name: str = "global",
    ) -> None:
        self.app = app
        self.enabled = limit > 0
        self._window = _SlidingWindow(limit, window_seconds)
        self._scope_name = scope_name
        self._retry_after = str(int(window_seconds)).encode("latin-1")

    async def __call__(self, scope, receive, send):
        if (
            not self.enabled
            or scope["type"] != "http"
            or scope.get("path") in self._EXEMPT_PATHS
        ):
            await self.app(scope, receive, send)
            return

        token = _bearer_from_scope(scope)
        key = f"{self._scope_name}:{_client_key_from_scope(scope, token)}"
        if not self._window.check(key):
            await self._reject(send)
            return
        await self.app(scope, receive, send)

    async def _reject(self, send) -> None:
        body = (
            b'{"detail":"Too many requests. '
            b'Please slow down and try again shortly."}'
        )
        await send(
            {
                "type": "http.response.start",
                "status": status.HTTP_429_TOO_MANY_REQUESTS,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode("latin-1")),
                    (b"retry-after", self._retry_after),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
