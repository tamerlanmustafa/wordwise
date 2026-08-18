"""
Issue #121: the quiz and book word pools filter admin-hidden words by asking
Postgres to intersect against the words they actually hold, instead of loading
the whole ~34k-row hidden_words table per call.

These are the call sites that #121 found still doing the whole-table load, and
they are the reason it mattered: they sit on user-facing paths (quiz start,
journey screen, book vocabulary), and the batch endpoints call them once per
CEFR level per movie — so one `/quiz/batch/units?movie_ids=a,b,c` request made
18 full-table loads.

The unit under test is the pool helper, not the route: the routes need a real
Prisma harness, so the fake DB here replays a small hidden_words table and
records every lookup (mirroring test_hidden_word_lookup.py's stub).
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from src.routes.quiz import (
    _get_journey_words_at_level,
    _load_batch_pool,
    _load_level_word_pool,
)


class _FakeCollection:
    def __init__(self, rows):
        self.rows = rows

    async def find_first(self, where=None):
        return self.rows[0] if self.rows else None

    async def find_many(self, where=None, order=None, take=None):
        rows = self.rows
        if where and "cefrLevel" in where:
            rows = [r for r in rows if r.cefrLevel == where["cefrLevel"]]
        if where and "scriptId" in where:
            rows = [r for r in rows if r.scriptId == where["scriptId"]]
        return rows


class _FakeDB:
    """Replays one movie's classifications plus a hidden_words table."""

    def __init__(self, classifications, hidden, script_id=7, movie_id=1):
        self.moviescript = _FakeCollection(
            [SimpleNamespace(id=script_id, movieId=movie_id)]
        )
        self.wordclassification = _FakeCollection(classifications)
        self.hidden = hidden
        self.lookups: list[list[str]] = []

    async def query_raw(self, sql: str, *args):
        # Journey pulls its words with raw SQL too; only the hidden_words
        # lookup is of interest here, the rest is replayed by the caller.
        if "hidden_words" not in sql:
            raise AssertionError(f"unexpected raw query: {sql}")
        requested = set(args[0])
        self.lookups.append(list(args[0]))
        return [{"word": w.lower()} for w in self.hidden if w.lower() in requested]

    @property
    def hiddenword(self):  # pragma: no cover - must never be reached
        raise AssertionError(
            "loaded the whole hidden_words table; use get_hidden_word_set"
        )


def _cls(word, level="B1", script_id=7):
    return SimpleNamespace(word=word, cefrLevel=level, scriptId=script_id)


@pytest.mark.asyncio
async def test_level_pool_drops_hidden_words():
    db = _FakeDB([_cls("gram"), _cls("stakeholder"), _cls("kilometer")], ["gram"])

    pool = await _load_level_word_pool(db, movie_id=1, level="B1")

    assert pool == ["stakeholder", "kilometer"]


@pytest.mark.asyncio
async def test_level_pool_lookup_is_scoped_to_this_movies_words():
    """The whole point of #121: the parameter is the movie's vocabulary, so
    the query cost tracks the script's size, not hidden_words' size."""
    db = _FakeDB([_cls("gram"), _cls("stakeholder")], ["gram", "unrelated"])

    await _load_level_word_pool(db, movie_id=1, level="B1")

    assert db.lookups == [["gram", "stakeholder"]]


@pytest.mark.asyncio
async def test_level_pool_matches_hidden_words_case_insensitively():
    """
    Regression: this call site built its set as `{h.word for h in rows}` while
    comparing `c.word.lower()`, so a hidden_words row written with capitals —
    or a script word written with capitals — silently stayed visible.
    """
    db = _FakeDB([_cls("Gram"), _cls("GRAM"), _cls("stakeholder")], ["gram"])

    pool = await _load_level_word_pool(db, movie_id=1, level="B1")

    assert pool == ["stakeholder"]


@pytest.mark.asyncio
async def test_level_pool_filters_by_level():
    db = _FakeDB([_cls("gram", "B1"), _cls("stakeholder", "C1")], [])

    assert await _load_level_word_pool(db, movie_id=1, level="B1") == ["gram"]


@pytest.mark.asyncio
async def test_level_pool_skips_the_lookup_when_the_movie_has_no_words():
    """No candidates means no query at all — the old code queried regardless."""
    db = _FakeDB([], ["gram"])

    assert await _load_level_word_pool(db, movie_id=1, level="B1") == []
    assert db.lookups == []


@pytest.mark.asyncio
async def test_batch_pool_dedupes_across_movies_and_stays_scoped():
    """
    `/quiz/batch/units` calls this once per level per movie. Each lookup must
    stay scoped to that movie's words — this is where the old whole-table load
    multiplied into 6 levels x N movies full scans in a single request.
    """
    db = _FakeDB([_cls("gram"), _cls("stakeholder")], ["gram"])

    pool = await _load_batch_pool(db, movie_ids=[1, 2, 3], level="B1")

    assert pool == ["stakeholder"]  # deduped across the three movies
    assert db.lookups == [["gram", "stakeholder"]] * 3
    assert all(len(candidates) == 2 for candidates in db.lookups)


class _FakeJourneyDB(_FakeDB):
    """Journey words come from raw SQL, so both raw queries land in one stub."""

    def __init__(self, words, hidden):
        super().__init__([], hidden)
        self.words = words

    async def query_raw(self, sql: str, *args):
        if "hidden_words" in sql:
            return await super().query_raw(sql, *args)
        return [{"word": w, "best_rank": i} for i, w in enumerate(self.words)]


@pytest.mark.asyncio
async def test_journey_words_drop_hidden_and_scope_the_lookup():
    db = _FakeJourneyDB(["gram", "stakeholder"], ["gram", "unrelated"])

    words = await _get_journey_words_at_level(db, level="B1", offset=0, limit=10)

    assert words == ["stakeholder"]
    assert db.lookups == [["gram", "stakeholder"]]
