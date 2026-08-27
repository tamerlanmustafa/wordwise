"""
Backdrop corner sampling — the colour the home card's add glyph reasons about (#115).

Pure-unit: no database, no network, no TMDB key. What is pinned here is the
arithmetic and the failure behaviour, because those are the two things that go
wrong quietly:

  - the patch must be the **top-trailing** region of the still, not the whole
    frame. A mean over the whole image is a plausible-looking number that
    describes the wrong pixels, and nothing downstream would notice.
  - anything unusable must produce None, never a colour. The card's gold + halo
    fallback is a correct render; an invented average is a wrong one.

`average_rgb` takes a flat byte run rather than an image object precisely so
this file exercises it without Pillow.
"""
from __future__ import annotations

import io

import pytest

from src.services.backdrop_ink import (
    CORNER_PATCH_H,
    CORNER_PATCH_W,
    MIN_SIDE_PX,
    average_rgb,
    corner_patch_box,
    corner_rgb_from_bytes,
    pack_rgb,
    unpack_rgb,
)


# ── packing ─────────────────────────────────────────────────────────────────
class TestPacking:
    def test_round_trips(self):
        for rgb in [(0, 0, 0), (255, 255, 255), (12, 200, 255), (236, 199, 62)]:
            assert unpack_rgb(pack_rgb(rgb)) == list(rgb)

    def test_channels_do_not_bleed_into_each_other(self):
        # A shift/mask slip is invisible on greys and obvious here.
        assert unpack_rgb(pack_rgb((255, 0, 0))) == [255, 0, 0]
        assert unpack_rgb(pack_rgb((0, 255, 0))) == [0, 255, 0]
        assert unpack_rgb(pack_rgb((0, 0, 255))) == [0, 0, 255]

    def test_black_is_zero_not_none(self):
        # A legitimately black corner packs to 0, which is falsy in Python. Any
        # `if packed:` on the write path would silently drop night scenes —
        # exactly the backdrops this feature exists for.
        assert pack_rgb((0, 0, 0)) == 0
        assert unpack_rgb(0) == [0, 0, 0]

    def test_fits_in_int4(self):
        assert pack_rgb((255, 255, 255)) == 0xFFFFFF < 2_147_483_647

    def test_none_passes_through(self):
        assert unpack_rgb(None) is None

    def test_out_of_range_is_refused_not_wrapped(self):
        # Only reachable from a hand-written row; must not yield a channel the
        # client's parseCornerRgb would reject.
        assert unpack_rgb(0x1000000) is None
        assert unpack_rgb(-1) is None

    def test_channels_are_clamped(self):
        assert unpack_rgb(pack_rgb((300, -5, 128))) == [255, 0, 128]


# ── patch geometry ──────────────────────────────────────────────────────────
class TestCornerPatchBox:
    def test_is_the_top_trailing_corner(self):
        left, top, right, bottom = corner_patch_box(300, 169)
        assert (left, top, right, bottom) == (240, 0, 300, 44)
        # 20% of the width, 26% of the height — the design's numbers.
        assert right - left == pytest.approx(300 * CORNER_PATCH_W, abs=1)
        assert bottom - top == pytest.approx(169 * CORNER_PATCH_H, abs=1)

    def test_never_empty_on_a_legal_image(self):
        # A degenerate box would divide by zero in average_rgb.
        for w, h in [(1, 1), (2, 3), (32, 32), (1280, 720)]:
            left, top, right, bottom = corner_patch_box(w, h)
            assert right > left and bottom > top

    def test_scale_invariant(self):
        # The same still at two TMDB sizes must sample the same region, which
        # is what makes w300 an honest stand-in for the w780 the card renders.
        small = corner_patch_box(300, 169)
        large = corner_patch_box(1200, 676)
        assert small[0] / 300 == pytest.approx(large[0] / 1200, abs=0.01)
        assert small[3] / 169 == pytest.approx(large[3] / 676, abs=0.01)


# ── averaging ───────────────────────────────────────────────────────────────
class TestAverageRgb:
    def test_uniform_run(self):
        assert average_rgb(bytes([10, 20, 30] * 64)) == (10, 20, 30)

    def test_known_patch(self):
        # Half black, half white -> mid grey, rounded.
        pixels = bytes([0, 0, 0] * 4 + [255, 255, 255] * 4)
        assert average_rgb(pixels) == (128, 128, 128)

    def test_channels_averaged_independently(self):
        pixels = bytes([200, 0, 100, 0, 200, 100])
        assert average_rgb(pixels) == (100, 100, 100)

    def test_accepts_a_plain_list(self):
        assert average_rgb([1, 2, 3, 3, 4, 5]) == (2, 3, 4)

    def test_empty_is_an_error_not_a_colour(self):
        with pytest.raises(ValueError):
            average_rgb(b"")


# ── decode ──────────────────────────────────────────────────────────────────
def _image(width: int, height: int, base, corner=None, fmt="PNG") -> bytes:
    """A synthetic still: `base` everywhere, `corner` painted into the exact
    region corner_patch_box will sample."""
    from PIL import Image

    img = Image.new("RGB", (width, height), base)
    if corner is not None:
        left, top, right, bottom = corner_patch_box(width, height)
        img.paste(Image.new("RGB", (right - left, bottom - top), corner), (left, top))
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


class TestCornerRgbFromBytes:
    def test_reads_the_corner_not_the_frame(self):
        # The whole point: a dark film with a blown-out title card in the
        # corner must report the bright corner, or the glyph picks light ink on
        # a light patch and vanishes — the bug this feature fixes.
        data = _image(300, 169, base=(12, 12, 12), corner=(240, 236, 228))
        assert unpack_rgb(corner_rgb_from_bytes(data)) == [240, 236, 228]

    def test_dark_corner_on_a_bright_frame(self):
        data = _image(300, 169, base=(250, 250, 250), corner=(20, 22, 30))
        assert unpack_rgb(corner_rgb_from_bytes(data)) == [20, 22, 30]

    def test_uniform_image_reports_that_colour(self):
        data = _image(300, 169, base=(90, 110, 130))
        assert unpack_rgb(corner_rgb_from_bytes(data)) == [90, 110, 130]

    def test_jpeg_decodes_too(self):
        # TMDB serves JPEG; PNG is only convenient for the exact-colour asserts.
        data = _image(300, 169, base=(30, 30, 30), corner=(200, 200, 200), fmt="JPEG")
        rgb = unpack_rgb(corner_rgb_from_bytes(data))
        assert rgb is not None
        assert all(abs(c - 200) <= 6 for c in rgb)  # lossy, so a tolerance

    def test_greyscale_is_converted_not_rejected(self):
        from PIL import Image

        buf = io.BytesIO()
        Image.new("L", (300, 169), 128).save(buf, format="PNG")
        assert unpack_rgb(corner_rgb_from_bytes(buf.getvalue())) == [128, 128, 128]

    def test_tiny_image_is_refused(self):
        data = _image(MIN_SIDE_PX - 1, MIN_SIDE_PX - 1, base=(1, 2, 3))
        assert corner_rgb_from_bytes(data) is None

    def test_garbage_is_none_not_an_exception(self):
        # A truncated download must leave the column NULL, not fail an
        # ingestion or a 4,585-row backfill.
        assert corner_rgb_from_bytes(b"not an image at all") is None
        assert corner_rgb_from_bytes(b"") is None


# ── fetch + compute ─────────────────────────────────────────────────────────
class _FakeResponse:
    def __init__(self, content: bytes):
        self.content = content

    def raise_for_status(self):
        return None


class _FakeClient:
    """Records the URLs asked for and hands back one canned still."""

    def __init__(self, content: bytes = b""):
        self.content = content
        self.urls: list[str] = []

    async def get(self, url, **kwargs):
        self.urls.append(url)
        return _FakeResponse(self.content)


@pytest.mark.asyncio
class TestComputeCornerRgb:
    async def test_happy_path_uses_the_w300_still(self):
        from src.services.backdrop_ink import compute_corner_rgb

        client = _FakeClient(_image(300, 169, base=(0, 0, 0), corner=(10, 20, 30)))

        async def details(_tmdb_id):
            return {"backdrop_path": "/abc.jpg"}

        packed = await compute_corner_rgb(1, client=client, get_details=details)
        assert unpack_rgb(packed) == [10, 20, 30]
        # w300, not the w780 the card renders — a tenth of the bytes for the
        # same proportional patch.
        assert client.urls == ["https://image.tmdb.org/t/p/w300/abc.jpg"]

    async def test_no_backdrop_path_never_touches_the_image_host(self):
        from src.services.backdrop_ink import compute_corner_rgb

        client = _FakeClient()

        async def details(_tmdb_id):
            return {"backdrop_path": None}

        assert await compute_corner_rgb(1, client=client, get_details=details) is None
        assert client.urls == []

    async def test_unknown_tmdb_id_is_none(self):
        from src.services.backdrop_ink import compute_corner_rgb

        async def details(_tmdb_id):
            return None  # what tmdb_proxy.get_movie returns for a retired id

        assert await compute_corner_rgb(1, client=_FakeClient(), get_details=details) is None


# ── the /by-cefr payload ────────────────────────────────────────────────────
# The home feed is the only consumer. The column is stored packed and the
# shipped client parses `[r, g, b]` (cardVisuals.parseCornerRgb), so the shape
# crossing the wire is the contract — a regression that leaked the raw integer
# would render as no colour at all, silently, because parseCornerRgb rejects a
# non-array and the card falls back to gold.
class _RowDb:
    def __init__(self, rows):
        self.rows = rows
        self.sql = ""

    async def query_raw(self, sql, *params):
        self.sql = sql
        return self.rows


def _row(**overrides):
    row = {
        "movie_id": 1,
        "tmdb_id": 99,
        "title": "A Film",
        "year": 2001,
        "poster_url": None,
        "description": None,
        "backdrop_corner_rgb": None,
        "difficulty_score": 30,
        "vote_average": 7.5,
        "vote_count": 900,
        "unique_words": 100,
        "cefr_distribution": None,
    }
    row.update(overrides)
    return row


@pytest.mark.asyncio
class TestByCefrPayload:
    async def _call(self, rows):
        from src.routes.movies import list_movies_by_cefr

        db = _RowDb(rows)
        result = await list_movies_by_cefr(
            level="A2",
            genre=None,
            animated=None,
            limit=10,
            offset=0,
            sort="rating",
            order="desc",
            db=db,
            current_user=None,
        )
        return db, result

    async def test_column_is_selected(self):
        db, _ = await self._call([])
        assert "m.backdrop_corner_rgb" in db.sql

    async def test_packed_value_reaches_the_client_as_a_triple(self):
        _, result = await self._call([_row(backdrop_corner_rgb=pack_rgb((12, 200, 255)))])
        value = result["movies"][0]["backdrop_corner_rgb"]
        assert value == [12, 200, 255]
        assert all(isinstance(c, int) and 0 <= c <= 255 for c in value)

    async def test_black_corner_survives_the_payload(self):
        # 0 is falsy; a `if packed else None` anywhere on the read path would
        # drop every night-scene backdrop.
        _, result = await self._call([_row(backdrop_corner_rgb=0)])
        assert result["movies"][0]["backdrop_corner_rgb"] == [0, 0, 0]

    async def test_missing_value_is_null_not_absent(self):
        # The key must still be present: the client keys its memo on it.
        _, result = await self._call([_row(backdrop_corner_rgb=None)])
        movie = result["movies"][0]
        assert "backdrop_corner_rgb" in movie
        assert movie["backdrop_corner_rgb"] is None
