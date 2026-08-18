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

from ..config import get_settings
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


def _client_ip(
    forwarded_for: str | None,
    peer: str | None,
    trusted_hops: int = 0,
) -> str:
    """Resolve the caller's IP from behind the platform's proxies.

    uvicorn runs without `--proxy-headers` (its default `forwarded_allow_ips`
    is 127.0.0.1, which the edge never matches), so the socket peer is a proxy
    on every request and the header has to be read here.

    Each proxy in the chain APPENDS the address it saw, so with `trusted_hops`
    proxies in front, the caller sits at index `-trusted_hops`:

        client -> edge -> internal -> app
        X-Forwarded-For: "<client>, <edge>"      peer: <internal>

    Counting from the RIGHT is what makes this safe. A caller who sends their
    own header only prepends to it — `"<spoof>, <client>, <edge>"` — so a
    fixed offset from the right still lands on the address a proxy actually
    observed. Counting from the left would hand every caller a free identity.

    Measured on Railway (2026-08-17): taking the rightmost entry yielded a
    rotating pool of five edge addresses (152.233.47.65-69) rather than the
    caller, which is why `trusted_hops` exists rather than a hardcoded index.

    `trusted_hops=0` disables header parsing entirely and uses the socket
    peer — the correct setting for a directly-exposed deployment, and the
    default so that a misconfigured environment fails closed (everyone shares
    a bucket) rather than open (everyone gets a spoofable identity).
    """
    if forwarded_for and trusted_hops > 0:
        hops = [h.strip() for h in forwarded_for.split(",") if h.strip()]
        if hops:
            # Fewer entries than expected means the request did not traverse
            # the full chain; the leftmost is then the closest to the client.
            index = max(0, len(hops) - trusted_hops)
            return hops[index]
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
        get_settings().trusted_proxy_hops,
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


def client_ip_from_scope(scope) -> str:
    """The caller's IP as this process can best determine it, from an ASGI scope.

    Public so the access log can record it: whether this value is stable per
    caller (rather than per edge-proxy node) is exactly what decides if
    IP-keyed rate limiting works on this platform, and the log is the only
    place that question can be answered against real traffic.
    """
    client = scope.get("client")
    return _client_ip(
        _forwarded_for_from_scope(scope),
        client[0] if client else None,
        get_settings().trusted_proxy_hops,
    )


def _client_key_from_scope(scope, token: str | None) -> str:
    """Scope-based twin of `_client_key` for the ASGI middleware."""
    user = _user_key_from_token(token)
    if user:
        return user
    return f"ip:{client_ip_from_scope(scope)}"


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
