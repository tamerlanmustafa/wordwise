"""
The server-side TMDB proxy (issue #125).

What broke before it existed: the app called api.themoviedb.org once per movie
per page, straight from the device, signed with a key baked into the bundle.
These tests pin the two halves of the fix — one request for a whole page, and
a cache that keeps the Nth device off TMDB entirely — plus the response shape
the app depends on.
"""
from __future__ import annotations

import asyncio

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.routes.tmdb import router as tmdb_router
from src.services import tmdb_proxy


def _raw_details(tmdb_id: int = 550) -> dict:
    """A TMDB /movie/{id} payload, including the fat fields we drop."""
    return {
        "id": tmdb_id,
        "title": "Fight Club",
        "original_language": "en",
        "overview": "An insomniac office worker...",
        "poster_path": "/poster.jpg",
        "backdrop_path": "/backdrop.jpg",
        "release_date": "1999-10-15",
        "vote_average": 8.4,
        "vote_count": 27000,
        "popularity": 61.4,
        "genres": [{"id": 18, "name": "Drama"}, {"id": 53, "name": "Thriller"}],
        "production_companies": [{"id": 1, "name": "Fox 2000", "logo_path": "/x.png"}],
        "belongs_to_collection": None,
        "spoken_languages": [{"iso_639_1": "en", "name": "English"}],
        "budget": 63000000,
    }


def _raw_list() -> dict:
    """A TMDB search/discover/trending payload — rows carry genre_ids."""
    return {
        "page": 1,
        "total_pages": 3,
        "total_results": 42,
        "results": [
            {
                "id": 680,
                "title": "Pulp Fiction",
                "original_language": "en",
                "overview": "A burger-loving hit man...",
                "poster_path": "/pf.jpg",
                "backdrop_path": None,
                "release_date": "1994-09-10",
                "vote_average": 8.5,
                "vote_count": 26000,
                "popularity": 74.2,
                "genre_ids": [53, 80],
                "adult": False,
                "video": False,
            }
        ],
    }


@pytest.fixture(autouse=True)
def _clean_caches():
    """The proxy's caches are module-level, so leaking between tests is real."""
    tmdb_proxy.clear_caches()
    yield
    tmdb_proxy.clear_caches()


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(tmdb_router)
    return TestClient(app)


class _FakeTmdb:
    """Stands in for `tmdb_get`, counting the calls that reach TMDB."""

    def __init__(self, responses=None, error=None):
        self.responses = responses or {}
        self.error = error
        self.calls = []

    async def __call__(self, path, params=None):
        self.calls.append((path, params or {}))
        if self.error is not None:
            raise self.error
        if path in self.responses:
            return self.responses[path]
        raise AssertionError(f"unexpected TMDB path {path!r}")


# ── projection ──────────────────────────────────────────────────────────────
async def test_details_are_trimmed_to_the_fields_the_app_renders(monkeypatch):
    fake = _FakeTmdb({"/movie/550": _raw_details()})
    monkeypatch.setattr(tmdb_proxy, "tmdb_get", fake)

    movie = await tmdb_proxy.get_movie(550)

    assert movie["title"] == "Fight Club"
    assert movie["poster_path"] == "/poster.jpg"
    # The fat fields no screen reads never leave the server.
    for dropped in ("production_companies", "spoken_languages", "budget", "genres"):
        assert dropped not in movie


async def test_details_expose_genre_ids_like_a_search_row_does(monkeypatch):
    """
    TMDB gives `genres: [{id, name}]` on details and `genre_ids: [int]` on
    search rows. The app only ever reads `genre_ids`, so a movie opened from
    the CEFR list used to show no genre chips at all.
    """
    fake = _FakeTmdb({"/movie/550": _raw_details()})
    monkeypatch.setattr(tmdb_proxy, "tmdb_get", fake)

    movie = await tmdb_proxy.get_movie(550)
    assert movie["genre_ids"] == [18, 53]


async def test_list_rows_keep_their_genre_ids_and_paging(monkeypatch):
    fake = _FakeTmdb({"/search/movie": _raw_list()})
    monkeypatch.setattr(tmdb_proxy, "tmdb_get", fake)

    payload = await tmdb_proxy.search("pulp", 1)

    assert payload["total_pages"] == 3
    assert payload["results"][0]["genre_ids"] == [53, 80]
    assert "adult" not in payload["results"][0]


# ── batching + caching ──────────────────────────────────────────────────────
async def test_a_page_of_movies_costs_one_tmdb_call_per_distinct_id(monkeypatch):
    fake = _FakeTmdb({f"/movie/{i}": _raw_details(i) for i in (1, 2, 3)})
    monkeypatch.setattr(tmdb_proxy, "tmdb_get", fake)

    found = await tmdb_proxy.get_movies([1, 2, 3, 2, 1])

    assert sorted(found) == [1, 2, 3]
    assert len(fake.calls) == 3


async def test_a_second_page_render_touches_tmdb_zero_times(monkeypatch):
    """The whole point of the cache: user two pays nothing for user one's page."""
    fake = _FakeTmdb({f"/movie/{i}": _raw_details(i) for i in (1, 2)})
    monkeypatch.setattr(tmdb_proxy, "tmdb_get", fake)

    await tmdb_proxy.get_movies([1, 2])
    await tmdb_proxy.get_movies([1, 2])

    assert len(fake.calls) == 2


async def test_two_devices_asking_at_once_still_make_one_call(monkeypatch):
    calls = 0

    async def slow_get(path, params=None):
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        return _raw_details(550)

    monkeypatch.setattr(tmdb_proxy, "tmdb_get", slow_get)
    await asyncio.gather(*(tmdb_proxy.get_movie(550) for _ in range(10)))
    assert calls == 1


async def test_one_bad_id_does_not_lose_the_rest_of_the_page(monkeypatch):
    async def flaky(path, params=None):
        if path == "/movie/2":
            raise httpx.ConnectError("boom")
        return _raw_details(int(path.rsplit("/", 1)[1]))

    monkeypatch.setattr(tmdb_proxy, "tmdb_get", flaky)

    found = await tmdb_proxy.get_movies([1, 2, 3])
    assert sorted(found) == [1, 3]


async def test_an_id_tmdb_has_retired_is_remembered_as_missing(monkeypatch):
    """A 404 is cached, or a dead id is re-requested on every page render."""
    calls = 0

    async def gone(path, params=None):
        nonlocal calls
        calls += 1
        request = httpx.Request("GET", "https://api.themoviedb.org" + path)
        raise httpx.HTTPStatusError(
            "not found", request=request, response=httpx.Response(404, request=request)
        )

    monkeypatch.setattr(tmdb_proxy, "tmdb_get", gone)

    assert await tmdb_proxy.get_movie(999) is None
    assert await tmdb_proxy.get_movie(999) is None
    assert calls == 1


# ── routes ──────────────────────────────────────────────────────────────────
def test_batch_endpoint_returns_a_page_in_one_request(client, monkeypatch):
    fake = _FakeTmdb({f"/movie/{i}": _raw_details(i) for i in (1, 2)})
    monkeypatch.setattr(tmdb_proxy, "tmdb_get", fake)

    res = client.get("/api/tmdb/movies", params={"ids": "1,2"})

    assert res.status_code == 200
    assert sorted(res.json()["movies"]) == ["1", "2"]
    assert res.headers["cache-control"] == "public, max-age=86400"


def test_batch_endpoint_rejects_junk_and_oversized_id_lists(client):
    assert client.get("/api/tmdb/movies", params={"ids": "1,abc"}).status_code == 400
    assert client.get("/api/tmdb/movies", params={"ids": ""}).status_code == 400
    too_many = ",".join(str(i) for i in range(50))
    assert client.get("/api/tmdb/movies", params={"ids": too_many}).status_code == 400


def test_missing_movie_is_a_404_not_a_null_body(client, monkeypatch):
    async def gone(path, params=None):
        request = httpx.Request("GET", "https://api.themoviedb.org" + path)
        raise httpx.HTTPStatusError(
            "not found", request=request, response=httpx.Response(404, request=request)
        )

    monkeypatch.setattr(tmdb_proxy, "tmdb_get", gone)
    assert client.get("/api/tmdb/movie/999").status_code == 404


def test_tmdb_being_down_reads_as_502_not_500(client, monkeypatch):
    monkeypatch.setattr(tmdb_proxy, "tmdb_get", _FakeTmdb(error=httpx.ConnectError("down")))
    res = client.get("/api/tmdb/trending")
    assert res.status_code == 502


def test_trending_and_search_are_cacheable_for_an_hour(client, monkeypatch):
    fake = _FakeTmdb({"/trending/movie/day": _raw_list(), "/search/movie": _raw_list()})
    monkeypatch.setattr(tmdb_proxy, "tmdb_get", fake)

    for path, params in (("/api/tmdb/trending", {}), ("/api/tmdb/search", {"q": "pulp"})):
        res = client.get(path, params=params)
        assert res.status_code == 200
        assert res.headers["cache-control"] == "public, max-age=3600"


def test_discover_restricts_to_english_originals_with_enough_votes(client, monkeypatch):
    fake = _FakeTmdb({"/discover/movie": _raw_list()})
    monkeypatch.setattr(tmdb_proxy, "tmdb_get", fake)

    assert client.get("/api/tmdb/discover", params={"genres": "28|12"}).status_code == 200

    _, params = fake.calls[0]
    assert params["with_original_language"] == "en"
    assert params["vote_count.gte"] == 5000
    assert params["with_genres"] == "28|12"


def test_discover_rejects_a_non_numeric_genre_list(client):
    assert client.get("/api/tmdb/discover", params={"genres": "drama"}).status_code == 400


def test_the_api_key_never_appears_in_a_proxied_response(client, monkeypatch):
    """
    The reason this proxy exists. `tmdb_get` adds the key inside the server
    process; nothing it returns should carry it back out to a device.
    """
    fake = _FakeTmdb({"/movie/550": _raw_details()})
    monkeypatch.setattr(tmdb_proxy, "tmdb_get", fake)

    body = client.get("/api/tmdb/movie/550").text
    assert "api_key" not in body
