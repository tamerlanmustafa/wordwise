"""
Seeding the movie queue: where the walk stops, and what it can see.

Two faults, found 2026-09-05 by reading prod logs that said `auto-seeded 0
new jobs` on every restart while the catalogue sat unchanged at 4,546 jobs.

**The walk forgot where it was.** The page cursor lived in
`backend/.seed_cursor.json`, a file inside the worker container, on a service
with no volume. Railway redeploys the Worker on every push to main, so the
walk restarted at page 1 — whose films have all been queued for months — and
`_insert_jobs` deduped them to nothing. The catalogue could not grow, and the
log line said so every time without anybody reading it as a failure.

**It could not see new films at all.** The one query is `/discover` sorted by
`vote_count.desc` with `vote_count.gte=1000`: a *lifetime* popularity order.
A film released last month has single-digit votes, so it fails the floor
outright and stays invisible for the months it takes to cross it — which is
exactly the window when people are looking for it. Popularity does not stand
in for recency here; it actively excludes it.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from src.workers import seed as seed_mod


class _FakePool:
    """Enough of asyncpg for the cursor round trip."""

    def __init__(self, rows: dict[str, int] | None = None, fail: bool = False):
        self.rows = dict(rows or {})
        self.fail = fail
        self.writes: list[tuple[str, int]] = []

    async def fetchrow(self, sql, *args):
        if self.fail:
            raise RuntimeError("no database")
        key = args[0]
        return {"next_page": self.rows[key]} if key in self.rows else None

    async def execute(self, sql, *args):
        if self.fail:
            raise RuntimeError("no database")
        self.writes.append((args[0], args[1]))
        self.rows[args[0]] = args[1]


class TestCursorSurvivesADeploy:
    async def test_reads_the_page_the_last_run_reached(self):
        pool = _FakePool({"discover_en_vote_count_desc_gte1000": 37})

        assert await seed_mod._load_page(pool, "discover_en_vote_count_desc_gte1000") == 37

    async def test_a_walk_that_has_never_run_starts_at_page_one(self):
        assert await seed_mod._load_page(_FakePool(), "fresh") == 1

    async def test_writes_are_upserts_so_a_second_pass_moves_the_cursor(self):
        pool = _FakePool()

        await seed_mod._save_page(pool, "k", 2)
        await seed_mod._save_page(pool, "k", 3)

        assert await seed_mod._load_page(pool, "k") == 3

    async def test_a_page_below_one_cannot_be_read_back(self):
        # A corrupt row should restart the walk, not index backwards.
        assert await seed_mod._load_page(_FakePool({"k": 0}), "k") == 1

    async def test_a_broken_cursor_does_not_stop_the_seed(self):
        # Losing the cursor costs a re-walk of already-queued pages — wasted
        # TMDB calls and nothing worse. Refusing to seed would be worse.
        assert await seed_mod._load_page(_FakePool(fail=True), "k") == 1

    async def test_a_failed_write_is_swallowed(self):
        await seed_mod._save_page(_FakePool(fail=True), "k", 5)  # must not raise


class TestRecentReleasesAreReachable:
    """The filter that finds this month's films, which the other one cannot."""

    @pytest.fixture
    def captured(self, monkeypatch):
        calls: list[dict] = []

        class _Resp:
            def raise_for_status(self):
                pass

            def json(self):
                return {"results": []}

        class _Client:
            # `**kwargs` swallows httpx's `timeout=`; naming it would trip
            # ruff's ASYNC109, which is about real async APIs taking timeouts.
            async def get(self, url, params=None, **kwargs):
                calls.append({"url": url, **(params or {})})
                return _Resp()

        monkeypatch.setattr(seed_mod, "TMDB_API_KEY", "test-key")
        return calls, _Client()

    async def test_orders_by_popularity_not_lifetime_votes(self, captured):
        calls, client = captured

        await seed_mod._fetch_recent_page(client, 1, months=6)

        # popularity.desc reacts within days; vote_count.desc takes years, so
        # a new film would never reach the front of it.
        assert calls[0]["sort_by"] == "popularity.desc"

    async def test_bounds_by_release_date_rather_than_vote_count(self, captured):
        calls, client = captured

        await seed_mod._fetch_recent_page(client, 1, months=6)

        assert "primary_release_date.gte" in calls[0]
        assert "primary_release_date.lte" in calls[0]

    async def test_keeps_a_low_vote_floor_but_not_the_catalogue_one(self, captured):
        # Zero would queue every unreleased festival entry with a TMDB page
        # and no subtitles to fetch; 1000 is the floor that hid new films in
        # the first place.
        calls, client = captured

        await seed_mod._fetch_recent_page(client, 1, months=6)

        assert 0 < calls[0]["vote_count.gte"] < 1000

    async def test_a_longer_window_reaches_further_back(self, captured):
        calls, client = captured

        await seed_mod._fetch_recent_page(client, 1, months=1)
        await seed_mod._fetch_recent_page(client, 1, months=12)

        assert calls[1]["primary_release_date.gte"] < calls[0]["primary_release_date.gte"]

    async def test_still_english_only_like_the_rest_of_the_pipeline(self, captured):
        # The script fetcher only handles English subtitles.
        calls, client = captured

        await seed_mod._fetch_recent_page(client, 1, months=6)

        assert calls[0]["with_original_language"] == "en"


class TestRecentPassIsCheapToRepeat:
    """It runs on a timer, so a pass that finds nothing must cost almost nothing."""

    async def test_reads_the_front_pages_every_time_rather_than_walking(self, monkeypatch):
        # Deliberately not cursor-walked. This is a window on the present: the
        # first page of "popular films from the last six months" is different
        # today than last week, so the interesting rows are always at the
        # front and a cursor would walk away from them.
        pages: list[int] = []

        async def _fake_fetch(client, page, months):
            pages.append(page)
            return [{"id": 100 + page, "title": f"F{page}"}]

        inserted: list[int] = []

        async def _fake_insert(pool, movies, priority):
            inserted.append(priority)
            return 0  # everything already queued — the steady state

        monkeypatch.setattr(seed_mod, "_fetch_recent_page", _fake_fetch)
        monkeypatch.setattr(seed_mod, "_insert_jobs", _fake_insert)
        monkeypatch.setattr(seed_mod, "get_pool", _noop_pool)
        monkeypatch.setattr(seed_mod, "_ensure_unique_constraint", _noop_async)

        n = await seed_mod.seed_recent_releases(months=6, max_pages=3)

        assert pages == [1, 2, 3]
        assert n == 0

    async def test_a_failing_page_does_not_abort_the_pass(self, monkeypatch):
        async def _fake_fetch(client, page, months):
            if page == 2:
                raise RuntimeError("TMDB 503")
            return [{"id": page, "title": "ok"}]

        async def _fake_insert(pool, movies, priority):
            return len(movies)

        monkeypatch.setattr(seed_mod, "_fetch_recent_page", _fake_fetch)
        monkeypatch.setattr(seed_mod, "_insert_jobs", _fake_insert)
        monkeypatch.setattr(seed_mod, "get_pool", _noop_pool)
        monkeypatch.setattr(seed_mod, "_ensure_unique_constraint", _noop_async)

        assert await seed_mod.seed_recent_releases(months=6, max_pages=3) == 2

    async def test_queues_above_the_backlog_but_below_the_canon(self, monkeypatch):
        seen: list[int] = []

        async def _fake_fetch(client, page, months):
            return [{"id": 1, "title": "x"}] if page == 1 else []

        async def _fake_insert(pool, movies, priority):
            seen.append(priority)
            return 1

        monkeypatch.setattr(seed_mod, "_fetch_recent_page", _fake_fetch)
        monkeypatch.setattr(seed_mod, "_insert_jobs", _fake_insert)
        monkeypatch.setattr(seed_mod, "get_pool", _noop_pool)
        monkeypatch.setattr(seed_mod, "_ensure_unique_constraint", _noop_async)

        await seed_mod.seed_recent_releases(months=6, max_pages=2)

        # 0 = curated top 250, 2 = discover backlog. A film people are
        # searching for now goes before the long tail, after the canon.
        assert seen == [1]


async def _noop_pool():
    return SimpleNamespace()


async def _noop_async(*args, **kwargs):
    return None
