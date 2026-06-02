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


def _client_key(request: Request, token: str | None) -> str:
    """Prefer a stable user id from the bearer token; fall back to IP.

    Keying authenticated callers by user id stops one user behind a shared
    NAT/proxy from exhausting everyone else's budget.
    """
    if token:
        payload = verify_token(token)
        if payload and payload.get("sub"):
            return f"user:{payload['sub']}"
    client = request.client
    return f"ip:{client.host if client else 'unknown'}"


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
