"""
Cache-Control + conditional GET on the public catalogue reads (issue #123).

Before this, Cloudflare fronted the API and cached nothing: the origin sent no
`Cache-Control` and no `ETag`, so every repeat of a body that is identical for
every learner — a movie's detail row, a CEFR shelf, the logged-out vocabulary
teaser — came back to the one API process.

Two halves are pinned here:

  - `utils/http_cache` builds the policy and compares entity tags;
  - `middleware/http_cache` turns a route that declared a `max-age` into one
    that also carries an `ETag` and answers `If-None-Match` with a 304.

Plus the route wiring itself: which movie endpoints opt in, at what TTL, and —
the ones that matter most — which deliberately do not.
"""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

from src.database import get_db
from src.middleware.http_cache import HTTPCacheMiddleware
from src.routes import movies as movies_route
from src.utils.http_cache import compute_etag, etag_matches, public_cache
from src.utils.nlp_executor import NLPOverloaded


# ── policy strings (pure) ───────────────────────────────────────────────────
class TestPublicCache:
    def test_builds_a_public_max_age(self):
        assert public_cache(3600) == "public, max-age=3600"

    def test_appends_stale_while_revalidate(self):
        assert (
            public_cache(60, stale_while_revalidate=600)
            == "public, max-age=60, stale-while-revalidate=600"
        )

    def test_rejects_a_negative_ttl(self):
        with pytest.raises(ValueError):
            public_cache(-1)


# ── entity tags (pure) ──────────────────────────────────────────────────────
class TestEtag:
    def test_is_weak_and_stable_for_the_same_body(self):
        tag = compute_etag(b'{"a":1}')
        assert tag.startswith('W/"')
        assert tag == compute_etag(b'{"a":1}')

    def test_differs_when_a_single_byte_changes(self):
        assert compute_etag(b'{"a":1}') != compute_etag(b'{"a":2}')

    def test_matches_itself(self):
        tag = compute_etag(b"body")
        assert etag_matches(tag, tag)

    def test_matches_the_strong_spelling_of_the_same_tag(self):
        # RFC 9110 compares If-None-Match weakly, so a client (or a CDN) that
        # dropped the W/ prefix must still get its 304.
        tag = compute_etag(b"body")
        assert etag_matches(tag.removeprefix("W/"), tag)

    def test_matches_a_star(self):
        assert etag_matches("*", compute_etag(b"body"))

    def test_finds_the_tag_inside_a_list(self):
        tag = compute_etag(b"body")
        assert etag_matches(f'W/"stale", {tag}, W/"older"', tag)

    def test_does_not_match_a_different_tag(self):
        assert not etag_matches('W/"something-else"', compute_etag(b"body"))

    def test_absent_header_never_matches(self):
        assert not etag_matches(None, compute_etag(b"body"))
        assert not etag_matches("", compute_etag(b"body"))


# ── the middleware ──────────────────────────────────────────────────────────
def _app(*, max_body_bytes: int = 512 * 1024) -> FastAPI:
    """A tiny app covering each branch the middleware has to distinguish."""
    app = FastAPI()
    app.add_middleware(HTTPCacheMiddleware, max_body_bytes=max_body_bytes)

    state = {"n": 0}

    @app.get("/cacheable")
    async def cacheable(response: Response):
        response.headers["Cache-Control"] = public_cache(3600)
        return {"hello": "world"}

    @app.get("/changing")
    async def changing(response: Response):
        response.headers["Cache-Control"] = public_cache(3600)
        state["n"] += 1
        return {"n": state["n"]}

    @app.get("/uncacheable")
    async def uncacheable():
        return {"hello": "world"}

    @app.get("/no-store")
    async def no_store(response: Response):
        # Declares a policy but no max-age — not an opt-in.
        response.headers["Cache-Control"] = "no-store"
        return {"hello": "world"}

    @app.get("/missing")
    async def missing(response: Response):
        response.headers["Cache-Control"] = public_cache(3600)
        raise HTTPException(status_code=404, detail="nope")

    @app.get("/own-tag")
    async def own_tag(response: Response):
        response.headers["Cache-Control"] = public_cache(3600)
        response.headers["ETag"] = 'W/"hand-rolled"'
        return {"hello": "world"}

    @app.get("/chunked")
    async def chunked():
        async def gen():
            yield b'{"part":'
            yield b'"one"}'

        return StreamingResponse(
            gen(),
            media_type="application/json",
            headers={"Cache-Control": public_cache(3600)},
        )

    @app.get("/huge")
    async def huge():
        async def gen():
            for _ in range(4):
                yield b"x" * 1024

        return StreamingResponse(
            gen(),
            media_type="application/octet-stream",
            headers={"Cache-Control": public_cache(3600)},
        )

    @app.post("/cacheable")
    async def cacheable_post(response: Response):
        response.headers["Cache-Control"] = public_cache(3600)
        return {"hello": "world"}

    return app


@pytest.fixture
def client() -> TestClient:
    return TestClient(_app())


class TestConditionalGet:
    def test_a_cacheable_get_gains_a_weak_etag(self, client):
        res = client.get("/cacheable")
        assert res.status_code == 200
        assert res.headers["Cache-Control"] == "public, max-age=3600"
        assert res.headers["ETag"].startswith('W/"')

    def test_repeating_the_tag_gets_a_304_with_no_body(self, client):
        first = client.get("/cacheable")
        second = client.get("/cacheable", headers={"If-None-Match": first.headers["ETag"]})

        assert second.status_code == 304
        assert second.content == b""
        # A 304 must still carry the fields a cache refreshes itself from...
        assert second.headers["ETag"] == first.headers["ETag"]
        assert second.headers["Cache-Control"] == "public, max-age=3600"
        # ...and must not carry a content-length describing a body it lacks.
        assert "content-length" not in second.headers
        assert "content-type" not in second.headers

    def test_a_changed_body_gets_a_new_tag_and_a_200(self, client):
        first = client.get("/changing")
        second = client.get("/changing", headers={"If-None-Match": first.headers["ETag"]})

        assert second.status_code == 200
        assert second.json() == {"n": 2}
        assert second.headers["ETag"] != first.headers["ETag"]

    def test_a_stale_tag_gets_the_full_body(self, client):
        res = client.get("/cacheable", headers={"If-None-Match": 'W/"from-last-week"'})
        assert res.status_code == 200
        assert res.json() == {"hello": "world"}

    def test_a_route_without_cache_control_is_left_alone(self, client):
        res = client.get("/uncacheable")
        assert res.status_code == 200
        assert "ETag" not in res.headers

    def test_no_store_is_not_an_opt_in(self, client):
        res = client.get("/no-store")
        assert "ETag" not in res.headers

    def test_errors_are_never_tagged(self, client):
        # The header the route set is discarded with the response it never
        # returned, so a 404 must not look cacheable to anybody.
        res = client.get("/missing")
        assert res.status_code == 404
        assert "ETag" not in res.headers
        assert "Cache-Control" not in res.headers

    def test_a_route_that_tagged_itself_keeps_its_own_tag(self, client):
        res = client.get("/own-tag")
        assert res.headers["ETag"] == 'W/"hand-rolled"'

    def test_a_streamed_body_is_hashed_whole(self, client):
        res = client.get("/chunked")
        assert res.status_code == 200
        assert res.json() == {"part": "one"}
        assert res.headers["ETag"] == compute_etag(b'{"part":"one"}')

    def test_post_is_untouched(self, client):
        res = client.post("/cacheable")
        assert res.status_code == 200
        assert "ETag" not in res.headers

    def test_a_body_over_the_cap_streams_through_untagged(self):
        # 4 KiB of body against a 1 KiB cap: the middleware must give up and
        # deliver the response intact rather than hold it in memory.
        client = TestClient(_app(max_body_bytes=1024))
        res = client.get("/huge")
        assert res.status_code == 200
        assert len(res.content) == 4096
        assert "ETag" not in res.headers


# ── the movie routes, wired the way main.py wires them ──────────────────────
def _movie_row(**overrides) -> SimpleNamespace:
    base = dict(
        id=1,
        title="Fight Club",
        year=1999,
        genre="Drama",
        wordCount=8000,
        poster_url=None,
        createdAt=None,
        description="An insomniac office worker...",
        difficultyScore=62,
        tmdbId=550,
        cefrDistribution=json.dumps({"B1": 10}),
    )
    base.update(overrides)
    return SimpleNamespace(**base)


class _MovieTable:
    def __init__(self, row):
        self._row = row

    async def find_unique(self, **_):
        return self._row

    async def find_many(self, **_):
        return [self._row] if self._row else []

    async def count(self, **_):
        return 1 if self._row else 0


class _FakeDb:
    def __init__(self, row=None, rows=None):
        self.movie = _MovieTable(row)
        self._rows = rows or []

    async def query_raw(self, *_args, **_kwargs):
        return self._rows


def _movies_client(db: _FakeDb) -> TestClient:
    """The movies router behind the same middleware main.py mounts."""
    app = FastAPI()
    app.add_middleware(HTTPCacheMiddleware)
    app.include_router(movies_route.router)
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


_BY_LEVEL_ROW = {
    "movie_id": 1,
    "tmdb_id": 550,
    "title": "Fight Club",
    "year": 1999,
    "poster_url": None,
    "description": None,
    "difficulty_score": 62,
}


class TestMovieRouteHeaders:
    def test_movie_detail_is_public_for_an_hour_and_revalidates(self):
        client = _movies_client(_FakeDb(_movie_row()))

        first = client.get("/movies/1")
        assert first.status_code == 200
        assert first.headers["Cache-Control"] == "public, max-age=3600"

        second = client.get("/movies/1", headers={"If-None-Match": first.headers["ETag"]})
        assert second.status_code == 304

    def test_difficulty_is_public_for_an_hour(self):
        client = _movies_client(_FakeDb(_movie_row()))
        res = client.get("/movies/1/difficulty")
        assert res.status_code == 200
        assert res.headers["Cache-Control"] == "public, max-age=3600"

    def test_a_missing_movie_is_not_cached(self):
        client = _movies_client(_FakeDb(None))
        res = client.get("/movies/999")
        assert res.status_code == 404
        assert "Cache-Control" not in res.headers
        assert "ETag" not in res.headers

    def test_listings_age_faster_than_a_single_row(self):
        client = _movies_client(_FakeDb(_movie_row()))
        res = client.get("/movies/?limit=10")
        assert res.status_code == 200
        assert res.headers["Cache-Control"] == "public, max-age=900"

    def test_by_level_is_public(self):
        client = _movies_client(_FakeDb(rows=[_BY_LEVEL_ROW]))
        res = client.get("/movies/by-level?level=B1")
        assert res.status_code == 200
        assert res.headers["Cache-Control"] == "public, max-age=900"

    def test_a_rejected_level_is_not_cached(self):
        client = _movies_client(_FakeDb(rows=[]))
        res = client.get("/movies/by-level?level=Z9")
        assert res.status_code == 400
        assert "Cache-Control" not in res.headers

    def test_by_cefr_is_never_marked_public(self):
        # It subtracts the caller's watched / not-interested movies, so a
        # shared cache must never be told this body is reusable — one
        # learner's filtered feed would be handed to the next learner. This is
        # the one catalogue read that stays uncacheable on purpose.
        client = _movies_client(_FakeDb(rows=[]))
        res = client.get("/movies/by-cefr?level=B1")
        assert res.status_code == 200
        assert "Cache-Control" not in res.headers
        assert "ETag" not in res.headers


# ── the vocabulary teaser, whole vs degraded ────────────────────────────────
class _PreviewDb(_FakeDb):
    """Adds the two tables the teaser reads beyond `movies`."""

    def __init__(self):
        super().__init__(_movie_row())
        self.moviescript = SimpleNamespace(
            find_first=self._find_script, find_many=self._find_none
        )
        self.wordclassification = SimpleNamespace(find_many=self._find_none)

    async def _find_script(self, **_):
        return SimpleNamespace(id=7, movieId=1)

    async def _find_none(self, **_):
        return []


async def _preview(monkeypatch, *, idioms_shed: bool):
    """Run the teaser handler with the NLP layer either healthy or overloaded."""

    async def _no_hidden(*_args, **_kwargs):
        return set()

    async def _idioms(*_args, **_kwargs):
        if idioms_shed:
            raise NLPOverloaded("queue full")
        return [{"phrase": "kick the bucket"}]

    monkeypatch.setattr(movies_route, "get_hidden_word_set", _no_hidden)
    monkeypatch.setattr(movies_route, "get_script_idioms", _idioms)

    response = Response()
    payload = await movies_route.get_vocabulary_preview(1, response, db=_PreviewDb(), _=None)
    return response, payload


class TestVocabularyPreviewCaching:
    async def test_a_complete_teaser_is_cacheable(self, monkeypatch):
        response, payload = await _preview(monkeypatch, idioms_shed=False)
        assert payload["idioms_unavailable"] is False
        assert response.headers["Cache-Control"] == "public, max-age=3600"

    async def test_a_shed_parse_is_not_cached(self, monkeypatch):
        # Under NLP load the teaser deliberately answers without idioms. That
        # partial body must not be pinned for an hour, or one shed parse makes
        # a movie look idiom-free to everyone until the TTL runs out.
        response, payload = await _preview(monkeypatch, idioms_shed=True)
        assert payload["idioms_unavailable"] is True
        assert "Cache-Control" not in response.headers
