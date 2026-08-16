"""
Adapter-dispatch tests for src/services/lists.py.

The two pinned lists are adapters, not storage: their `user_lists` row exists
so the index can render them, but their members live in `user_reel_movies`
and `user_words`. `list.id` therefore does not tell you where the rows are,
and getting that wrong reads or writes the wrong table *silently* — the
operation succeeds, it just touches nothing the user can see. These tests pin
the dispatch by recording which table each call goes to.

No database: the suite has none (tests/conftest.py). `FakeDb` records the SQL
and model calls instead, which also lets us assert the index's query budget.
"""
from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from src.services import lists as svc
from src.services.lists import ListError

NOW = datetime(2026, 8, 16, 12, 0, tzinfo=timezone.utc)


# ── Fake Prisma ────────────────────────────────────────────────────────────

class FakeModel:
    """One Prisma model delegate. `returns` maps a method name to the value
    it should hand back; every call is appended to the shared log."""

    def __init__(self, name: str, log: list, returns: dict):
        self._name = name
        self._log = log
        self._returns = returns

    def __getattr__(self, method):
        async def call(**kwargs):
            self._log.append((f"{self._name}.{method}", kwargs))
            value = self._returns.get(f"{self._name}.{method}")
            if callable(value):
                return value(**kwargs)
            if value is not None:
                return value
            return [] if method.startswith("find_many") else None
        return call


class FakeDb:
    def __init__(self, returns: dict | None = None):
        self.log: list = []
        self.sql: list[str] = []
        self._returns = returns or {}

    def __getattr__(self, model):
        return FakeModel(model, self.log, self._returns)

    async def query_raw(self, sql, *params):
        self.sql.append(sql)
        self.log.append(("query_raw", sql))
        # `query_raw` serves several different shapes (membership counts,
        # vocabulary totals, name-clash probes), so returns may be keyed by a
        # fragment of the SQL to disambiguate. Fragments must be unique to one
        # query — the totals query embeds `FROM user_list_films` in its CTE,
        # so that substring alone would also match the count query.
        for key, value in self._returns.items():
            if key.startswith("sql:") and key[4:] in sql:
                return value
        value = self._returns.get("query_raw")
        return value(sql, *params) if callable(value) else (value or [])

    async def execute_raw(self, sql, *params):
        self.sql.append(sql)
        self.log.append(("execute_raw", sql))
        return 1

    def sql_touching(self, table: str) -> list[str]:
        return [s for s in self.sql if table in s]

    def called(self, name: str) -> list[dict]:
        return [kw for n, kw in self.log if n == name and isinstance(kw, dict)]


def row(**kw):
    base = dict(
        id=1, userId=7, name="My list", kind="films",
        systemKey=None, position=0, createdAt=NOW, updatedAt=NOW,
    )
    base.update(kw)
    return SimpleNamespace(**base)


def db_with_list(listrow, **extra):
    """A FakeDb whose ownership lookup resolves to `listrow`."""
    returns = {"userlist.find_first": listrow}
    returns.update(extra)
    return FakeDb(returns)


REEL = row(id=10, kind="films", systemKey="reel", name="Saved from Home")
FAVS = row(id=11, kind="words", systemKey="favourites", name="Favourites")
CUSTOM_FILMS = row(id=20, kind="films", systemKey=None, name="Film noir")
CUSTOM_WORDS = row(id=21, kind="words", systemKey=None, name="From the news")


# ── Ownership ──────────────────────────────────────────────────────────────

class TestOwnership:
    """Another user's list id must be 404, never 403 — a 403 confirms the id
    exists, which leaks the existence of other users' lists."""

    async def test_missing_list_is_404_not_403(self):
        db = FakeDb({"userlist.find_first": None})
        with pytest.raises(ListError) as e:
            await svc.get_list_row(db, user_id=7, list_id=999)
        assert e.value.status == 404
        assert e.value.code == "list_not_found"

    async def test_lookup_is_scoped_to_the_calling_user(self):
        db = FakeDb({"userlist.find_first": None})
        with pytest.raises(ListError):
            await svc.get_list_row(db, user_id=7, list_id=999)
        where = db.called("userlist.find_first")[0]["where"]
        assert where == {"id": 999, "userId": 7}

    @pytest.mark.parametrize("op", ["rename", "delete", "add", "remove"])
    async def test_every_mutation_checks_ownership(self, op):
        db = FakeDb({"userlist.find_first": None})
        with pytest.raises(ListError) as e:
            if op == "rename":
                await svc.rename_list(db, 7, 999, "x")
            elif op == "delete":
                await svc.delete_list(db, 7, 999)
            elif op == "add":
                await svc.add_items(db, 7, 999, films=[{"tmdb_id": 1, "title": "x"}])
            else:
                await svc.remove_item(db, 7, 999, 1)
        assert e.value.status == 404


# ── Pinned-list guards ─────────────────────────────────────────────────────

class TestSystemListGuards:
    @pytest.mark.parametrize("listrow", [REEL, FAVS])
    async def test_cannot_be_renamed(self, listrow):
        db = db_with_list(listrow)
        with pytest.raises(ListError) as e:
            await svc.rename_list(db, 7, listrow.id, "New name")
        assert e.value.code == "system_list"
        assert e.value.status == 409

    @pytest.mark.parametrize("listrow", [REEL, FAVS])
    async def test_cannot_be_deleted(self, listrow):
        db = db_with_list(listrow)
        with pytest.raises(ListError) as e:
            await svc.delete_list(db, 7, listrow.id)
        assert e.value.code == "system_list"
        assert e.value.status == 409

    async def test_rename_does_not_reach_the_database(self):
        db = db_with_list(REEL)
        with pytest.raises(ListError):
            await svc.rename_list(db, 7, REEL.id, "New name")
        assert db.called("userlist.update") == []

    async def test_a_custom_list_can_be_deleted(self):
        db = db_with_list(CUSTOM_FILMS)
        await svc.delete_list(db, 7, CUSTOM_FILMS.id)
        assert db.called("userlist.delete") == [{"where": {"id": CUSTOM_FILMS.id}}]


# ── Kind immutability ──────────────────────────────────────────────────────

class TestKindMismatch:
    async def test_words_into_a_films_list_is_409(self):
        db = db_with_list(CUSTOM_FILMS)
        with pytest.raises(ListError) as e:
            await svc.add_items(db, 7, CUSTOM_FILMS.id, words=[{"word": "reluctant"}])
        assert e.value.code == "list_kind_mismatch"
        assert e.value.status == 409

    async def test_films_into_a_words_list_is_409(self):
        db = db_with_list(CUSTOM_WORDS)
        with pytest.raises(ListError) as e:
            await svc.add_items(
                db, 7, CUSTOM_WORDS.id, films=[{"tmdb_id": 238, "title": "The Godfather"}],
            )
        assert e.value.code == "list_kind_mismatch"

    async def test_mismatch_is_rejected_before_any_write(self):
        db = db_with_list(CUSTOM_FILMS)
        with pytest.raises(ListError):
            await svc.add_items(db, 7, CUSTOM_FILMS.id, words=[{"word": "reluctant"}])
        assert db.sql_touching("INSERT") == []


# ── The reel adapter ───────────────────────────────────────────────────────

class TestReelAdapter:
    """`Saved from Home` keeps its members in user_reel_movies, so the Home +
    button, PosterFlight and /reel/* keep working untouched."""

    async def test_add_writes_to_user_reel_movies(self):
        db = db_with_list(REEL)
        await svc.add_items(
            db, 7, REEL.id,
            films=[{"tmdb_id": 238, "title": "The Godfather",
                    "poster_path": "/g.jpg", "year": 1972}],
        )
        assert db.sql_touching("INSERT INTO user_reel_movies")
        assert not db.sql_touching("INSERT INTO user_list_films")

    async def test_add_is_idempotent(self):
        # §2.4 — the client retries on a dropped response, so a re-add must
        # be a no-op rather than a duplicate or an error.
        db = db_with_list(REEL)
        await svc.add_items(db, 7, REEL.id, films=[{"tmdb_id": 238, "title": "x"}])
        insert = db.sql_touching("INSERT INTO user_reel_movies")[0]
        assert "ON CONFLICT (user_id, tmdb_id) DO NOTHING" in insert

    async def test_remove_deletes_the_reel_row(self):
        db = db_with_list(REEL)
        await svc.remove_item(db, 7, REEL.id, 238)
        deletes = db.called("userreelmovie.delete_many")
        assert deletes == [{"where": {"userId": 7, "tmdbId": 238}}]

    async def test_remove_repacks_positions(self):
        # ux_user_reel_movies_user_position is unique, so a gap left by a
        # delete would collide with the next insert at that position.
        db = db_with_list(REEL, **{
            "userreelmovie.find_many": [
                SimpleNamespace(tmdbId=1, position=0),
                SimpleNamespace(tmdbId=2, position=3),
            ],
        })
        await svc.remove_item(db, 7, REEL.id, 238)
        updates = db.called("userreelmovie.update")
        assert len(updates) == 1
        assert updates[0]["data"] == {"position": 1}

    async def test_custom_film_list_does_not_touch_the_reel(self):
        db = db_with_list(CUSTOM_FILMS)
        await svc.add_items(db, 7, CUSTOM_FILMS.id, films=[{"tmdb_id": 1, "title": "x"}])
        assert db.sql_touching("INSERT INTO user_list_films")
        assert not db.sql_touching("user_reel_movies")


# ── The favourites adapter ─────────────────────────────────────────────────

class TestFavouritesAdapter:
    """`Favourites` has no rows of its own: a favourite IS the global
    user_words row the Explore heart already writes."""

    async def test_add_writes_a_global_user_words_row(self):
        db = db_with_list(FAVS)
        await svc.add_items(db, 7, FAVS.id, words=[{"word": "Reluctant"}])
        created = db.called("userword.create")
        assert created == [{"data": {"userId": 7, "word": "reluctant", "isLearned": False}}]
        assert not db.sql_touching("INSERT INTO user_list_words")

    async def test_add_lowercases_the_word(self):
        # user_words keys on the lowercased form; a mixed-case insert would
        # create a second row the Explore heart could never toggle off.
        db = db_with_list(FAVS)
        await svc.add_items(db, 7, FAVS.id, words=[{"word": "RELUCTANT"}])
        assert db.called("userword.create")[0]["data"]["word"] == "reluctant"

    async def test_add_checks_for_an_existing_row_first(self):
        # Find-then-create, not ON CONFLICT: the only backstop on global rows
        # is a PARTIAL unique index that lives in manual SQL, so an
        # environment that has not replayed those files does not have it and
        # naming it as a conflict target fails outright.
        db = db_with_list(FAVS)
        await svc.add_items(db, 7, FAVS.id, words=[{"word": "reluctant"}])
        assert db.called("userword.find_first") == [
            {"where": {"userId": 7, "word": "reluctant", "movieId": None}}
        ]

    async def test_add_is_idempotent_when_the_row_already_exists(self):
        db = db_with_list(FAVS, **{
            "userword.find_first": SimpleNamespace(id=1, word="reluctant"),
        })
        await svc.add_items(db, 7, FAVS.id, words=[{"word": "reluctant"}])
        assert db.called("userword.create") == []

    async def test_add_never_names_the_partial_index_as_a_conflict_target(self):
        db = db_with_list(FAVS)
        await svc.add_items(db, 7, FAVS.id, words=[{"word": "reluctant"}])
        for sql in db.sql_touching("user_words"):
            assert "ON CONFLICT" not in sql

    async def test_remove_deletes_only_the_global_row(self):
        # Per-movie saved rows are a different thing from the heart, and
        # unhearting must not clear them.
        db = db_with_list(FAVS)
        await svc.remove_item(db, 7, FAVS.id, "Reluctant")
        assert db.called("userword.delete_many") == [
            {"where": {"userId": 7, "word": "reluctant", "movieId": None}}
        ]

    async def test_custom_word_list_does_not_touch_user_words(self):
        db = db_with_list(CUSTOM_WORDS)
        await svc.add_items(db, 7, CUSTOM_WORDS.id, words=[{"word": "glimpse"}])
        assert db.sql_touching("INSERT INTO user_list_words")
        assert not db.sql_touching("INSERT INTO user_words")

    async def test_custom_word_remove_leaves_srs_state_alone(self):
        db = db_with_list(CUSTOM_WORDS)
        await svc.remove_item(db, 7, CUSTOM_WORDS.id, "glimpse")
        assert db.called("userword.delete_many") == []
        assert db.called("userlistword.delete_many") == [
            {"where": {"listId": CUSTOM_WORDS.id, "word": "glimpse"}}
        ]


# ── Reads through the adapters ─────────────────────────────────────────────

class TestAdapterReads:
    async def test_favourites_words_exclude_learned_markers(self):
        # /mark-learned writes a global row with is_learned=true meaning
        # "never show me this again". Those share the favourites row shape,
        # so without this filter the tab would fill with dismissed words.
        db = FakeDb({"userword.find_many": [SimpleNamespace(word="Reluctant")]})
        words = await svc.list_words(db, 7, FAVS)
        where = db.called("userword.find_many")[0]["where"]
        assert where == {"userId": 7, "movieId": None, "isLearned": False}
        assert words == ["reluctant"]

    async def test_custom_word_list_reads_its_own_table(self):
        db = FakeDb({"userlistword.find_many": [SimpleNamespace(word="Glimpse")]})
        assert await svc.list_words(db, 7, CUSTOM_WORDS) == ["glimpse"]
        assert db.called("userword.find_many") == []

    async def test_reel_movie_ids_come_from_the_reel_table(self):
        db = FakeDb({
            "userreelmovie.find_many": [SimpleNamespace(tmdbId=238, position=0)],
            "movie.find_many": [SimpleNamespace(tmdbId=238, id=99)],
        })
        assert await svc.list_movie_ids(db, 7, REEL) == [99]

    async def test_films_without_a_catalogue_row_are_dropped(self):
        # A user-added TMDB id we haven't ingested has no vocabulary, so it
        # cannot contribute to a practice pool.
        db = FakeDb({
            "userlistfilm.find_many": [
                SimpleNamespace(tmdbId=238, position=0),
                SimpleNamespace(tmdbId=999999, position=1),
            ],
            "movie.find_many": [SimpleNamespace(tmdbId=238, id=99)],
        })
        assert await svc.list_movie_ids(db, 7, CUSTOM_FILMS) == [99]

    async def test_empty_film_list_needs_no_movie_lookup(self):
        db = FakeDb({"userlistfilm.find_many": []})
        assert await svc.list_movie_ids(db, 7, CUSTOM_FILMS) == []
        assert db.called("movie.find_many") == []


# ── Limits ─────────────────────────────────────────────────────────────────

class TestLimitEnforcement:
    async def test_too_many_lists_of_one_kind_is_422(self):
        db = FakeDb({"userlist.count": svc.MAX_LISTS_PER_KIND})
        with pytest.raises(ListError) as e:
            await svc.create_list(db, 7, "One more", "films")
        assert e.value.code == "list_limit_reached"
        assert e.value.status == 422

    async def test_duplicate_name_is_409_case_insensitively(self):
        db = FakeDb({"userlist.count": 0, "query_raw": [{"?column?": 1}]})
        with pytest.raises(ListError) as e:
            await svc.create_list(db, 7, "FILM NOIR", "films")
        assert e.value.code == "duplicate_name"
        assert e.value.status == 409

    async def test_over_film_capacity_is_422(self):
        db = db_with_list(CUSTOM_FILMS, **{
            "sql:ROW_NUMBER() OVER": [
                {"list_id": CUSTOM_FILMS.id, "cnt": svc.MAX_FILMS_PER_LIST,
                 "poster_path": None},
            ],
            "sql:COUNT(DISTINCT mlm.lemma_id)": [],
        })
        with pytest.raises(ListError) as e:
            await svc.add_items(db, 7, CUSTOM_FILMS.id, films=[{"tmdb_id": 1, "title": "x"}])
        assert e.value.code == "list_limit_reached"

    async def test_a_batch_that_would_overflow_is_rejected_whole(self):
        # Partially applying a batch would leave the client's optimistic
        # count wrong with no way to reconcile.
        db = db_with_list(CUSTOM_FILMS, **{
            "sql:ROW_NUMBER() OVER": [
                {"list_id": CUSTOM_FILMS.id, "cnt": svc.MAX_FILMS_PER_LIST - 1,
                 "poster_path": None},
            ],
            "sql:COUNT(DISTINCT mlm.lemma_id)": [],
        })
        with pytest.raises(ListError):
            await svc.add_items(db, 7, CUSTOM_FILMS.id, films=[
                {"tmdb_id": 1, "title": "a"}, {"tmdb_id": 2, "title": "b"},
            ])
        assert not db.sql_touching("INSERT INTO user_list_films")


# ── ensure_system_lists ────────────────────────────────────────────────────

class TestEnsureSystemLists:
    async def test_creates_both_pinned_lists(self):
        db = FakeDb()
        await svc.ensure_system_lists(db, 7)
        inserts = db.sql_touching("INSERT INTO user_lists")
        assert len(inserts) == 2

    async def test_is_race_safe(self):
        # Two concurrent first-opens both miss the SELECT; the loser must be
        # absorbed by ux_user_lists_user_system rather than creating a
        # second "Favourites".
        db = FakeDb()
        await svc.ensure_system_lists(db, 7)
        for sql in db.sql_touching("INSERT INTO user_lists"):
            assert "ON CONFLICT (user_id, system_key)" in sql
            assert "DO NOTHING" in sql

    async def test_is_idempotent_across_repeated_calls(self):
        db = FakeDb()
        await svc.ensure_system_lists(db, 7)
        await svc.ensure_system_lists(db, 7)
        # Same statements again — DO NOTHING makes the replay harmless.
        assert len(db.sql_touching("INSERT INTO user_lists")) == 4


# ── Query budget ───────────────────────────────────────────────────────────

class TestIndexQueryBudget:
    """§2.8 — the index must not be N+1. Adding a list must not add a query:
    the budget is 2 ensure + 1 fetch + 3 film aggregates + 2 word aggregates."""

    def _db(self, n_lists: int) -> FakeDb:
        rows = [REEL, FAVS] + [
            row(id=100 + i, kind="films" if i % 2 else "words",
                systemKey=None, name=f"List {i}", position=i)
            for i in range(n_lists)
        ]
        return FakeDb({"userlist.find_many": rows})

    async def test_query_count_is_flat_in_the_number_of_lists(self):
        small = self._db(2)
        await svc.get_lists(small, 7)
        big = self._db(50)
        await svc.get_lists(big, 7)
        assert len(small.log) == len(big.log)

    async def test_stays_within_the_documented_budget(self):
        db = self._db(50)
        await svc.get_lists(db, 7)
        assert len(db.log) <= 8

    async def test_pinned_lists_come_first(self):
        db = self._db(4)
        summaries = await svc.get_lists(db, 7)
        assert [s.system_key for s in summaries[:2]] == ["reel", "favourites"]
        assert all(s.system_key is None for s in summaries[2:])

    async def test_films_and_words_get_the_fields_their_row_renders(self):
        db = self._db(0)
        by_key = {s.system_key: s for s in await svc.get_lists(db, 7)}
        films, words = by_key["reel"], by_key["favourites"]
        # A films row shows a poster fan and a vocabulary size; a words row
        # shows its first three words and a due count. Never the other way.
        assert films.preview_posters is not None and films.preview_words is None
        assert films.total_words is not None and films.due_count is None
        assert words.preview_words is not None and words.preview_posters is None
        assert words.due_count is not None and words.total_words is None
