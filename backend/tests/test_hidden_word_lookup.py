"""
Tests for the scoped hidden_words lookup in src/routes/movies.py.

`_get_hidden_word_set` used to call an unfiltered `find_many()`, pulling all
~34k hidden_words rows over the wire on every vocabulary request (>100ms) to
answer a few thousand membership tests. It now asks Postgres to intersect
against the caller's candidate forms.

What matters and is asserted here:
1. It queries with a scoped SQL predicate, never a whole-table load.
2. Candidates go as ONE text[] parameter, so a long vocabulary can't approach
   the bind-parameter limit.
3. The returned set is lowercase on BOTH sides, so a hidden word stored with
   capitals still matches (the old code lowercased only the lookup side).
4. Empty/blank input short-circuits without touching the DB.
5. Candidates are deduped, so repeated forms don't bloat the parameter.

No Postgres and no Prisma engine: the fake DB records what it was asked.
"""
from __future__ import annotations

import pytest

from src.routes.movies import _get_hidden_word_set


class _FakeDB:
    """Records query_raw calls and replays a fixed hidden_words table."""

    def __init__(self, hidden_rows: list[str] | None = None):
        self.hidden = hidden_rows or []
        self.calls: list[tuple[str, tuple]] = []

    async def query_raw(self, sql: str, *args):
        self.calls.append((" ".join(sql.split()), args))
        requested = set(args[0]) if args else set()
        return [
            {"word": w.lower()} for w in self.hidden if w.lower() in requested
        ]

    async def find_many(self, *a, **kw):  # pragma: no cover - must never run
        raise AssertionError("whole-table load: the bottleneck this fixes")


@pytest.mark.asyncio
async def test_returns_only_forms_that_are_hidden():
    db = _FakeDB(["gram", "kilometer", "unrelated"])

    hidden = await _get_hidden_word_set(db, ["gram", "stakeholder", "kilometer"])

    assert hidden == {"gram", "kilometer"}
    assert "stakeholder" not in hidden


@pytest.mark.asyncio
async def test_query_is_scoped_not_a_whole_table_load():
    db = _FakeDB(["gram"])

    await _get_hidden_word_set(db, ["gram", "stakeholder"])

    sql, args = db.calls[0]
    assert "WHERE" in sql and "hidden_words" in sql
    # One array parameter, not one placeholder per candidate.
    assert "ANY($1::text[])" in sql
    assert len(args) == 1
    assert isinstance(args[0], list)


@pytest.mark.asyncio
async def test_candidates_are_lowercased_and_deduped():
    db = _FakeDB([])

    await _get_hidden_word_set(db, ["Gram", "GRAM", " gram ", "Kilometer", None, ""])

    _sql, args = db.calls[0]
    assert args[0] == ["gram", "kilometer"]


@pytest.mark.asyncio
async def test_stored_capitals_still_match():
    """
    Regression: the old code lowercased only the lookup side, so a
    hidden_words row written as "Gram" silently never matched.
    """
    db = _FakeDB(["Gram"])

    hidden = await _get_hidden_word_set(db, ["gram"])

    assert hidden == {"gram"}


@pytest.mark.asyncio
@pytest.mark.parametrize("forms", [[], [None], ["", "   "], [None, ""]])
async def test_empty_input_skips_the_query(forms):
    db = _FakeDB(["gram"])

    hidden = await _get_hidden_word_set(db, forms)

    assert hidden == set()
    assert db.calls == []


@pytest.mark.asyncio
async def test_accepts_a_generator_of_word_lemma_pairs():
    """Both call sites pass a generator over (word, lemma) of each row."""
    rows = [("Grams", "gram"), ("stakeholders", "stakeholder")]
    db = _FakeDB(["gram"])

    hidden = await _get_hidden_word_set(
        db, (form for w, lem in rows for form in (w, lem))
    )

    assert hidden == {"gram"}
