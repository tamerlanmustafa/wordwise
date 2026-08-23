"""
Home-feed animation filter — the `animated` param on /movies/by-cefr (#114).

Pure-unit: the Prisma client is faked (a call recorder), so these run without a
database. What is being pinned is the SQL the handler *builds*, because that is
where the two things that can silently go wrong live:

  - the genre test must be **contains**, not equality. `movies.genre` is a JSON
    array serialized into a VarChar, so a film tagged
    '["Animation", "Comedy", "Family"]' is animated and `genre = 'Animation'`
    would miss it.
  - the placeholders must stay in step with the params list. `genre` and
    `animated` are independent, so four combinations reach the same statement;
    an off-by-one in $n renumbering would bind `offset` to the LIMIT.

`_animation_filter_sql` itself is tested directly since it is the whole
decision about where the 171 genre-less films go.
"""
from __future__ import annotations

import re

import pytest

from src.routes.movies import (
    _animation_filter_sql,
    _BY_CEFR_SELECT,
    list_movies_by_cefr,
)


class _FakeDb:
    """Records the SQL text and bound params of each query_raw call."""

    def __init__(self):
        self.calls: list[tuple[str, tuple]] = []

    async def query_raw(self, sql, *params):
        self.calls.append((sql, params))
        return []


async def _call(**kwargs):
    """Run the handler with the defaults the mobile feed sends."""
    db = _FakeDb()
    opts = {
        "level": "A2",
        "genre": None,
        "animated": None,
        "limit": 10,
        "offset": 0,
        "sort": "rating",
        "order": "desc",
        "db": db,
        "current_user": None,
    }
    opts.update(kwargs)
    await list_movies_by_cefr(**opts)
    return db.calls[0]


# ── _animation_filter_sql (pure) ────────────────────────────────────────────
class TestAnimationFilterSql:
    def test_none_is_no_filter(self):
        # The default feed must be byte-identical to the pre-#114 statement.
        assert _animation_filter_sql(None) == ""

    def test_animation_uses_contains_not_equality(self):
        sql = _animation_filter_sql(True)
        assert "ILIKE '%Animation%'" in sql
        # An equality test would match only single-genre films.
        assert "genre =" not in sql

    def test_live_action_negates_the_same_contains_test(self):
        sql = _animation_filter_sql(False)
        assert "NOT (m.genre ILIKE '%Animation%')" in sql

    def test_unknown_genre_excluded_from_both_sides(self):
        # A film with no genre is neither animated nor confirmed live action,
        # so neither filtered view may claim it.
        assert "IS NOT NULL" in _animation_filter_sql(False)
        # The animation side excludes NULL by construction: NULL ILIKE ... is
        # NULL, which is not true, so the row never passes the WHERE clause.
        assert "IS NULL" not in _animation_filter_sql(True)


# ── the composed statement ──────────────────────────────────────────────────
@pytest.mark.asyncio
class TestByCefrAnimationParam:
    async def test_default_feed_has_no_genre_predicate(self):
        sql, params = await _call()
        assert "genre" not in sql
        # $1 lo, $2 hi, $3 limit, $4 offset, $5 user_id
        assert len(params) == 5
        assert params[2] == 11  # limit 10, over-fetched by one for has_more

    async def test_animation_only(self):
        sql, params = await _call(animated=True)
        assert "AND m.genre ILIKE '%Animation%'" in sql
        # Not the negated form — that is the live-action side.
        assert "NOT (m.genre ILIKE" not in sql
        assert len(params) == 5

    async def test_live_action_only(self):
        sql, params = await _call(animated=False)
        assert "AND NOT (m.genre ILIKE '%Animation%')" in sql
        assert "AND m.genre IS NOT NULL" in sql
        assert len(params) == 5

    async def test_placeholders_stay_in_step_with_params(self):
        # genre + animated together is the widest combination: the genre value
        # takes $3, pushing limit/offset/user to $4/$5/$6.
        sql, params = await _call(genre="Comedy", animated=True)
        assert len(params) == 6
        assert params[2] == "Comedy"
        assert "ILIKE '%' || $3 || '%'" in sql
        assert "LIMIT $4 OFFSET $5" in sql
        assert "$6::int IS NULL" in sql

        # Every placeholder the SQL references must exist in the params list,
        # and every param must be referenced — either direction is a bug.
        used = {int(n) for n in re.findall(r"\$(\d+)", sql)}
        assert used == set(range(1, len(params) + 1))

    async def test_filter_is_appended_to_the_shared_projection(self):
        # One statement serves all four combinations; a regression that forked
        # the query again would drift the projection between them.
        for animated in (None, True, False):
            sql, _ = await _call(animated=animated)
            assert sql.startswith(_BY_CEFR_SELECT)

    async def test_filter_composes_with_level_and_sort(self):
        sql, params = await _call(level="B1", animated=False, sort="popularity", order="asc")
        assert params[0] == 35 and params[1] == 44          # B1 score band
        assert "ORDER BY m.tmdb_vote_count ASC NULLS LAST" in sql
        assert "AND NOT (m.genre ILIKE '%Animation%')" in sql
