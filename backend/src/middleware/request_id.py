"""
Per-request correlation-id + access-telemetry middleware.

A pure-ASGI middleware (rather than BaseHTTPMiddleware) so it can:
  - read/generate the id before anything else runs,
  - stamp it onto the ContextVar the log filter reads, and
  - inject it into the response headers without materializing the body.

Every request gets an ``X-Request-ID``: an inbound one is honoured (so a
correlation id can span the mobile client → API → logs), otherwise a fresh
uuid4 is minted. The id is echoed back in the response header and tagged onto
every log line emitted while the request is in flight.

It also owns the one wall-clock measurement of each request (issue #130). The
duration goes two places: the structured access log, and the in-process
latency registry behind GET /admin/health/latency. Timing here rather than in a
second middleware means there is exactly one number and the log and the
percentiles can never disagree.
"""

from __future__ import annotations

import logging
import re
import time
import uuid

from ..logging_config import request_id_ctx
from ..services.latency_stats import record_request
from ..utils.rate_limit import _forwarded_for_from_scope, client_ip_from_scope

_DEFAULT_HEADER = "X-Request-ID"
# Accept only ids that are safe to log and to write back into a header
# (guards against header/log injection from a hostile client). Anything else
# is discarded and we mint our own.
_VALID_ID = re.compile(r"^[A-Za-z0-9._-]{8,128}$")

access_logger = logging.getLogger("wordwise.access")


def _new_request_id() -> str:
    return uuid.uuid4().hex


def _sanitize(value: str | None) -> str | None:
    if value and _VALID_ID.match(value):
        return value
    return None


def _route_template(scope) -> str | None:
    """The matched route's path template, e.g. ``/movies/{movie_id}/words``.

    Starlette writes the matched route onto the same scope dict we were handed,
    so it is readable once the downstream app has returned. None means nothing
    matched (404, or a CORS preflight short-circuited above the router) — the
    caller buckets those together rather than by raw path, which is unbounded.
    """
    route = scope.get("route")
    return getattr(route, "path", None) if route is not None else None


class RequestIDMiddleware:
    """Attach a correlation id to each request and surface it in the response."""

    def __init__(self, app, header_name: str = _DEFAULT_HEADER):
        self.app = app
        self.header_name = header_name
        # ASGI header names are lowercased byte strings.
        self._lookup = header_name.lower().encode("latin-1")
        self._response_name = header_name.encode("latin-1")

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = None
        for key, value in scope.get("headers", []):
            if key == self._lookup:
                incoming = value.decode("latin-1")
                break

        request_id = _sanitize(incoming) or _new_request_id()
        token = request_id_ctx.set(request_id)
        started = time.perf_counter()
        status_holder = {"status": 0}

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                headers = message.setdefault("headers", [])
                headers.append((self._response_name, request_id.encode("latin-1")))
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            method = scope.get("method") or "-"
            route = _route_template(scope)

            # Telemetry must never be able to fail a request that already
            # succeeded, so it is isolated from the response path.
            try:
                record_request(method, route, status_holder["status"], duration_ms)
            except Exception:  # pragma: no cover - defensive
                access_logger.debug("latency recording failed", exc_info=True)

            # Log the path only (never the query string) so tokens or other
            # secrets passed as query params never reach the logs.
            access_logger.info(
                "request",
                extra={
                    "method": method,
                    "path": scope.get("path"),
                    # Low-cardinality template — this is the field to group by
                    # in the logs; `path` still carries the concrete id.
                    "route": route,
                    "status": status_holder["status"],
                    "duration_ms": duration_ms,
                    # The resolved caller, plus the raw chain it came from.
                    # Rate limiting is only as good as this value, and the
                    # only way to tell whether TRUSTED_PROXY_HOPS matches the
                    # real topology is to see both against live traffic.
                    "client_ip": client_ip_from_scope(scope),
                    "forwarded_for": _forwarded_for_from_scope(scope),
                },
            )
            request_id_ctx.reset(token)
