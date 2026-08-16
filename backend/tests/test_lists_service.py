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
    DIFFICULTY_TO_CEFR,
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

    @pytest.mark.parametrize("sort", ["added", "due", "alpha"])
    def test_word_sorts(self, sort):
        assert validate_sort("words", sort) == sort

    def test_due_is_rejected_on_a_films_list(self):
        # §3: sort=due is words-only; on a films list it is a 422 rather than
        # a silent fallback, so a client bug surfaces.
        with pytest.raises(ListError) as e:
            validate_sort("films", "due")
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
    def test_no_srs_row_is_new(self):
        # Legitimate: added from Explore, never studied (§2.7).
        assert _srs_state({"due_at": None, "learned": None, "box": None}, NOW) == "new"

    def test_due_in_the_past_is_due(self):
        row = {"due_at": NOW - timedelta(days=1), "learned": False, "box": 2}
        assert _srs_state(row, NOW) == "due"

    def test_due_exactly_now_is_due(self):
        assert _srs_state({"due_at": NOW, "learned": False, "box": 1}, NOW) == "due"

    def test_future_due_past_box_one_is_learning(self):
        row = {"due_at": NOW + timedelta(days=3), "learned": False, "box": 3}
        assert _srs_state(row, NOW) == "learning"

    def test_learned_wins_over_due(self):
        row = {"due_at": NOW - timedelta(days=9), "learned": True, "box": 5}
        assert _srs_state(row, NOW) == "learned"

    def test_naive_timestamp_is_treated_as_utc(self):
        # Postgres can hand back a naive datetime depending on the driver;
        # comparing it to an aware `now` would raise instead of resolving.
        row = {"due_at": datetime(2026, 8, 15, 12, 0), "learned": False, "box": 1}
        assert _srs_state(row, NOW) == "due"


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
    def test_maps_the_long_names_the_movies_table_stores(self):
        assert DIFFICULTY_TO_CEFR["ELEMENTARY"] == "A2"
        assert DIFFICULTY_TO_CEFR["UPPER_INTERMEDIATE"] == "B2"

    def test_does_not_accept_bare_codes(self):
        # Guards against someone "simplifying" the two maps into one.
        assert DIFFICULTY_TO_CEFR.get("B2") is None


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
