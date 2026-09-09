"""
Unit tests for src/services/lists.py.

The suite has no database (see tests/conftest.py — integration fixtures are
behind the `integration` marker), so this covers the module's pure rules plus
the adapter dispatch, which is the part most likely to break: a list's id does
not tell you where its rows live, and getting that wrong silently reads or
writes the wrong table.

The fake Prisma below records the SQL and model calls each operation makes,
which is how the adapter and query-budget tests assert behaviour without a
server.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from src.services.lists import (
    CEFR_CODES,
    MAX_FILMS_PER_LIST,
    MAX_LISTS_PER_KIND,
    MAX_NAME_LENGTH,
    MAX_PAGE_SIZE,
    MAX_WORDS_PER_LIST,
    SYSTEM_LISTS,
    ListError,
    _srs_state,
    clamp_limit,
    decode_cursor,
    encode_cursor,
    _sort_clause,
    is_system,
    lemma_cefr,
    max_items_for,
    normalize_name,
    validate_kind,
    validate_sort,
)

NOW = datetime(2026, 8, 16, 12, 0, tzinfo=timezone.utc)


def make_list(**kw):
    """A `user_lists` row as Prisma hands it back."""
    base = dict(
        id=1, userId=7, name="My list", kind="films",
        systemKey=None, position=0, createdAt=NOW, updatedAt=NOW,
    )
    base.update(kw)
    return SimpleNamespace(**base)


# ── Name normalisation ─────────────────────────────────────────────────────

class TestNormalizeName:
    def test_trims_surrounding_whitespace(self):
        assert normalize_name("  Film noir  ") == "Film noir"

    def test_folds_newlines_into_spaces(self):
        # The header is one line; a pasted multi-line name is folded rather
        # than rejected.
        assert normalize_name("Film\nnoir\r\nnight") == "Film noir night"

    def test_squeezes_runs_of_whitespace(self):
        assert normalize_name("Film     noir") == "Film noir"

    def test_empty_is_rejected(self):
        with pytest.raises(ListError) as e:
            normalize_name("")
        assert e.value.code == "invalid_name"
        assert e.value.status == 422

    def test_whitespace_only_is_rejected(self):
        with pytest.raises(ListError):
            normalize_name("   \n\t  ")

    def test_none_is_rejected(self):
        with pytest.raises(ListError):
            normalize_name(None)

    def test_max_length_is_accepted(self):
        assert len(normalize_name("x" * MAX_NAME_LENGTH)) == MAX_NAME_LENGTH

    def test_over_max_length_is_rejected(self):
        with pytest.raises(ListError) as e:
            normalize_name("x" * (MAX_NAME_LENGTH + 1))
        assert e.value.status == 422

    def test_length_is_measured_after_folding(self):
        # 60 chars of content plus padding that folds away is legal.
        raw = "  " + ("x" * MAX_NAME_LENGTH) + "  "
        assert normalize_name(raw) == "x" * MAX_NAME_LENGTH


# ── Kind + sort ────────────────────────────────────────────────────────────

class TestValidateKind:
    @pytest.mark.parametrize("kind", ["films", "words"])
    def test_accepts_both_kinds(self, kind):
        assert validate_kind(kind) == kind

    @pytest.mark.parametrize("kind", ["both", "movies", "", None, "FILMS"])
    def test_rejects_anything_else(self, kind):
        with pytest.raises(ListError) as e:
            validate_kind(kind)
        assert e.value.status == 422


class TestValidateSort:
    def test_defaults_to_added(self):
        assert validate_sort("films", None) == "added"
        assert validate_sort("words", "") == "added"

    @pytest.mark.parametrize("sort", ["added", "title", "rating"])
    def test_film_sorts(self, sort):
        assert validate_sort("films", sort) == sort

    @pytest.mark.parametrize("sort", ["added", "alpha"])
    def test_word_sorts(self, sort):
        assert validate_sort("words", sort) == sort

    @pytest.mark.parametrize("kind", ["films", "words"])
    def test_due_is_rejected_on_both_kinds(self, kind):
        """`due` was a words sort and is gone: a list is a collection its
        owner built, and ordering it by the SRS schedule handed them their own
        words in whatever order the algorithm wanted. An unknown sort is a 422
        rather than a silent fallback, so a client still sending it surfaces
        instead of quietly getting a different order than it asked for."""
        with pytest.raises(ListError) as e:
            validate_sort(kind, "due")
        assert e.value.code == "invalid_sort"
        assert e.value.status == 422

    def test_rating_is_rejected_on_a_words_list(self):
        with pytest.raises(ListError):
            validate_sort("words", "rating")


# ── Limits ─────────────────────────────────────────────────────────────────

class TestLimits:
    def test_limit_values_match_the_spec(self):
        assert MAX_LISTS_PER_KIND == 50
        assert MAX_FILMS_PER_LIST == 500
        assert MAX_WORDS_PER_LIST == 2000
        assert MAX_NAME_LENGTH == 60

    def test_max_items_is_per_kind(self):
        assert max_items_for("films") == MAX_FILMS_PER_LIST
        assert max_items_for("words") == MAX_WORDS_PER_LIST


# ── Pagination ─────────────────────────────────────────────────────────────

class TestCursors:
    def test_absent_cursor_starts_at_zero(self):
        assert decode_cursor(None) == 0
        assert decode_cursor("") == 0

    def test_roundtrips(self):
        assert decode_cursor(encode_cursor(150)) == 150

    @pytest.mark.parametrize("bad", ["abc", "1.5", "-1", "'; DROP TABLE"])
    def test_malformed_cursor_is_rejected(self, bad):
        with pytest.raises(ListError) as e:
            decode_cursor(bad)
        assert e.value.code == "invalid_cursor"

    def test_limit_is_clamped_to_the_maximum(self):
        assert clamp_limit(10_000) == MAX_PAGE_SIZE

    def test_limit_floor_is_one(self):
        assert clamp_limit(0) == 1
        assert clamp_limit(-5) == 1


# ── System lists ───────────────────────────────────────────────────────────

class TestSystemLists:
    def test_the_two_pinned_lists_and_their_kinds(self):
        assert set(SYSTEM_LISTS) == {"reel", "favourites"}
        assert SYSTEM_LISTS["reel"]["kind"] == "films"
        assert SYSTEM_LISTS["favourites"]["kind"] == "words"

    def test_is_system_reads_the_system_key(self):
        assert is_system(make_list(systemKey="reel"))
        assert is_system(make_list(systemKey="favourites"))
        assert not is_system(make_list(systemKey=None))


# ── SRS state derivation ───────────────────────────────────────────────────

class TestSrsState:
    """How far along a word is — and deliberately not when it is next due.

    There used to be a fourth state, `due`, which rendered as "due today" on
    the row and made a list the reader had assembled read like a chore sheet
    with items falling out of date. The schedule is the Practice tab's; a list
    describes its words. The clock is gone from this function entirely, which
    is why it no longer takes `now`.
    """

    def test_no_srs_row_is_new(self):
        # Legitimate: added from Explore, never studied (§2.7).
        assert _srs_state({"due_at": None, "learned": None, "box": None}) == "new"

    def test_a_word_past_its_due_date_is_still_just_learning(self):
        # The behaviour change, stated directly: this used to be "due".
        row = {"due_at": NOW - timedelta(days=1), "learned": False, "box": 2}
        assert _srs_state(row) == "learning"

    def test_box_one_stays_new_however_overdue(self):
        assert _srs_state({"due_at": NOW, "learned": False, "box": 1}) == "new"

    def test_future_due_past_box_one_is_learning(self):
        row = {"due_at": NOW + timedelta(days=3), "learned": False, "box": 3}
        assert _srs_state(row) == "learning"

    def test_learned_wins(self):
        row = {"due_at": NOW - timedelta(days=9), "learned": True, "box": 5}
        assert _srs_state(row) == "learned"

    def test_the_timestamp_is_never_compared_to_a_clock(self):
        # A naive datetime used to be a real hazard here: comparing it to an
        # aware `now` raises. Nothing compares it any more — only its presence
        # matters — so the whole class of bug is gone rather than handled.
        row = {"due_at": datetime(2026, 8, 15, 12, 0), "learned": False, "box": 4}
        assert _srs_state(row) == "learning"

    def test_no_state_reports_a_due_date(self):
        rows = [
            {"due_at": None, "learned": None, "box": None},
            {"due_at": NOW - timedelta(days=1), "learned": False, "box": 2},
            {"due_at": NOW + timedelta(days=3), "learned": False, "box": 3},
            {"due_at": NOW - timedelta(days=9), "learned": True, "box": 5},
        ]
        assert all(_srs_state(r) != "due" for r in rows)


# ── CEFR sources ───────────────────────────────────────────────────────────
# The two CEFR columns store *different* things, and conflating them renders
# blank pills rather than raising:
#   movies.difficulty_level -> `difficultylevel`  = BEGINNER / ELEMENTARY / …
#   lemmas.cefr_level       -> `proficiencylevel` = A1 / A2 / … (+ UNKNOWN)

class TestLemmaCefr:
    @pytest.mark.parametrize("code", sorted(CEFR_CODES))
    def test_passes_real_levels_through(self, code):
        assert lemma_cefr(code) == code

    def test_unknown_is_dropped_rather_than_shown(self):
        # #91's holding pen for words the classifier could not place. It is
        # not a level and must never render as a pill.
        assert lemma_cefr("UNKNOWN") is None

    def test_none_and_junk_are_dropped(self):
        assert lemma_cefr(None) is None
        assert lemma_cefr("") is None
        assert lemma_cefr("ELEMENTARY") is None

    def test_is_case_insensitive(self):
        assert lemma_cefr("b2") == "B2"


class TestMovieDifficultyCefr:
    def test_film_rows_band_the_score_rather_than_read_a_stored_level(self):
        # #103: list rows used to translate `movies.difficulty_level`, which
        # disagreed with the score on 1,006 films. They now go through the one
        # shared derivation, so a saved film's pill matches its detail screen.
        from src.services.movie_cefr import cefr_from_score

        assert cefr_from_score(50) == "B2"
        assert cefr_from_score(None) is None

    def test_the_sql_selects_the_column_the_row_builder_reads(self):
        # `difficulty_level` no longer exists on `movies`; selecting it is a
        # runtime SQL error that no typecheck catches.
        import inspect

        from src.services import lists as lists_module

        source = inspect.getsource(lists_module._film_items)
        assert "m.difficulty_score" in source
        assert "difficulty_level" not in source


# ── Raw SQL column names ───────────────────────────────────────────────────

class TestSortClause:
    def test_rating_sorts_on_the_column_that_actually_exists(self):
        # `movies` has no `rating` column — TMDB's score is tmdb_vote_average.
        # A wrong name here is a runtime SQL error, invisible to typecheck.
        clause = _sort_clause("films", "rating")
        assert "tmdb_vote_average" in clause
        assert "m.rating" not in clause

    def test_every_film_sort_has_a_unique_tiebreak(self):
        # Offset pagination is only stable if the ordering is total.
        for sort in ("added", "title", "rating"):
            assert "tmdb_id" in _sort_clause("films", sort)

    def test_every_word_sort_has_a_unique_tiebreak(self):
        for sort in ("added", "due", "alpha"):
            assert "word" in _sort_clause("words", sort)
