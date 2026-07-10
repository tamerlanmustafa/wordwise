"""
Home-feed swipe actions — /movies/watched + /movies/hidden and the /by-cefr
exclusion fragment.

Pure-unit: the Prisma client is faked (a call recorder), so these run without a
database. Covers the handler contracts:
  - swipe right (mark_watched) clears any prior "hidden" row, then upserts watched
  - undo (unmark_watched / unhide_movie) is idempotent delete_many, never a 404
  - swipe left (hide_movie) creates once, no-ops when already hidden
  - list_watched maps rows most-recent-first
  - _exclude_seen_sql threads the user-id placeholder through both tables and
    no-ops when it's NULL (anonymous feed)
"""
from __future__ import annotations

from types import SimpleNamespace

from src.routes.movies import (
    _exclude_seen_sql,
    hide_movie,
    list_hidden,
    list_watched,
    mark_watched,
    unhide_movie,
    unmark_watched,
    HideMovieRequest,
    WatchedMovieRequest,
)


class _Table:
    """Fake Prisma model delegate: records calls, returns configured reads."""

    def __init__(self, log, name, *, find_unique_result=None,
                 find_many_result=None, upsert_result=None):
        self._log = log
        self._name = name
        self._find_unique_result = find_unique_result
        self._find_many_result = find_many_result
        self._upsert_result = upsert_result

    async def delete_many(self, **kwargs):
        self._log.append((f"{self._name}.delete_many", kwargs))

    async def create(self, **kwargs):
        self._log.append((f"{self._name}.create", kwargs))

    async def upsert(self, **kwargs):
        self._log.append((f"{self._name}.upsert", kwargs))
        return self._upsert_result

    async def find_unique(self, **kwargs):
        self._log.append((f"{self._name}.find_unique", kwargs))
        return self._find_unique_result

    async def find_many(self, **kwargs):
        self._log.append((f"{self._name}.find_many", kwargs))
        return self._find_many_result or []


class _FakeDb:
    def __init__(self, log, *, watched=None, hidden=None):
        self.userwatchedmovie = watched or _Table(log, "userwatchedmovie")
        self.userhiddenmovie = hidden or _Table(log, "userhiddenmovie")


# ── _exclude_seen_sql (pure) ────────────────────────────────────────────────
class TestExcludeSeenSql:
    def test_threads_placeholder_through_both_tables(self):
        sql = _exclude_seen_sql("$6")
        assert "user_watched_movies" in sql
        assert "user_hidden_movies" in sql
        # NULL guard + one comparison per table = three uses of the placeholder.
        assert sql.count("$6") == 3

    def test_null_placeholder_short_circuits(self):
        # Anonymous callers pass NULL; the guard makes the whole clause a no-op.
        assert "$5::int IS NULL" in _exclude_seen_sql("$5")


# ── mark_watched (swipe right) ──────────────────────────────────────────────
async def test_mark_watched_clears_hidden_then_upserts(test_user):
    log = []
    row = SimpleNamespace(tmdbId=27205, title="Inception", posterPath="/p.jpg", year=2010)
    db = _FakeDb(
        log,
        watched=_Table(log, "userwatchedmovie", upsert_result=row),
        hidden=_Table(log, "userhiddenmovie"),
    )
    body = WatchedMovieRequest(tmdb_id=27205, title="Inception", poster_path="/p.jpg", year=2010)

    result = await mark_watched(body=body, db=db, user=test_user)

    assert [n for n, _ in log] == ["userhiddenmovie.delete_many", "userwatchedmovie.upsert"]
    assert log[0][1] == {"where": {"userId": test_user.id, "tmdbId": 27205}}
    assert result.tmdb_id == 27205
    assert result.title == "Inception"


async def test_unmark_watched_is_idempotent_delete(test_user):
    log = []
    await unmark_watched(tmdb_id=27205, db=_FakeDb(log), user=test_user)
    assert log == [
        ("userwatchedmovie.delete_many", {"where": {"userId": test_user.id, "tmdbId": 27205}}),
    ]


# ── hide_movie (swipe left) ─────────────────────────────────────────────────
async def test_hide_movie_creates_when_absent(test_user):
    log = []
    db = _FakeDb(log, hidden=_Table(log, "userhiddenmovie", find_unique_result=None))
    await hide_movie(body=HideMovieRequest(tmdb_id=99), db=db, user=test_user)
    assert [n for n, _ in log] == ["userhiddenmovie.find_unique", "userhiddenmovie.create"]
    assert log[1][1] == {"data": {"userId": test_user.id, "tmdbId": 99}}


async def test_hide_movie_noops_when_already_hidden(test_user):
    log = []
    existing = SimpleNamespace(userId=test_user.id, tmdbId=99)
    db = _FakeDb(log, hidden=_Table(log, "userhiddenmovie", find_unique_result=existing))
    await hide_movie(body=HideMovieRequest(tmdb_id=99), db=db, user=test_user)
    assert [n for n, _ in log] == ["userhiddenmovie.find_unique"]  # no create


async def test_unhide_movie_is_idempotent_delete(test_user):
    log = []
    await unhide_movie(tmdb_id=99, db=_FakeDb(log), user=test_user)
    assert log == [
        ("userhiddenmovie.delete_many", {"where": {"userId": test_user.id, "tmdbId": 99}}),
    ]


async def test_list_hidden_returns_ids(test_user):
    log = []
    rows = [SimpleNamespace(tmdbId=5), SimpleNamespace(tmdbId=7)]
    db = _FakeDb(log, hidden=_Table(log, "userhiddenmovie", find_many_result=rows))
    resp = await list_hidden(db=db, user=test_user)
    assert resp.tmdb_ids == [5, 7]


# ── list_watched ────────────────────────────────────────────────────────────
async def test_list_watched_maps_rows_most_recent_first(test_user):
    log = []
    rows = [
        SimpleNamespace(tmdbId=1, title="A", posterPath="/a.jpg", year=2001),
        SimpleNamespace(tmdbId=2, title="B", posterPath=None, year=None),
    ]
    db = _FakeDb(log, watched=_Table(log, "userwatchedmovie", find_many_result=rows))

    resp = await list_watched(db=db, user=test_user)

    assert [m.tmdb_id for m in resp.movies] == [1, 2]
    assert resp.movies[0].title == "A"
    assert resp.movies[1].poster_path is None
    assert log[0][1]["order"] == {"watchedAt": "desc"}
