"""
Cache policy + entity tags for the public, globally-identical reads (#123).

Almost everything this API serves *by volume* is one global content corpus:
movie metadata, difficulty, the CEFR shelves, the logged-out vocabulary
teaser. Those bodies are byte-identical for every caller and only change when
an ingestion or backfill worker rewrites the row — yet the origin sent no
`Cache-Control` and no `ETag`, so every repeat request re-ran the query on the
one API process.

The two mechanisms here save different things and are worth keeping straight:

  - `public_cache(...)` builds the `Cache-Control` value. While a response is
    fresh the caller reuses it without asking us anything, so it saves the
    whole round trip — query, serialization and bytes.
  - the weak `ETag` (attached by `middleware/http_cache.py`) saves only the
    *bytes*. A conditional request still reaches the route and still runs the
    query; we just answer `304 Not Modified` instead of re-sending a body the
    caller already holds.

Busting is by expiry, not by purge: there is no invalidation hook to forget to
call, so TTLs stay at or under an hour and a backfill self-heals within the
hour.

Weak tags (`W/"..."`) rather than strong ones on purpose. A strong tag is a
promise of byte-for-byte identity, and the CDN in front of us re-encodes
bodies (it, not this process, does the gzip), which would break that promise.
`If-None-Match` compares weakly anyway, so nothing is lost.
"""

from __future__ import annotations

import hashlib
from typing import Iterable, Optional

# Bodies larger than this are streamed through without an ETag rather than
# buffered to be hashed. Nothing in the public read set comes close; the cap
# exists so that a large or streaming response (a cached EPUB, say) can never
# be pulled into memory just to compute a tag.
ETAG_MAX_BODY_BYTES = 512 * 1024


def public_cache(max_age: int, *, stale_while_revalidate: Optional[int] = None) -> str:
    """
    `Cache-Control` for a body that is the same for every caller.

    `public` is the load-bearing word: it tells shared caches (the CDN) that
    this response is not tied to one user. Only use it on a response that no
    part of the request identity can change — no auth, no per-user filtering.
    Anything personalized must stay off this helper entirely.
    """
    if max_age < 0:
        raise ValueError("max_age must not be negative")
    parts = [f"public, max-age={max_age}"]
    if stale_while_revalidate is not None:
        parts.append(f"stale-while-revalidate={stale_while_revalidate}")
    return ", ".join(parts)


def compute_etag(body: bytes) -> str:
    """A weak entity tag for an exact response body."""
    digest = hashlib.blake2b(body, digest_size=16).hexdigest()
    return f'W/"{digest}"'


def _normalize(tag: str) -> str:
    """Strip the weak marker so `W/"x"` and `"x"` compare equal."""
    tag = tag.strip()
    if tag.startswith(("W/", "w/")):
        tag = tag[2:]
    return tag


def etag_matches(if_none_match: Optional[str], etag: str) -> bool:
    """
    Does the client's `If-None-Match` cover the tag we just computed?

    `*` means "any current representation", which for a 200 always matches.
    Otherwise it is a comma-separated list compared weakly, per RFC 9110.
    """
    if not if_none_match:
        return False
    candidates: Iterable[str] = if_none_match.split(",")
    mine = _normalize(etag)
    for candidate in candidates:
        candidate = candidate.strip()
        if candidate == "*":
            return True
        if _normalize(candidate) == mine:
            return True
    return False
