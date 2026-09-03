"""
`sort=recommended` on /movies/by-cefr — the rotating home shelf.

The three column sorts are near-static per level, so the top of a B1 shelf was
the same six films every day. `recommended` orders by md5(id, seed) instead: a
permutation that is fixed for a seed and unrelated between seeds.

Two halves to this file, and they are testing different things:

  - the SQL the handler *builds*, with a fake Prisma client (no database), for
    the composition rules — the seed must be a bound parameter, the quality
    floor must only appear when the pool can carry it, the ordering must be a
    hash of (id, seed);
  - the ordering itself, evaluated in Python against the same md5 expression
    Postgres computes, because "same seed → same order, different seed →
    different order, three pages contain each film exactly once" is a property
    of the *permutation*, and pinning it needs no server.

The pagination property is the one that fails silently in production: an
append that re-derived the seed would slice page 2 out of a different ordering
than page 1, so the user sees one film twice and never sees another.
"""
from __future__ import annotations

import hashlib
import re

import pytest

from src.routes.movies import (
    RECOMMENDED_ROTATION_SECONDS,
    _BY_CEFR_SELECT,
    _RECOMMENDED_TIER_SQL,
    current_seed,
    list_movies_by_cefr,
    next_rotation_at,
)


class _FakeDb:
    """Records the SQL text and bound params of each query_raw call."""

    def __init__(self, rows: list | None = None):
        self.calls: list[tuple[str, tuple]] = []
        self.rows = rows if rows is not None else []

    async def query_raw(self, sql, *params):
        self.calls.append((sql, params))
        return self.rows


async def _call(rows: list | None = None, **kwargs):
    """Run the handler with the defaults the mobile feed now sends."""
    db = _FakeDb(rows=rows)
    opts = {
        "level": "B1",
        "genre": None,
        "animated": None,
        "limit": 10,
        "offset": 0,
        "sort": "recommended",
        "order": "desc",
        "seed": None,
        "db": db,
        "current_user": None,
    }
    opts.update(kwargs)
    result = await list_movies_by_cefr(**opts)
    return db, result


def _page_call(db: _FakeDb) -> tuple[str, tuple]:
    """The one and only query this endpoint makes."""
    assert len(db.calls) == 1, f"expected a single query, got {len(db.calls)}"
    return db.calls[0]


def _tier(vote_count: int, vote_average: float) -> int:
    """Python mirror of `_RECOMMENDED_TIER_SQL`, for the ordering properties."""
    if vote_count >= 1000 and vote_average >= 7.0:
        return 0
    if vote_count >= 300 and vote_average >= 6.5:
        return 1
    if vote_count >= 100 and vote_average >= 6.0:
        return 2
    return 3


# ── The permutation itself ──────────────────────────────────────────────────
# Mirrors `md5(m.id::text || '-' || $n::text)` exactly. If the SQL expression
# is ever changed, the assertion below that the two agree will fail.
def _order(ids: list[int], seed: int) -> list[int]:
    return sorted(ids, key=lambda i: (hashlib.md5(f"{i}-{seed}".encode()).hexdigest(), i))


CATALOGUE = list(range(1, 61))


class TestPermutation:
    def test_same_seed_gives_the_same_order_twice(self):
        assert _order(CATALOGUE, 1000) == _order(CATALOGUE, 1000)

    def test_a_different_seed_moves_the_first_page(self):
        # If it did not, the rotation would be decorative: the shelf would look
        # identical six hours later and nothing would have been fixed.
        assert _order(CATALOGUE, 1000)[:10] != _order(CATALOGUE, 1001)[:10]

    def test_three_pages_at_one_seed_cover_the_set_exactly_once(self):
        full = _order(CATALOGUE, 1000)
        pages = [full[0:10], full[10:20], full[20:30]]
        seen = [movie for page in pages for movie in page]

        assert len(seen) == len(set(seen)), "a film appeared on two pages"
        assert seen == full[:30], "a film was skipped between pages"

    def test_re_deriving_the_seed_mid_scroll_duplicates_and_skips(self):
        # The failure this whole seed mechanism exists to prevent, written out
        # so the next reader can see what "silently corrupts the feed" means.
        page1 = _order(CATALOGUE, 1000)[0:10]
        page2_wrong = _order(CATALOGUE, 1001)[10:20]  # append that re-drew

        assert set(page1) & set(page2_wrong), "expected duplicates across draws"
        assert set(page1) | set(page2_wrong) != set(_order(CATALOGUE, 1000)[:20])

    def test_the_tiebreaker_keeps_it_total(self):
        # md5 collisions are not a practical worry, but `m.id ASC` is what
        # makes the ordering total rather than merely near-total — the same
        # reason the column sorts carry it.
        assert len(set(_order(CATALOGUE, 7))) == len(CATALOGUE)


# ── Rotation clock ──────────────────────────────────────────────────────────
class TestRotationClock:
    def test_the_window_is_six_hours(self):
        assert RECOMMENDED_ROTATION_SECONDS == 6 * 3600

    def test_the_seed_is_derived_not_stored(self):
        # No table, no cron, no per-user row: two processes in the same window
        # compute the same integer, which is what makes this free to operate.
        assert current_seed() == current_seed()
        assert isinstance(current_seed(), int)

    def test_next_rotation_is_the_end_of_that_seed_s_window(self):
        from datetime import datetime, timezone

        seed = 100_000
        parsed = datetime.fromisoformat(next_rotation_at(seed))
        assert parsed.tzinfo is not None
        assert parsed == datetime.fromtimestamp(
            (seed + 1) * RECOMMENDED_ROTATION_SECONDS, tz=timezone.utc
        )

    def test_consecutive_seeds_are_exactly_one_window_apart(self):
        from datetime import datetime

        a = datetime.fromisoformat(next_rotation_at(100_000))
        b = datetime.fromisoformat(next_rotation_at(100_001))
        assert (b - a).total_seconds() == RECOMMENDED_ROTATION_SECONDS


# ── The composed statement ──────────────────────────────────────────────────
@pytest.mark.asyncio
class TestRecommendedSql:
    async def test_orders_by_a_hash_of_id_and_seed(self):
        db, _ = await _call(seed=4242)
        sql, params = _page_call(db)
        order = sql.partition("ORDER BY")[2].partition("LIMIT")[0]
        assert "md5(m.id::text || '-' || $" in order
        # `m.id ASC` last: the tiebreaker that makes the ordering total.
        assert order.rstrip().endswith("m.id ASC")
        # Bound, never interpolated — `seed` comes straight off the query
        # string, and the whole point of the whitelist on CEFR_SORT_COLUMNS is
        # that nothing caller-controlled reaches the SQL text.
        assert "4242" not in sql
        assert "4242" in params

    async def test_the_seed_is_echoed_so_the_client_can_page_the_same_draw(self):
        _, result = await _call(seed=4242)
        assert result["seed"] == 4242
        assert result["next_rotation_at"] == next_rotation_at(4242)

    async def test_omitting_the_seed_picks_the_current_window(self):
        _, result = await _call(seed=None)
        assert result["seed"] == current_seed()

    async def test_the_column_sorts_carry_no_draw(self):
        # Null rather than a fabricated seed: rating is not a draw, has nothing
        # to page consistently through, and nothing to expire.
        _, result = await _call(sort="rating")
        assert result["seed"] is None
        assert result["next_rotation_at"] is None

        db, _ = await _call(sort="rating")
        sql, _params = _page_call(db)
        assert "md5(" not in sql
        assert "ORDER BY m.tmdb_vote_average DESC NULLS LAST" in sql

    async def test_recommended_is_not_a_column(self):
        # It must not be smuggled into CEFR_SORT_COLUMNS to make a lookup
        # succeed — that is how a whitelist stops being one.
        from src.routes.movies import CEFR_SORT_COLUMNS

        assert "recommended" not in CEFR_SORT_COLUMNS

    async def test_an_unknown_sort_is_still_rejected(self):
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc:
            await _call(sort="random")
        assert exc.value.status_code == 400

    async def test_it_reuses_the_shared_projection(self):
        db, _ = await _call()
        sql, _params = _page_call(db)
        assert sql.startswith(_BY_CEFR_SELECT)

    async def test_placeholders_stay_in_step_with_params(self):
        # The seed adds a placeholder between the filters and LIMIT/OFFSET, so
        # this is exactly where an off-by-one would bind the offset to a hash.
        db, _ = await _call(genre="Comedy", animated=True, seed=9)
        sql, params = _page_call(db)
        used = {int(n) for n in re.findall(r"\$(\d+)", sql)}
        assert used == set(range(1, len(params) + 1))

    async def test_the_caller_s_swipes_are_still_subtracted(self):
        # A rotation must never re-serve a film the user swiped away.
        db, _ = await _call()
        sql, _params = _page_call(db)
        assert "user_watched_movies" in sql
        assert "user_hidden_movies" in sql

    async def test_each_film_carries_the_band_the_server_put_it_in(self):
        # The card prints this beside the year. Without it the client bands
        # `difficulty_score` with its own copy of the boundaries, and the two
        # drift the moment either side is recalibrated — a B1 shelf showing
        # cards labelled B2. That is the #103 bug across the API boundary,
        # which is the one place a shared constant cannot reach.
        rows = [
            {
                "movie_id": 1, "tmdb_id": 11, "title": "Tenet", "year": 2020,
                "poster_url": None, "description": None,
                "backdrop_corner_rgb": None, "difficulty_score": 58,
                "vote_average": 7.3, "vote_count": 9000,
                "unique_words": 1500, "cefr_distribution": None,
            }
        ]
        _db, result = await _call(rows=rows, level="C2", seed=1)
        assert result["movies"][0]["cefr_level"] == "C2"

    async def test_an_unscored_film_reports_no_band_rather_than_a_guess(self):
        rows = [
            {
                "movie_id": 2, "tmdb_id": 12, "title": "Unprocessed", "year": 1999,
                "poster_url": None, "description": None,
                "backdrop_corner_rgb": None, "difficulty_score": None,
                "vote_average": 6.0, "vote_count": 100,
                "unique_words": None, "cefr_distribution": None,
            }
        ]
        _db, result = await _call(rows=rows)
        assert result["movies"][0]["cefr_level"] is None

    async def test_no_cache_header_is_added(self):
        # /by-cefr is deliberately excluded from HTTP caching (#123): it
        # subtracts the caller's watched/hidden films, so a shared cache would
        # hand one learner's feed to the next.
        _, result = await _call()
        assert "cache" not in " ".join(result.keys()).lower()


# ── Quality as a sort key, not a filter ─────────────────────────────────────
# The first cut of this was a WHERE clause (`vote_count >= 200 AND
# vote_average >= 6.0`) plus a COUNT query per request to decide whether the
# level could survive it. Tiering does the same job — good films first — with
# no predicate that can empty a shelf and no second round trip to guard it.
@pytest.mark.asyncio
class TestQualityTier:
    async def test_quality_is_in_the_order_by_not_the_where(self):
        db, _ = await _call()
        sql, _params = _page_call(db)
        head, _, tail = sql.partition("ORDER BY")

        # The tier decides position...
        assert _RECOMMENDED_TIER_SQL in tail
        assert "tmdb_vote_average, 0) >= 7.0" in tail
        # ...and nothing about it narrows the result set.
        assert ">= 7.0" not in head
        assert ">= 1000" not in head

    async def test_no_film_is_excluded_for_being_unpopular(self):
        # The property that matters: Recommended can never return fewer films
        # than Top rated at the same level, because it filters nothing extra.
        rec_sql, _ = _page_call((await _call())[0])
        rated_sql, _ = _page_call((await _call(sort="rating"))[0])

        # Placeholder *numbers* legitimately differ — recommended binds a seed,
        # which pushes the user id along by one — so compare the predicates,
        # not the numbering.
        def predicates(sql: str) -> str:
            return re.sub(r"\$\d+", "$N", sql.partition("ORDER BY")[0])

        assert predicates(rec_sql) == predicates(rated_sql)

    async def test_the_shared_vote_floor_is_untouched(self):
        # `vote_count >= 50` is the catalogue-wide floor every sort has always
        # had; tiering replaces the *extra* one, not this.
        db, _ = await _call()
        sql, _params = _page_call(db)
        assert "COALESCE(m.tmdb_vote_count, 0) >= 50" in sql

    async def test_tier_is_ordered_before_the_shuffle(self):
        # Reverse them and the tier stops mattering: a hash sorts first and the
        # tier only breaks its (nonexistent) ties.
        db, _ = await _call()
        sql, _params = _page_call(db)
        order = sql.partition("ORDER BY")[2]
        assert order.index("CASE") < order.index("md5(")

    async def test_it_makes_exactly_one_query(self):
        # The COUNT round trip is gone — for every sort, not just the columns.
        for sort in ("recommended", "rating", "popularity", "level"):
            db, _ = await _call(sort=sort)
            assert len(db.calls) == 1, sort

    async def test_a_thin_level_still_returns_its_films(self):
        # C2 has SIX films in prod (2026-09-03). Under a hard floor that shelf
        # depended on a fallback branch being right; under tiering there is no
        # branch — the films are simply ordered.
        rows = [
            {
                "movie_id": 1,
                "tmdb_id": 11,
                "title": "Thin shelf film",
                "year": 1972,
                "poster_url": None,
                "description": None,
                "backdrop_corner_rgb": None,
                "difficulty_score": 90,
                "vote_average": 5.1,
                "vote_count": 60,
                "unique_words": 900,
                "cefr_distribution": None,
            }
        ]
        _db, result = await _call(rows=rows, level="C2", seed=5)
        assert [m["title"] for m in result["movies"]] == ["Thin shelf film"]


class TestTierOrdering:
    """The tier's effect on the shelf, evaluated in Python against the same
    thresholds the SQL uses."""

    # A shelf shaped like a real level: a deep top tier and a long tail.
    CATALOGUE = [
        *[(i, 5000, 7.8) for i in range(1, 41)],    # tier 0
        *[(i, 500, 6.8) for i in range(41, 61)],    # tier 1
        *[(i, 150, 6.2) for i in range(61, 81)],    # tier 2
        *[(i, 60, 5.0) for i in range(81, 101)],    # tier 3
    ]

    def _order(self, seed: int) -> list[int]:
        return [
            m[0]
            for m in sorted(
                self.CATALOGUE,
                key=lambda m: (
                    _tier(m[1], m[2]),
                    hashlib.md5(f"{m[0]}-{seed}".encode()).hexdigest(),
                    m[0],
                ),
            )
        ]

    def test_the_first_page_is_all_top_tier(self):
        by_id = {m[0]: m for m in self.CATALOGUE}
        first_page = self._order(1000)[:10]
        assert all(_tier(by_id[i][1], by_id[i][2]) == 0 for i in first_page)

    def test_the_shelf_quality_is_identical_across_rotations(self):
        # This is what "the change doesn't have to be dramatic" buys: the
        # rotation changes *which* good films you see, never how good they are.
        by_id = {m[0]: m for m in self.CATALOGUE}
        tiers = [
            [_tier(by_id[i][1], by_id[i][2]) for i in self._order(s)[:10]]
            for s in (1000, 1001, 1002)
        ]
        assert tiers[0] == tiers[1] == tiers[2]

    def test_but_the_titles_do_rotate(self):
        # A tiered order that never changed would just be "top rated" again.
        assert self._order(1000)[:10] != self._order(1001)[:10]

    def test_the_tail_is_still_reachable(self):
        # Ordered last, not dropped: page 9 of a C2-sized shelf is the only
        # place some films exist at all.
        assert set(self._order(1000)) == {m[0] for m in self.CATALOGUE}
