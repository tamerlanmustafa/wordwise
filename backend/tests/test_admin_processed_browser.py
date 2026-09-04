"""
The admin processed-movies browser: sorting, paging, and the SQL it builds.

Pure-unit — the Prisma client is a call recorder, so these run without a
database. What is pinned is the statement the handler *composes*, because that
is where this endpoint's two real hazards live:

  - the sort is f-stringed into ORDER BY, so it must come from a whitelist and
    never from the query string;
  - the whitelist is written against the OUTER sub-select's column names. The
    script's `updated_at` is projected as `processed_at`, so a sort naming the
    base-table column compiles fine in Python and fails in Postgres.

The second one was a real bug in the first draft of this endpoint.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from src.routes.admin import PROCESSED_SORTS, list_processed_movies


class _FakeDb:
    def __init__(self, rows: list | None = None):
        self.calls: list[tuple[str, tuple]] = []
        self.rows = rows if rows is not None else []

    async def query_raw(self, sql, *params):
        self.calls.append((sql, params))
        return self.rows


def _row(movie_id: int = 1, **over):
    base = {
        "movie_id": movie_id,
        "tmdb_id": 100 + movie_id,
        "title": f"Film {movie_id}",
        "year": 2020,
        "difficulty_score": 42,
        "popularity": 9.5,
        "vote_average": 7.1,
        "vote_count": 1234,
        "processed_at": datetime(2026, 9, 3, 12, 0, tzinfo=timezone.utc),
    }
    base.update(over)
    return base


async def _call(rows=None, **kwargs):
    db = _FakeDb(rows)
    opts = {
        "level": None,
        "sort": "processed",
        "limit": 40,
        "offset": 0,
        "admin_user": object(),
        "db": db,
    }
    opts.update(kwargs)
    result = await list_processed_movies(**opts)
    return db, result


@pytest.mark.asyncio
class TestSorting:
    async def test_defaults_to_most_recently_processed(self):
        # The screen's usual question is "did the thing I just kicked off
        # land?", which popularity order buries behind 4,000 blockbusters.
        db, result = await _call()
        sql, _ = db.calls[0]
        assert result["sort"] == "processed"
        assert "ORDER BY d.processed_at DESC" in sql

    @pytest.mark.parametrize("key", sorted(PROCESSED_SORTS))
    async def test_every_whitelisted_sort_names_an_outer_column(self, key):
        # The regression this guards: `s.updated_at` is projected as
        # `processed_at`, so a sort naming the base table would reference a
        # column the outer query has never heard of.
        db, _ = await _call(sort=key)
        sql, _ = db.calls[0]
        outer = sql.split(") d")[1]
        column = PROCESSED_SORTS[key].split()[0]
        assert column.startswith("d.")
        assert column in outer
        # And the projection actually produces it.
        assert f"AS {column[2:]}" in sql or f"{column[2:]}" in sql.split(") d")[0]

    async def test_an_unknown_sort_is_rejected_not_interpolated(self):
        with pytest.raises(HTTPException) as exc:
            await _call(sort="title; DROP TABLE movies")
        assert exc.value.status_code == 400

    async def test_the_tiebreaker_keeps_paging_stable(self):
        # Without it, rows sharing a sort value can reorder between pages and
        # OFFSET paging silently skips or repeats a film.
        db, _ = await _call()
        sql, _ = db.calls[0]
        assert "d.movie_id DESC" in sql


@pytest.mark.asyncio
class TestPaging:
    async def test_over_fetches_one_row_to_answer_has_more(self):
        # Cheaper than a second COUNT over the same predicates.
        db, result = await _call(limit=2, rows=[_row(1), _row(2), _row(3)])
        _sql, params = db.calls[0]
        assert 3 in params, "limit+1 must reach the query"
        assert result["has_more"] is True
        assert len(result["movies"]) == 2

    async def test_reports_no_more_when_the_page_is_short(self):
        _db, result = await _call(limit=5, rows=[_row(1)])
        assert result["has_more"] is False
        assert result["total"] == 1

    async def test_offset_reaches_the_query_and_is_echoed(self):
        db, result = await _call(offset=80)
        _sql, params = db.calls[0]
        assert 80 in params
        assert result["offset"] == 80

    async def test_a_negative_offset_is_clamped_rather_than_sent(self):
        db, result = await _call(offset=-10)
        _sql, params = db.calls[0]
        assert 0 in params
        assert result["offset"] == 0

    async def test_the_page_size_is_capped(self):
        # The old endpoint returned up to 1,000 rows and the client rendered
        # every one; a phone should never be handed that in one response.
        db, _ = await _call(limit=10_000)
        _sql, params = db.calls[0]
        assert 101 in params  # 100 cap, over-fetched by one

    async def test_placeholders_stay_in_step_with_params(self):
        db, _ = await _call(level="B1")
        sql, params = db.calls[0]
        used = {int(n) for n in re.findall(r"\$(\d+)", sql)}
        assert used == set(range(1, len(params) + 1))


@pytest.mark.asyncio
class TestPayload:
    async def test_carries_the_processed_date_as_an_iso_string(self):
        # The client sorts and prints it; a datetime would not survive JSON.
        _db, result = await _call(rows=[_row()])
        assert result["movies"][0]["processed_at"] == "2026-09-03T12:00:00+00:00"

    async def test_a_missing_processed_date_does_not_crash_the_row(self):
        _db, result = await _call(rows=[_row(processed_at=None)])
        assert result["movies"][0]["processed_at"] is None

    async def test_the_level_is_derived_not_stored(self):
        # #103: nothing stores a level; it is banded off the score on read.
        _db, result = await _call(rows=[_row(difficulty_score=42)])
        assert result["movies"][0]["difficulty_level"] == "B1"

    async def test_only_preprocessed_scripts_are_listed(self):
        db, _ = await _call()
        sql, _ = db.calls[0]
        assert "s.is_preprocessed = true" in sql

    async def test_one_row_per_film_even_with_two_script_rows(self):
        db, _ = await _call()
        sql, _ = db.calls[0]
        assert "DISTINCT ON (m.id)" in sql
