"""
Conditional-GET middleware: attach an `ETag`, answer `If-None-Match` (#123).

A pure-ASGI middleware (like `request_id`) rather than `BaseHTTPMiddleware`,
because it has to see the finished response body — the routes return dicts and
FastAPI serializes them somewhere below us.

**A route opts in by setting its own `Cache-Control`.** If a 200 GET declares a
`max-age`, its author has already asserted the body is safe to reuse, which is
exactly the assertion an entity tag needs; nothing else on the app gets touched.
That keeps the opt-in visible at the route (see `routes/movies.py` and
`routes/tmdb.py`) instead of in a path list here that would silently rot as
routes are renamed.

What this buys and what it does not: a 304 still runs the route and still hits
Postgres, so it saves the response body, not the query. The `Cache-Control`
half of #123 is what saves the query — and only once a cache actually honours
it. Measured 2026-08-20: `api.getwordwise.us` sits behind Cloudflare, and even
`/api/tmdb/trending`, which has sent `public, max-age=3600` since #125, still
returns `cf-cache-status: DYNAMIC` — the edge caches by file extension by
default and an extensionless JSON path is not on that list. So today the
`max-age` is honoured by the phone's own HTTP cache (NSURLSession on iOS,
OkHttp on Android) and by browsers; making the edge honour it too is a cache
rule in the Cloudflare dashboard, not a code change.
"""

from __future__ import annotations

from ..utils.http_cache import ETAG_MAX_BODY_BYTES, compute_etag, etag_matches

# Headers a 304 is allowed to carry. Everything else — notably content-type
# and content-length — is dropped, because a 304 has no content and a stale
# content-length is how you wedge a client waiting for bytes that never come.
_NOT_MODIFIED_HEADERS = frozenset(
    {
        b"cache-control",
        b"content-location",
        b"date",
        b"etag",
        b"expires",
        b"last-modified",
        b"vary",
    }
)


def _header(headers, name: bytes):
    for key, value in headers:
        if key.lower() == name:
            return value
    return None


class HTTPCacheMiddleware:
    """Add weak ETags to cacheable GETs and short-circuit repeats to 304."""

    def __init__(self, app, max_body_bytes: int = ETAG_MAX_BODY_BYTES):
        self.app = app
        self.max_body_bytes = max_body_bytes

    def _is_eligible(self, message) -> bool:
        if message["status"] != 200:
            return False
        headers = message.get("headers") or []
        # Never overwrite a tag a route computed for itself.
        if _header(headers, b"etag") is not None:
            return False
        cache_control = _header(headers, b"cache-control")
        return cache_control is not None and b"max-age=" in cache_control.lower()

    async def __call__(self, scope, receive, send):
        # GET only. HEAD would need the body to hash but must not send it, and
        # nothing calls HEAD on these routes; leaving it alone beats guessing.
        if scope["type"] != "http" or scope.get("method") != "GET":
            await self.app(scope, receive, send)
            return

        if_none_match = None
        for key, value in scope.get("headers", []):
            if key == b"if-none-match":
                if_none_match = value.decode("latin-1")
                break

        start_message = None
        buffered = bytearray()
        # Once set, every later message goes straight out: either the response
        # was never eligible, or it outgrew the buffer and we gave up on it.
        passthrough = False

        async def send_wrapper(message):
            nonlocal start_message, passthrough

            if passthrough:
                await send(message)
                return

            if message["type"] == "http.response.start":
                if self._is_eligible(message):
                    start_message = message
                else:
                    passthrough = True
                    await send(message)
                return

            if message["type"] != "http.response.body":
                # Some other ASGI extension message (zero-copy send, trailers).
                # We are holding `start`, so release it first or it would be
                # sent after a message that must follow it, and stop
                # intercepting rather than guess at the protocol.
                passthrough = True
                if start_message is not None:
                    await send(start_message)
                    if buffered:
                        await send(
                            {
                                "type": "http.response.body",
                                "body": bytes(buffered),
                                "more_body": True,
                            }
                        )
                await send(message)
                return

            buffered.extend(message.get("body", b""))

            if len(buffered) > self.max_body_bytes:
                # Too big to be worth holding. Release what we have and stop
                # intercepting — the caller gets a normal, untagged response.
                passthrough = True
                await send(start_message)
                await send(
                    {
                        "type": "http.response.body",
                        "body": bytes(buffered),
                        "more_body": message.get("more_body", False),
                    }
                )
                return

            if message.get("more_body", False):
                return

            body = bytes(buffered)
            etag = compute_etag(body)
            headers = start_message.setdefault("headers", [])
            headers.append((b"etag", etag.encode("latin-1")))

            if etag_matches(if_none_match, etag):
                await send(
                    {
                        "type": "http.response.start",
                        "status": 304,
                        "headers": [
                            (key, value)
                            for key, value in headers
                            if key.lower() in _NOT_MODIFIED_HEADERS
                        ],
                    }
                )
                await send({"type": "http.response.body", "body": b"", "more_body": False})
                return

            await send(start_message)
            await send({"type": "http.response.body", "body": body, "more_body": False})

        await self.app(scope, receive, send_wrapper)
