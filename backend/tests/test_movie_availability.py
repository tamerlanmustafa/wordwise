"""
`GET /movies/availability` — which films our ingest tried and gave up on.

Search shows the whole TMDB catalogue and we can teach from most of it but not
all: 196 of 4,585 queued films sit at `status = 'dead'` in prod, almost every
one of them "no script found in any source". Until now the only way to learn
that was to tap the film, wait out the fetch and land on an error, so the
answer moves to the moment the title appears in the search panel.

Two design decisions are load-bearing enough to be pinned as tests rather than
left to a comment.

**Only `dead` counts.** A film with no job row is *unknown*, not unavailable —
nobody has asked for it yet and it will very likely work. Marking those would
paint most of TMDB as broken, which is both wrong and useless. And a job still
`pending` is one we have not finished trying.

**The answer is derived, never stored.** That is the whole of "make the message
go away when the worker finally processes it": there is no flag to flip, no
cache to invalidate, no push to send. The row stops being `dead` and the next
search stops saying so. A derived answer cannot go stale; a stored one has to
be maintained, and would have been maintained by nobody.

Which is also why the endpoint is `no-store`. The obvious alternative —
annotating `/tmdb/search` — puts the flag inside a `public, max-age=3600`
payload that Cloudflare shares between users, so "not available" would survive
an hour past the moment it stopped being true, with nothing able to correct it.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException


class _FakeDb:
    """Just the raw query the endpoint runs."""

    def __init__(self, dead_ids: set[int]):
        self.dead_ids = dead_ids
        self.queries: list[tuple[str, tuple]] = []

    async def query_raw(self, sql: str, *args):
        self.queries.append((sql, args))
        asked = args[0] if args else []
        return [{"tmdb_id": i} for i in asked if i in self.dead_ids]


class _Response:
    def __init__(self):
        self.headers: dict[str, str] = {}


async def _availability(dead_ids, tmdb_ids: str):
    from src.routes.movies import movie_availability

    db = _FakeDb(set(dead_ids))
    res = _Response()
    body = await movie_availability(response=res, tmdb_ids=tmdb_ids, db=db)
    return body, res, db


class TestWhatCountsAsUnavailable:
    async def test_a_dead_job_is_unavailable(self):
        body, _, _ = await _availability({603}, "603")

        assert body.unavailable == [603]

    async def test_a_film_with_no_job_row_is_not(self):
        """Unknown is not unavailable. Nobody has asked for this film yet, and
        the overwhelming majority of TMDB is in exactly that state — reporting
        it as unavailable would make the badge meaningless."""
        body, _, _ = await _availability(set(), "603,604,605")

        assert body.unavailable == []

    async def test_only_the_dead_ones_come_back(self):
        body, _, _ = await _availability({604}, "603,604,605")

        assert body.unavailable == [604]

    async def test_a_film_the_worker_later_processed_stops_being_reported(self):
        """The requirement in one test. Nothing is invalidated and nothing is
        pushed — the job simply is not `dead` any more, and the same call that
        said so yesterday stops saying so today."""
        before, _, _ = await _availability({603}, "603")
        assert before.unavailable == [603]

        # The worker succeeded; the row is 'done', so it is no longer in the
        # set this query selects.
        after, _, _ = await _availability(set(), "603")
        assert after.unavailable == []


class TestFreshness:
    async def test_the_response_is_never_cached(self):
        """The freshness IS the feature. A public GET with no `Cache-Control`
        would be edge-cached by the same rule that caches the search this
        annotates, and an hour-stale "not available" is the one wrong answer
        this endpoint can give."""
        _, res, _ = await _availability({603}, "603")

        assert res.headers["Cache-Control"] == "no-store"


class TestInput:
    async def test_ids_are_asked_for_in_one_query(self):
        """The caller is a search-as-you-type panel, so this runs on close to
        every keystroke. One `= ANY($1)` rather than a lookup per row."""
        _, _, db = await _availability({603}, "603,604,605")

        assert len(db.queries) == 1
        sql, args = db.queries[0]
        assert "ANY(" in sql
        assert args[0] == [603, 604, 605]

    async def test_an_empty_list_asks_nothing(self):
        body, _, db = await _availability({603}, "")

        assert body.unavailable == []
        assert db.queries == []

    async def test_whitespace_and_empty_segments_are_tolerated(self):
        body, _, _ = await _availability({604}, " 603 , 604 ,")

        assert body.unavailable == [604]

    async def test_a_non_numeric_id_is_a_400_not_a_500(self):
        with pytest.raises(HTTPException) as exc:
            await _availability({603}, "603,drop-table")

        assert exc.value.status_code == 400

    async def test_the_batch_is_capped(self):
        """Same ceiling as the TMDB batch endpoint. A search panel shows three
        rows; the cap stops the endpoint being a way to walk the catalogue."""
        with pytest.raises(HTTPException) as exc:
            await _availability(set(), ",".join(str(i) for i in range(41)))

        assert exc.value.status_code == 400

    async def test_forty_is_allowed(self):
        body, _, _ = await _availability(set(), ",".join(str(i) for i in range(40)))

        assert body.unavailable == []
