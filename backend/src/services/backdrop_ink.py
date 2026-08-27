"""
The average colour under the home card's add-to-list glyph (issue #115).

The glyph sits in the trailing top corner of a home-feed card, which is exactly
the part of the backdrop the card's scrim covers least — so a fixed gold glyph
disappears on roughly a third of real stills. The client already knows how to
choose ink by WCAG contrast (`cardVisuals.pickPlusInk`); what it never had was
the colour to choose against.

Sampling on the device is not the answer and never was: TMDB serves without
permissive CORS, decoding a still per row costs frames on a scrolling list, and
the value never changes once computed. So it is computed once, here, and stored
on the movie.

Storage shape: one packed integer, not `int[]`
----------------------------------------------
`movies.backdrop_corner_rgb` holds `r << 16 | g << 8 | b` (0..16,777,215 — well
inside int4). The wire format stays `[r, g, b]`, because that is what the
shipped client parses (`parseCornerRgb`), and `unpack_rgb` is the one place the
two meet.

An `int[]` column would read better in psql, and that is the whole of its case.
Against it: `/movies/by-cefr` is a `query_raw` statement, and how the Prisma
query engine serializes a Postgres array through that path is not something
this repo has ever exercised — the same handler already has to defensively
`json.loads` its JSONB column because raw-query scalars come back inconsistently
typed. A plain integer has exactly one representation.

Decoding is CPU work
--------------------
JPEG decode is not awaited I/O, so on the API process it goes through `run_cpu`
(CLAUDE.md; the pools and why they are separate are documented in
`utils/offload.py`). It is small work — the fetched still is `w300`, and only
the corner patch is ever materialised into Python — but "small" measured on one
laptop is not a licence to run it on the only event loop the service has.
"""

from __future__ import annotations

import io
import logging
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import httpx

from ..utils.offload import run_cpu

logger = logging.getLogger(__name__)

Rgb = Tuple[int, int, int]

# ── Patch geometry ──────────────────────────────────────────────────────────
# The fraction of the backdrop the glyph covers, from the design: the top
# 26% of the frame, the trailing 20% of its width. This is a region of the
# *image*, not of the card — the card renders the whole 16:9 frame with
# `resizeMode="contain"`, so the two map onto each other directly.
#
# Deliberately the top-RIGHT patch, in image coordinates, not "the trailing
# corner". Under RTL the card mirrors (`end: 0`) but the still does not, so the
# glyph lands over the image's top-left and this value no longer describes what
# is behind it. The client drops back to gold + halo there rather than colouring
# from the wrong pixels; see `cardVisuals.cornerForGlyph`.
CORNER_PATCH_W = 0.20
CORNER_PATCH_H = 0.26

# Below this, the patch is too few pixels for the average to mean anything and
# the still is almost certainly a placeholder rather than a backdrop.
MIN_SIDE_PX = 32

# ── TMDB image source ───────────────────────────────────────────────────────
# w300 (300x169) rather than the w780 the card renders. An average over a
# proportional region is scale-invariant to within a rounding error, and w300 is
# roughly a tenth of the bytes — which over a 4,569-movie backfill is the
# difference between ~230 MB and ~25 MB downloaded.
IMAGE_BASE_URL = "https://image.tmdb.org/t/p"
BACKDROP_SIZE = "w300"

_IMAGE_TIMEOUT = httpx.Timeout(12.0, connect=5.0)


# ── Packing (pure) ──────────────────────────────────────────────────────────
def pack_rgb(rgb: Sequence[int]) -> int:
    """`(r, g, b)` -> the single integer stored on the movie row."""
    r, g, b = (_clamp_channel(c) for c in tuple(rgb)[:3])
    return (r << 16) | (g << 8) | b


def unpack_rgb(packed: Optional[int]) -> Optional[List[int]]:
    """The stored integer -> the `[r, g, b]` the client parses. None passes
    through, because a movie with no usable backdrop stores nothing and the
    client's gold + halo fallback is the correct render for it."""
    if packed is None:
        return None
    value = int(packed)
    if value < 0 or value > 0xFFFFFF:
        # Not reachable from `pack_rgb`; guards a hand-written row from
        # producing an out-of-range channel the client would reject anyway.
        logger.warning("[backdrop-ink] discarding out-of-range packed rgb %s", value)
        return None
    return [(value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF]


def _clamp_channel(value: int) -> int:
    return max(0, min(255, int(value)))


# ── Averaging (pure) ────────────────────────────────────────────────────────
def corner_patch_box(width: int, height: int) -> Tuple[int, int, int, int]:
    """Pixel bounds `(left, top, right, bottom)` of the patch under the glyph.

    Right/bottom are exclusive, matching Pillow's `crop`. The box is always at
    least one pixel in each direction, so a legal image can never produce an
    empty patch and a division by zero downstream.
    """
    left = min(width - 1, max(0, round(width * (1.0 - CORNER_PATCH_W))))
    bottom = max(1, min(height, round(height * CORNER_PATCH_H)))
    return (left, 0, width, bottom)


def average_rgb(pixels: Sequence[int]) -> Rgb:
    """Mean of a flat RGB byte run — `[r0, g0, b0, r1, g1, b1, ...]`.

    Takes bytes rather than an image object on purpose: it keeps the only piece
    of arithmetic in this module testable without Pillow installed, which is
    what lets the CI test environment (`requirements-dev.txt`) stay lean.
    """
    count = len(pixels) // 3
    if count == 0:
        raise ValueError("average_rgb: empty pixel run")
    totals = [0, 0, 0]
    for i in range(0, count * 3, 3):
        totals[0] += pixels[i]
        totals[1] += pixels[i + 1]
        totals[2] += pixels[i + 2]
    return (
        round(totals[0] / count),
        round(totals[1] / count),
        round(totals[2] / count),
    )


# ── Decoding (Pillow) ───────────────────────────────────────────────────────
def corner_rgb_from_bytes(data: bytes) -> Optional[int]:
    """Packed corner average for one encoded image, or None if it is unusable.

    Every failure mode collapses to None by design — a still that TMDB has
    retired, a truncated download, a format Pillow declines, an image too small
    to sample. The column stays NULL and the card renders the gold + halo
    fallback it renders today. Inventing a colour would be worse than not
    having one.

    Synchronous and CPU-bound: call it through `run_cpu`, never inline in a
    request handler.
    """
    # Imported here rather than at module scope so that importing this service
    # — which `routes/movies.py` does, for `unpack_rgb` alone — never depends
    # on Pillow being present.
    from PIL import Image

    try:
        with Image.open(io.BytesIO(data)) as img:
            width, height = img.size
            if width < MIN_SIDE_PX or height < MIN_SIDE_PX:
                logger.info("[backdrop-ink] image too small: %dx%d", width, height)
                return None
            patch = img.convert("RGB").crop(corner_patch_box(width, height))
            return pack_rgb(average_rgb(patch.tobytes()))
    except Exception as exc:  # noqa: BLE001 - see docstring; NULL is the answer
        logger.info("[backdrop-ink] undecodable image (%s)", exc)
        return None


# ── Fetch + compute ─────────────────────────────────────────────────────────
async def fetch_backdrop_bytes(
    backdrop_path: str, client: httpx.AsyncClient
) -> Optional[bytes]:
    """Download one backdrop still. None on any transport or HTTP failure."""
    url = f"{IMAGE_BASE_URL}/{BACKDROP_SIZE}{backdrop_path}"
    try:
        response = await client.get(url, timeout=_IMAGE_TIMEOUT)
        response.raise_for_status()
        return response.content
    except Exception as exc:  # noqa: BLE001 - a missing still is not an error
        logger.info("[backdrop-ink] fetch failed for %s (%s)", backdrop_path, exc)
        return None


async def compute_corner_rgb(
    tmdb_id: int,
    *,
    client: Optional[httpx.AsyncClient] = None,
    get_details: Optional[Callable[[int], Any]] = None,
) -> Optional[int]:
    """Packed corner average for a TMDB id, or None if there is nothing to
    sample.

    `get_details` defaults to the cached TMDB proxy, so a movie already looked
    up by the app costs no extra call. `client` lets a caller with many movies
    to do (the backfill) hand in one connection pool instead of paying a TLS
    handshake per still.
    """
    if get_details is None:
        from . import tmdb_proxy

        get_details = tmdb_proxy.get_movie

    details: Optional[Dict[str, Any]] = await get_details(int(tmdb_id))
    backdrop_path = (details or {}).get("backdrop_path")
    if not backdrop_path:
        return None

    if client is not None:
        data = await fetch_backdrop_bytes(backdrop_path, client)
    else:
        # One-shot caller (ingestion). Matches `TMDBClient`'s own choice: a
        # fresh pool is fine when the alternative is a process-wide client
        # nobody is responsible for closing.
        async with httpx.AsyncClient() as one_shot:
            data = await fetch_backdrop_bytes(backdrop_path, one_shot)

    if not data:
        return None
    return await run_cpu(corner_rgb_from_bytes, data)
