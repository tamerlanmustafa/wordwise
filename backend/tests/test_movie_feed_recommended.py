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
    RECOMMENDED_MIN_POOL,
    RECOMMENDED_ROTATION_SECONDS,
    _BY_CEFR_SELECT,
    _RECOMMENDED_POOL_COUNT,
    current_seed,
    list_movies_by_cefr,
    next_rotation_at,
)


class _FakeDb:
    """Records each query_raw call. `pool` is what the count query answers."""

    def __init__(self, pool: int = 500):
        self.calls: list[tuple[str, tuple]] = []
        self.pool = pool

    async def query_raw(self, sql, *params):
        self.calls.append((sql, params))
        if "COUNT(*) AS n" in sql:
            return [{"n": self.pool}]
        return []


async def _call(pool: int = 500, **kwargs):
    """Run the handler with the defaults the mobile feed now sends."""
    db = _FakeDb(pool=pool)
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
    """The row query, i.e. everything that is not the pool count."""
    return [c for c in db.calls if "COUNT(*) AS n" not in c[0]][0]


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
        assert "ORDER BY md5(m.id::text || '-' || $" in sql
        assert "m.id ASC" in sql
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

    async def test_no_cache_header_is_added(self):
        # /by-cefr is deliberately excluded from HTTP caching (#123): it
        # subtracts the caller's watched/hidden films, so a shared cache would
        # hand one learner's feed to the next.
        _, result = await _call()
        assert "cache" not in " ".join(result.keys()).lower()


# ── The quality floor ───────────────────────────────────────────────────────
@pytest.mark.asyncio
class TestQualityFloor:
    async def test_a_deep_shelf_gets_the_floor(self):
        db, _ = await _call(pool=RECOMMENDED_MIN_POOL + 1)
        sql, _params = _page_call(db)
        assert "COALESCE(m.tmdb_vote_count, 0) >= 200" in sql
        assert "COALESCE(m.tmdb_vote_average, 0) >= 6.0" in sql

    async def test_a_thin_shelf_drops_back_to_the_base_predicates(self):
        # A1 and C2 are the thin shelves. Recommended being *emptier* than Top
        # rated is a worse outcome than a couple of obscure films in the deck.
        db, _ = await _call(pool=RECOMMENDED_MIN_POOL - 1)
        sql, _params = _page_call(db)
        assert ">= 200" not in sql
        # The shared floor is still there — this only drops the extra one.
        assert "COALESCE(m.tmdb_vote_count, 0) >= 50" in sql

    async def test_a_thin_shelf_still_returns_rows(self):
        db = _FakeDb(pool=0)

        async def query_raw(sql, *params):
            db.calls.append((sql, params))
            if "COUNT(*) AS n" in sql:
                return [{"n": 0}]
            return [
                {
                    "movie_id": 1,
                    "tmdb_id": 11,
                    "title": "Thin shelf film",
                    "year": 1972,
                    "poster_url": None,
                    "description": None,
                    "backdrop_corner_rgb": None,
                    "difficulty_score": 40,
                    "vote_average": 5.1,
                    "vote_count": 60,
                    "unique_words": 900,
                    "cefr_distribution": None,
                }
            ]

        db.query_raw = query_raw  # type: ignore[method-assign]
        result = await list_movies_by_cefr(
            level="A1",
            genre=None,
            animated=None,
            limit=10,
            offset=0,
            sort="recommended",
            order="desc",
            seed=5,
            db=db,
            current_user=None,
        )
        assert [m["title"] for m in result["movies"]] == ["Thin shelf film"]

    async def test_the_pool_is_counted_with_the_same_predicates_as_the_page(self):
        # A count that measured a different shelf would apply the floor to a
        # pool the page never sees — and would flip on and off between pages.
        db, _ = await _call(genre="Comedy", animated=True)
        count_sql, count_params = [c for c in db.calls if "COUNT(*) AS n" in c[0]][0]
        page_sql, _page_params = _page_call(db)

        assert count_sql.startswith(_RECOMMENDED_POOL_COUNT)
        for fragment in (
            "m.genre ILIKE",
            "AND m.genre ILIKE '%Animation%'",
            "user_watched_movies",
        ):
            assert fragment in count_sql and fragment in page_sql
        used = {int(n) for n in re.findall(r"\$(\d+)", count_sql)}
        assert used == set(range(1, len(count_params) + 1))

    async def test_the_count_skips_the_expensive_projection(self):
        # unique_words / cefr_distribution are correlated subqueries over
        # word_classifications — the costly half of the row query, and a COUNT
        # needs neither.
        db, _ = await _call()
        count_sql, _ = [c for c in db.calls if "COUNT(*) AS n" in c[0]][0]
        assert "word_classifications" not in count_sql

    async def test_the_column_sorts_do_not_pay_for_the_count(self):
        db, _ = await _call(sort="popularity")
        assert not [c for c in db.calls if "COUNT(*) AS n" in c[0]]
        assert len(db.calls) == 1
