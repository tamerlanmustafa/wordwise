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

import hmac
import ipaddress
import threading
import time
from collections import defaultdict, deque
from typing import Callable, Deque, Dict, Optional

from fastapi import Depends, HTTPException, Request, status

from ..config import get_settings
from ..utils.auth import verify_token_once

# Case-insensitive lookup of one request header, whatever the request is
# represented as. Both the FastAPI `Request` path and the raw ASGI middleware
# path adapt to this so the resolution rules below exist exactly once.
HeaderGetter = Callable[[str], Optional[str]]

# Single-value headers a CDN may use to carry the caller's real address. These
# are OBSERVED, never trusted: the access log records which of them arrived so
# "does this header survive the platform's proxies?" can be answered against
# real traffic before anything is keyed on it (issue #139, step one).
CLIENT_IP_HEADER_CANDIDATES = ("cf-connecting-ip", "true-client-ip", "x-real-ip")


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


def _user_key_from_token(token: str | None, state: dict | None = None) -> str | None:
    """Stable per-user key from a bearer token, or None if unauthenticated.

    Keying authenticated callers by user id stops one user behind a shared
    NAT/proxy from exhausting everyone else's budget.

    `state` is the request's ASGI state dict. Passing it lets the auth
    dependency downstream reuse this decode instead of repeating it (#138).
    """
    if token:
        payload = verify_token_once(token, state)
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
    return _forwarded_ip(forwarded_for, trusted_hops) or peer or "unknown"


def _forwarded_ip(forwarded_for: str | None, trusted_hops: int) -> str | None:
    """The entry `trusted_hops` from the right of X-Forwarded-For, if any.

    Split out from `_client_ip` so callers can tell "the header supplied the
    address" apart from "we fell back to the socket peer" — the two look
    identical in the result but mean opposite things about whether the key is
    per-caller. See `_client_ip` for why the count runs from the right.
    """
    if not forwarded_for or trusted_hops <= 0:
        return None
    hops = [h.strip() for h in forwarded_for.split(",") if h.strip()]
    if not hops:
        return None
    # Fewer entries than expected means the request did not traverse the full
    # chain; the leftmost is then the closest to the client.
    return hops[max(0, len(hops) - trusted_hops)]


def _parsed_ip(value: str | None) -> str | None:
    """`value` if it is a bare IP address, else None.

    A rate-limit key made from an unvalidated header is a rate limit that can
    be dissolved by sending junk: every distinct malformed value is a fresh
    bucket. Only something that parses as an address is allowed to become one.
    """
    if not value:
        return None
    candidate = value.strip()
    try:
        ipaddress.ip_address(candidate)
    except ValueError:
        return None
    return candidate


def _origin_secret_matches(get_header: HeaderGetter, settings) -> bool:
    """Whether this request carries the CDN's shared origin secret.

    `trusted_client_ip_header` is only meaningful if the request provably came
    through the CDN that sets it. The Railway origin still answers requests
    that never touched Cloudflare, so without this proof anyone could pick
    their own rate-limit identity by hitting the origin directly — which is
    worse than the shared bucket it would replace.

    Both settings unset (the default) returns False, which is what keeps the
    whole feature off until it is deliberately configured at both ends.
    Compared with `compare_digest` so a wrong secret can't be recovered a byte
    at a time from response timing.
    """
    name = settings.trusted_client_ip_secret_header
    expected = settings.trusted_client_ip_secret
    if not name or not expected:
        return False
    presented = get_header(name)
    if not presented:
        return False
    return hmac.compare_digest(presented.strip().encode("utf-8"), expected.encode("utf-8"))


def resolve_client_ip_with_source(
    get_header: HeaderGetter, peer: str | None
) -> tuple[str, str]:
    """The caller's address and which source produced it.

    In precedence order:

    1. ``trusted-header`` — `trusted_client_ip_header` (e.g. Cloudflare's
       `CF-Connecting-IP`), but only when `_origin_secret_matches` proves the
       CDN set it. On a CDN-fronted deployment this is the only per-caller
       source: Railway rebuilds `X-Forwarded-For` and discards what Cloudflare
       sent, so the caller appears at no index of it (issue #139).
    2. ``forwarded-for`` — counted from the right by `trusted_proxy_hops`.
    3. ``socket-peer`` — the connecting address, which behind any proxy is the
       proxy, so all callers share one key.
    4. ``none`` — nothing to key on at all.

    Each step down degrades toward a *shared* key rather than a forgeable one,
    so a half-configured deployment throttles callers collectively instead of
    handing every caller a private budget. The source is what the admin report
    surfaces: the address alone can't tell you which rung it came from, and
    only the top rung means the limits actually bind per caller.
    """
    settings = get_settings()
    header_name = settings.trusted_client_ip_header
    if header_name and _origin_secret_matches(get_header, settings):
        trusted = _parsed_ip(get_header(header_name))
        if trusted:
            return trusted, "trusted-header"
    forwarded = _forwarded_ip(get_header("X-Forwarded-For"), settings.trusted_proxy_hops)
    if forwarded:
        return forwarded, "forwarded-for"
    if peer:
        return peer, "socket-peer"
    return "unknown", "none"


def resolve_client_ip(get_header: HeaderGetter, peer: str | None) -> str:
    """`resolve_client_ip_with_source` when only the address is wanted."""
    return resolve_client_ip_with_source(get_header, peer)[0]


# How much of an IPv6 address identifies the subscriber rather than the device.
# A /64 is the smallest block anyone is handed: carriers and ISPs delegate at
# least that to a single customer, and the remaining 64 bits are chosen by the
# customer's own equipment — privacy extensions rotate them by the hour. Keying
# on the full address therefore gives one caller a fresh bucket whenever their
# device picks a new suffix, which is the same defeat as having no limit.
#
# Widen (56, 48) if abuse is seen rotating across /64s within one allocation;
# that also groups more unrelated subscribers into one bucket, so it is a
# deliberate trade, not a free tightening.
IPV6_KEY_PREFIX_BITS = 64


def rate_limit_key_for_ip(ip: str) -> str:
    """The bucket an address counts against.

    IPv4 is one address per caller, so it keys on itself. IPv6 keys on the
    caller's /64 — see `IPV6_KEY_PREFIX_BITS`. Anything that isn't an address
    ("unknown", a unix socket path) passes through untouched so it still
    shares one bucket rather than crashing the limiter.
    """
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return ip
    # ::ffff:1.2.3.4 is an IPv4 address wearing an IPv6 shape. Collapsing it by
    # prefix would drop every IPv4 caller into the single bucket "::/64".
    if addr.version == 4 or getattr(addr, "ipv4_mapped", None) is not None:
        return ip
    return str(ipaddress.ip_network(f"{ip}/{IPV6_KEY_PREFIX_BITS}", strict=False))


def _request_header_getter(request: Request) -> HeaderGetter:
    """Starlette's `Headers` mapping is already case-insensitive."""
    return request.headers.get


def client_ip_observation(request: Request) -> dict:
    """Everything this process can see about where one request came from.

    The raw material for the /admin/health/client-ip report: the address that
    would be used as a rate-limit key, the rung it came from, and the inputs
    that decided it. Reported per-request rather than aggregated because the
    question it answers — "does the CDN's header survive the platform's
    proxies?" — is answered by a single real request from outside.

    The origin secret's *value* is never included, only whether one is
    configured and whether this request presented a matching one.
    """
    settings = get_settings()
    get_header = _request_header_getter(request)
    client = request.client
    peer = client.host if client else None
    ip, source = resolve_client_ip_with_source(get_header, peer)
    header_name = settings.trusted_client_ip_header
    return {
        "client_ip": ip,
        # The bucket the address actually counts against — the same thing for
        # IPv4, the caller's /64 for IPv6. Reported separately so the grouping
        # is visible rather than an invisible transform between the address in
        # the logs and the budget being spent.
        "rate_limit_key": rate_limit_key_for_ip(ip),
        "source": source,
        "socket_peer": peer,
        "forwarded_for": get_header("X-Forwarded-For"),
        "trusted_proxy_hops": settings.trusted_proxy_hops,
        "candidate_headers": {
            name: value
            for name in CLIENT_IP_HEADER_CANDIDATES
            if (value := get_header(name))
        },
        "trusted_client_ip_header": header_name or None,
        "trusted_client_ip_header_value": get_header(header_name) if header_name else None,
        "origin_secret_header": settings.trusted_client_ip_secret_header or None,
        "origin_secret_configured": bool(
            settings.trusted_client_ip_secret_header and settings.trusted_client_ip_secret
        ),
        "origin_secret_matched": _origin_secret_matches(get_header, settings),
    }


def _client_key(request: Request, token: str | None) -> str:
    """Prefer a stable user id from the bearer token; fall back to IP."""
    user = _user_key_from_token(token, request.scope.setdefault("state", {}))
    if user:
        return user
    client = request.client
    ip = resolve_client_ip(
        _request_header_getter(request),
        client.host if client else None,
    )
    return f"ip:{rate_limit_key_for_ip(ip)}"


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


def _scope_header_getter(scope) -> HeaderGetter:
    """Case-insensitive header lookup over a raw ASGI scope.

    ASGI hands headers over as a list of lowercased byte pairs. First match
    wins, matching Starlette, so a duplicated header cannot be appended to
    shadow the value the CDN set.
    """
    headers = scope.get("headers", [])

    def get(name: str) -> str | None:
        wanted = name.lower().encode("latin-1")
        for key, value in headers:
            if key == wanted:
                return value.decode("latin-1")
        return None

    return get


def _forwarded_for_from_scope(scope) -> str | None:
    """X-Forwarded-For off a raw ASGI scope (headers are lowercased bytes)."""
    return _scope_header_getter(scope)("X-Forwarded-For")


def client_ip_headers_from_scope(scope) -> dict[str, str]:
    """Which of the CDN client-IP headers actually arrived on this request.

    Observational only — nothing here is trusted or keyed on. Recording it is
    how the question issue #139 turns on gets answered: Railway rewrites
    `X-Forwarded-For`, so whether it *also* passes `CF-Connecting-IP` through
    to the app cannot be assumed and has to be seen in production traffic.
    The values are addresses; the origin secret is deliberately not among them.
    """
    get = _scope_header_getter(scope)
    found = {}
    for name in CLIENT_IP_HEADER_CANDIDATES:
        value = get(name)
        if value:
            found[name] = value
    return found


def client_ip_from_scope(scope) -> str:
    """The caller's IP as this process can best determine it, from an ASGI scope.

    Public so the access log can record it: whether this value is stable per
    caller (rather than per edge-proxy node) is exactly what decides if
    IP-keyed rate limiting works on this platform, and the log is the only
    place that question can be answered against real traffic.
    """
    client = scope.get("client")
    return resolve_client_ip(
        _scope_header_getter(scope),
        client[0] if client else None,
    )


def _client_key_from_scope(scope, token: str | None) -> str:
    """Scope-based twin of `_client_key` for the ASGI middleware."""
    user = _user_key_from_token(token, scope.setdefault("state", {}))
    if user:
        return user
    return f"ip:{rate_limit_key_for_ip(client_ip_from_scope(scope))}"


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
