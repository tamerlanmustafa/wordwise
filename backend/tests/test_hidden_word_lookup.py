"""
Tests for the scoped hidden_words lookup in src/services/hidden_words.py.

`get_hidden_word_set` used to be a private helper in routes/movies.py, written
because an unfiltered `find_many()` pulled all ~34k hidden_words rows over the
wire on every vocabulary request (>100ms) to answer a few thousand membership
tests. Issue #121: five other call sites in quiz.py and books.py never got it,
so it moved to services/ and they now share it.

What matters and is asserted here:
1. It queries with a scoped SQL predicate, never a whole-table load.
2. Candidates go as ONE text[] parameter, so a long vocabulary can't approach
   the bind-parameter limit.
3. The returned set is lowercase on BOTH sides, so a hidden word stored with
   capitals still matches (the old code lowercased only the lookup side).
4. Empty/blank input short-circuits without touching the DB.
5. Candidates are deduped, so repeated forms don't bloat the parameter.
6. No route module has an unfiltered `hiddenword.find_many()` left (the
   regression that #121 filed — the fix existed and wasn't propagated).

No Postgres and no Prisma engine: the fake DB records what it was asked.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from src.services.hidden_words import get_hidden_word_set


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

    hidden = await get_hidden_word_set(db, ["gram", "stakeholder", "kilometer"])

    assert hidden == {"gram", "kilometer"}
    assert "stakeholder" not in hidden


@pytest.mark.asyncio
async def test_query_is_scoped_not_a_whole_table_load():
    db = _FakeDB(["gram"])

    await get_hidden_word_set(db, ["gram", "stakeholder"])

    sql, args = db.calls[0]
    assert "WHERE" in sql and "hidden_words" in sql
    # One array parameter, not one placeholder per candidate.
    assert "ANY($1::text[])" in sql
    assert len(args) == 1
    assert isinstance(args[0], list)


@pytest.mark.asyncio
async def test_candidates_are_lowercased_and_deduped():
    db = _FakeDB([])

    await get_hidden_word_set(db, ["Gram", "GRAM", " gram ", "Kilometer", None, ""])

    _sql, args = db.calls[0]
    assert args[0] == ["gram", "kilometer"]


@pytest.mark.asyncio
async def test_stored_capitals_still_match():
    """
    Regression: the old code lowercased only the lookup side, so a
    hidden_words row written as "Gram" silently never matched.
    """
    db = _FakeDB(["Gram"])

    hidden = await get_hidden_word_set(db, ["gram"])

    assert hidden == {"gram"}


@pytest.mark.asyncio
@pytest.mark.parametrize("forms", [[], [None], ["", "   "], [None, ""]])
async def test_empty_input_skips_the_query(forms):
    db = _FakeDB(["gram"])

    hidden = await get_hidden_word_set(db, forms)

    assert hidden == set()
    assert db.calls == []


@pytest.mark.asyncio
async def test_accepts_a_generator_of_word_lemma_pairs():
    """Both movies.py call sites pass a generator over (word, lemma) of each row."""
    rows = [("Grams", "gram"), ("stakeholders", "stakeholder")]
    db = _FakeDB(["gram"])

    hidden = await get_hidden_word_set(
        db, (form for w, lem in rows for form in (w, lem))
    )

    assert hidden == {"gram"}


# --- Issue #121: the fix must stay propagated --------------------------------

_ROUTES = Path(__file__).resolve().parents[1] / "src" / "routes"

# admin.py is the *write* side: /admin/hidden-words lists the table for a human
# to curate, so loading all of it is the point there, not a bug.
_WHOLE_TABLE_LOAD_IS_INTENTIONAL = {"admin.py"}


def test_no_route_loads_the_whole_hidden_words_table():
    """
    #121 was filed because `_get_hidden_word_set` existed in movies.py and five
    other call sites still called `db.hiddenword.find_many()` unfiltered —
    34,095 rows and 34,095 Prisma model objects built on the event loop, per
    request, on user-facing quiz and book paths.

    Reading a route file is the only way to catch that: an unfiltered load is
    correct, just slow, so no behavioral assertion fails when it comes back.
    """
    offenders = [
        path.name
        for path in sorted(_ROUTES.glob("*.py"))
        if path.name not in _WHOLE_TABLE_LOAD_IS_INTENTIONAL
        and "hiddenword.find_many()" in path.read_text()
    ]

    assert offenders == [], (
        f"{offenders} load all ~34k hidden_words rows per request. "
        "Use services.hidden_words.get_hidden_word_set(db, forms) instead."
    )


def test_lookup_predicate_matches_the_functional_index():
    """
    The lookup filters on LOWER(word), which the plain btree
    ix_hidden_words_word cannot serve — it needs ix_hidden_words_word_lower
    (prisma/manual/2026_08_18_hidden_words_lower_index_issue_121.sql).

    Prisma can't express an expression index, so schema.prisma will never
    mention it and nothing else ties the two together. If the SQL is ever
    dropped, or the predicate stops being LOWER(word), this test says so.
    """
    from src.services.hidden_words import _SCOPED_LOOKUP_SQL

    assert "LOWER(word) = ANY($1::text[])" in _SCOPED_LOOKUP_SQL

    migration = (
        Path(__file__).resolve().parents[1]
        / "prisma"
        / "manual"
        / "2026_08_18_hidden_words_lower_index_issue_121.sql"
    )
    sql = migration.read_text()
    assert "ix_hidden_words_word_lower" in sql
    assert "ON hidden_words (LOWER(word))" in sql
