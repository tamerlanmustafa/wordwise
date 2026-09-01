"""
Unit tests for session_kinds.py.

`plan_deck` — the rule that decides what a Practice session feels like — plus
the kind set, the alias table and the cooldown fragment are pure and tested
directly. The Practice / list composers are DB-touching and covered by smoke
tests; `compose_movie_lesson` (#166) is exercised here against an in-memory
`user_words`, because its whole contract is *which rows it writes*.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from prisma.errors import UniqueViolationError

from src.services.session_kinds import (
    DAILY_CAP_EXEMPT_KINDS,
    DEPRECATED_KIND_ALIASES,
    KIND_SESSION_SIZE,
    LIST_KINDS,
    MOVIE_LESSON_MAX_WORDS,
    MOVIE_LESSON_SOURCE,
    PRACTICE_SOURCE,
    RECALL_MAX,
    RECALL_MIN,
    REVIEW_COOLDOWN_HOURS,
    SAVED_TARGET,
    UNPADDED_KINDS,
    VALID_KINDS,
    canonical_kind,
    compose_for_kind,
    compose_movie_lesson,
    cooldown_where_fragment,
    normalize_lesson_words,
    pick_lesson_row,
    plan_deck,
    recently_reviewed_cutoff,
    user_owned_where_fragment,
)


class TestPlanDeck:
    """A deck is recalls + the user's own words + fresh level-appropriate
    words. These tests pin the proportions, because they are the difference
    between a session that teaches and one that only re-tests."""

    def test_new_user_gets_an_all_fresh_deck(self):
        # Nothing due, nothing saved: a first-ever session must still be a
        # full ten cards rather than an empty screen.
        assert plan_deck(due=0, saved=0, fresh=50) == (0, 0, KIND_SESSION_SIZE)

    def test_no_recalls_when_nothing_is_due(self):
        n_recall, _saved, _fresh = plan_deck(due=0, saved=20, fresh=50)
        assert n_recall == 0

    def test_ordinary_debt_keeps_recalls_a_seasoning(self):
        # The user asked for recalls "every now and then", not as the main
        # event: four cards due should not turn the session into review.
        n_recall, _saved, _fresh = plan_deck(due=4, saved=20, fresh=50)
        assert n_recall == RECALL_MIN

    def test_a_single_due_card_still_comes_back(self):
        n_recall, _saved, _fresh = plan_deck(due=1, saved=20, fresh=50)
        assert n_recall == 1

    def test_backlog_escalates_recalls_up_to_the_cap(self):
        # A flat cap would mean a user who falls behind never drains their
        # queue: 60 due at 2/session is 30 sessions against a growing backlog.
        n_recall, _saved, _fresh = plan_deck(due=60, saved=20, fresh=50)
        assert n_recall == RECALL_MAX

    def test_recalls_never_take_the_whole_deck(self):
        # Even at an extreme backlog the session must still teach something.
        for due in (10, 50, 500, 5000):
            n_recall, _saved, _fresh = plan_deck(due=due, saved=20, fresh=50)
            assert n_recall <= RECALL_MAX < KIND_SESSION_SIZE

    def test_saved_words_are_capped_but_present(self):
        _recall, n_saved, _fresh = plan_deck(due=0, saved=50, fresh=50)
        assert n_saved == SAVED_TARGET

    def test_saved_words_appear_even_with_a_backlog(self):
        # The user's own words are the reason they saved them; a busy queue
        # must not push them out entirely.
        _recall, n_saved, _fresh = plan_deck(due=60, saved=10, fresh=50)
        assert n_saved > 0

    def test_deck_is_full_whenever_material_exists(self):
        for due, saved, fresh in [
            (0, 0, 50), (4, 4, 50), (60, 50, 50), (0, 50, 0), (50, 0, 0),
        ]:
            assert sum(plan_deck(due, saved, fresh)) == KIND_SESSION_SIZE

    def test_exhausted_fresh_pool_falls_back_to_the_user_own_words(self):
        # The long-tail user who has studied everything at their level gets a
        # full deck of their own vocabulary, not a four-card session.
        n_recall, n_saved, n_fresh = plan_deck(due=3, saved=50, fresh=0)
        assert n_fresh == 0
        assert n_recall + n_saved == KIND_SESSION_SIZE

    def test_never_promises_more_than_a_source_has(self):
        n_recall, n_saved, n_fresh = plan_deck(due=2, saved=1, fresh=3)
        assert (n_recall, n_saved, n_fresh) == (2, 1, 3)

    def test_short_on_everything_returns_what_exists(self):
        assert sum(plan_deck(due=1, saved=1, fresh=1)) == 3

    def test_never_exceeds_size(self):
        for due in range(0, 15):
            for saved in range(0, 15):
                total = sum(plan_deck(due, saved, fresh=50))
                assert total <= KIND_SESSION_SIZE

    def test_negative_inputs_are_clamped(self):
        # Defensive: a count query that somehow returns junk must not produce
        # a negative slice index at the call site.
        assert all(n >= 0 for n in plan_deck(due=-5, saved=-1, fresh=-3))

    def test_honours_a_custom_size(self):
        assert sum(plan_deck(due=10, saved=10, fresh=10, size=5)) == 5


class TestKindSet:
    def test_current_kinds(self):
        # `practice` is the whole Practice tab; the two list kinds are started
        # from the Lists tab's gold button.
        assert {"practice", "list_words", "list_films"} <= VALID_KINDS

    def test_retired_tiles_are_still_accepted(self):
        # Installed App Store builds still send these. Answering with a 422
        # would leave Practice broken on every phone that has not updated.
        for stale in ("quick_recall", "tough_words", "movie_deep_dive"):
            assert stale in VALID_KINDS
            assert canonical_kind(stale) == "practice"

    def test_retired_synonym_round_is_not_accepted(self):
        # Retired before it ever shipped, so nothing in the wild asks for it.
        assert "synonym_round" not in VALID_KINDS

    def test_canonical_kind_passes_current_kinds_through(self):
        for kind in ("practice", "list_words", "list_films"):
            assert canonical_kind(kind) == kind

    def test_aliases_all_resolve_into_the_valid_set(self):
        for alias, target in DEPRECATED_KIND_ALIASES.items():
            assert alias in VALID_KINDS
            assert target in VALID_KINDS

    def test_list_kinds_are_a_subset_of_valid_kinds(self):
        assert LIST_KINDS <= VALID_KINDS

    def test_session_size_constant_matches_route(self):
        # If this drifts from the route's SESSION_SIZE we'd over- or
        # under-fill queues. Pin it to the published value.
        assert KIND_SESSION_SIZE == 10


class TestUserOwnedFragment:
    """Rows Practice padded in are not rows the user saved. Getting this
    predicate wrong does not fail loudly — it empties the saved-words list."""

    def test_admits_legacy_null_source_rows(self):
        # Every row written before the column existed has source NULL. A bare
        # `not` would discard all of them, i.e. every saved word there is.
        frag = user_owned_where_fragment()
        assert {"source": None} in frag["OR"]

    def test_excludes_practice_rows(self):
        frag = user_owned_where_fragment()
        assert {"source": {"not": PRACTICE_SOURCE}} in frag["OR"]

    def test_is_a_pure_or_only_clause(self):
        # Callers spread it alongside userId / isLearned filters, so it must
        # not carry any other top-level key that would clobber them.
        assert set(user_owned_where_fragment().keys()) == {"OR"}


class TestReviewCooldown:
    NOW = datetime(2026, 6, 2, 12, 0, tzinfo=timezone.utc)

    def test_cutoff_subtracts_default_window(self):
        cutoff = recently_reviewed_cutoff(self.NOW)
        assert cutoff == self.NOW - timedelta(hours=REVIEW_COOLDOWN_HOURS)

    def test_cutoff_honours_explicit_hours(self):
        assert recently_reviewed_cutoff(self.NOW, hours=24) == self.NOW - timedelta(hours=24)

    def test_default_window_is_positive(self):
        # A non-positive window would make the cooldown a no-op (every row
        # is "older than now"), silently disabling the anti-repetition fix.
        assert REVIEW_COOLDOWN_HOURS > 0

    def test_fragment_admits_never_reviewed_or_pre_cutoff(self):
        cutoff = recently_reviewed_cutoff(self.NOW)
        frag = cooldown_where_fragment(cutoff)
        # Shape: an OR of "never reviewed" and "reviewed before cutoff".
        assert frag == {
            "OR": [
                {"srsLastReviewedAt": None},
                {"srsLastReviewedAt": {"lt": cutoff}},
            ]
        }

    def test_fragment_is_a_pure_or_only_clause(self):
        # It must contribute only the OR key so callers can spread it
        # alongside their scalar filters (userId / srsBox / movieId)
        # without clobbering them.
        frag = cooldown_where_fragment(self.NOW)
        assert set(frag.keys()) == {"OR"}


# ── movie_lesson (#166) ─────────────────────────────────────────────────────

NOW = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)
USER = 7
FILM = 42


def _row(id, word, *, movie_id=None, due=NOW, learned=False, source=None):
    return SimpleNamespace(
        id=id, userId=USER, word=word, movieId=movie_id, isLearned=learned,
        srsBox=1, srsDueAt=due, srsLastReviewedAt=None, source=source,
    )


class _FakeUserWordTable:
    """An in-memory `user_words`. `find_many` answers the composer's one
    lookup (user + case-insensitive `word IN`, as Prisma's `mode:
    insensitive` does on Postgres); `create` appends and enforces the
    (user, word, movie) unique the real table has."""

    def __init__(self, rows=()):
        self.rows = list(rows)
        self.created: list = []
        self.lookups: list = []
        self._next_id = max([r.id for r in self.rows], default=0) + 1

    async def find_many(self, where=None, **kwargs):
        self.lookups.append(where)
        wanted = {w.lower() for w in where["word"]["in"]}
        return [
            r for r in self.rows
            if r.userId == where["userId"] and r.word.lower() in wanted
        ]

    async def create(self, data):
        key = (data["userId"], data["word"], data.get("movieId"))
        if any((r.userId, r.word, r.movieId) == key for r in self.rows):
            raise UniqueViolationError({"error": "unique constraint failed"})
        fields = dict(
            id=self._next_id, isLearned=False, srsBox=1,
            srsLastReviewedAt=None, movieId=None, source=None,
        )
        fields.update(data)
        row = SimpleNamespace(**fields)
        self._next_id += 1
        self.rows.append(row)
        self.created.append(row)
        return row


def _db(rows=()):
    return SimpleNamespace(userword=_FakeUserWordTable(rows))


class TestMovieLessonKind:
    def test_is_a_current_kind_and_its_own_canonical_form(self):
        assert "movie_lesson" in VALID_KINDS
        assert canonical_kind("movie_lesson") == "movie_lesson"
        assert "movie_lesson" not in LIST_KINDS

    def test_is_never_padded(self):
        # A scene test asks the words the reader just studied; a registry or
        # film word padded in would be a question about nothing they saw.
        assert "movie_lesson" in UNPADDED_KINDS
        assert "list_words" in UNPADDED_KINDS

    def test_is_outside_the_free_daily_cap(self):
        # #161: energy replaces the cap for Screening Mode. Practice stays
        # capped until #168 retires the gate.
        assert DAILY_CAP_EXEMPT_KINDS == {"movie_lesson"}
        assert DAILY_CAP_EXEMPT_KINDS <= VALID_KINDS

    def test_source_is_distinct_from_practice_padding(self):
        # `user_owned_where_fragment` hides only PRACTICE_SOURCE. A lesson's
        # rows must NOT share that value, or a word the user was tested on in
        # a film would never come back through Practice's "your words".
        assert MOVIE_LESSON_SOURCE != PRACTICE_SOURCE
        assert len(MOVIE_LESSON_SOURCE) <= 16, "user_words.source is VARCHAR(16)"

    def test_cap_covers_every_planned_test_length(self):
        # 6-card scene: 3 fresh + 2 resurfaced. Longest scene (11): 6 + 2.
        # Final Cut (#171): 10. All must fit in one start.
        assert MOVIE_LESSON_MAX_WORDS >= 10


class TestNormalizeLessonWords:
    def test_strips_lowercases_dedupes_and_keeps_order(self):
        assert normalize_lesson_words([" Linger", "brace", "linger", "BRACE ", "veer"]) == [
            "linger", "brace", "veer",
        ]

    def test_blanks_and_none_are_dropped(self):
        assert normalize_lesson_words(["", "  ", None, "x"]) == ["x"]

    def test_missing_list_is_empty(self):
        assert normalize_lesson_words(None) == []
        assert normalize_lesson_words([]) == []


class TestPickLessonRow:
    def test_nothing_to_pick_from(self):
        assert pick_lesson_row([], FILM) is None

    def test_a_learned_marker_anywhere_skips_the_word(self):
        # The global learned marker hides a word everywhere else; a lesson
        # must not be the one surface that keeps asking it.
        rows = [_row(1, "linger", movie_id=FILM), _row(2, "linger", learned=True)]
        assert pick_lesson_row(rows, FILM) is None

    def test_prefers_the_films_own_row(self):
        # Keeps the film's box state coherent for the mastery ring (#171),
        # even when another row is due sooner.
        other = _row(1, "linger", movie_id=99, due=NOW - timedelta(days=3))
        own = _row(2, "linger", movie_id=FILM, due=NOW + timedelta(days=3))
        assert pick_lesson_row([other, own], FILM) is own

    def test_falls_back_to_the_row_practice_would_surface_first(self):
        later = _row(1, "linger", due=NOW + timedelta(days=1))
        sooner = _row(2, "linger", movie_id=99, due=NOW - timedelta(days=1))
        assert pick_lesson_row([later, sooner], FILM) is sooner

    def test_ties_break_on_the_oldest_row(self):
        a = _row(5, "linger")
        b = _row(3, "linger", movie_id=99)
        assert pick_lesson_row([a, b], FILM) is b


class TestComposeMovieLesson:
    async def test_creates_rows_only_for_words_with_none(self):
        db = _db([_row(1, "brace", movie_id=FILM)])

        picked = await compose_movie_lesson(
            db, user_id=USER, movie_id=FILM, words=["linger", "brace", "veer"], now=NOW,
        )

        assert [r.word for r in picked] == ["linger", "brace", "veer"], "asking order kept"
        assert [r.word for r in db.userword.created] == ["linger", "veer"]
        assert picked[1].id == 1, "the existing brace row is reused, not shadowed"
        for row in db.userword.created:
            assert row.userId == USER
            assert row.movieId == FILM
            assert row.source == MOVIE_LESSON_SOURCE
            assert row.srsDueAt == NOW

    async def test_rerunning_a_scene_creates_nothing(self):
        # The AC that matters most: a scene replayed, or a runner retrying
        # after a dropped connection, must land on the rows it made before.
        db = _db()
        first = await compose_movie_lesson(
            db, user_id=USER, movie_id=FILM, words=["linger", "veer"], now=NOW,
        )
        created_after_first = len(db.userword.created)

        second = await compose_movie_lesson(
            db, user_id=USER, movie_id=FILM, words=["Veer", "LINGER"], now=NOW,
        )

        assert len(db.userword.created) == created_after_first == 2
        assert {r.id for r in second} == {r.id for r in first}

    async def test_never_writes_for_words_it_was_not_asked_about(self):
        # Lazy creation is the whole point: a 60-word deck opened and closed
        # must write nothing; only the tested words get rows.
        db = _db()
        await compose_movie_lesson(
            db, user_id=USER, movie_id=FILM, words=["linger"], now=NOW,
        )
        assert [r.word for r in db.userword.created] == ["linger"]

    async def test_reuses_a_row_saved_from_another_film_or_globally(self):
        # One Leitner box per word: the lesson must not open a second opinion
        # about "linger" next to the one Practice already holds.
        db = _db([_row(1, "linger"), _row(2, "veer", movie_id=99)])

        picked = await compose_movie_lesson(
            db, user_id=USER, movie_id=FILM, words=["linger", "veer"], now=NOW,
        )

        assert [r.id for r in picked] == [1, 2]
        assert db.userword.created == []

    async def test_finds_a_row_the_user_saved_with_a_capital(self):
        db = _db([_row(1, "Linger")])
        picked = await compose_movie_lesson(
            db, user_id=USER, movie_id=FILM, words=["linger"], now=NOW,
        )
        assert [r.id for r in picked] == [1]
        assert db.userword.created == []

    async def test_a_learned_word_is_neither_asked_nor_recreated(self):
        db = _db([_row(1, "linger", learned=True)])

        picked = await compose_movie_lesson(
            db, user_id=USER, movie_id=FILM, words=["linger", "veer"], now=NOW,
        )

        assert [r.word for r in picked] == ["veer"]
        assert [r.word for r in db.userword.created] == ["veer"]

    async def test_losing_the_insert_race_skips_the_word(self):
        # Two starts of the same scene in flight: the second hits
        # `unique_user_word_movie`. It must skip, not 500 the whole session.
        db = _db()
        table = db.userword
        real_create = table.create

        async def racing_create(data):
            if data["word"] == "linger":
                raise UniqueViolationError({"error": "unique constraint failed"})
            return await real_create(data)

        table.create = racing_create
        picked = await compose_movie_lesson(
            db, user_id=USER, movie_id=FILM, words=["linger", "veer"], now=NOW,
        )
        assert [r.word for r in picked] == ["veer"]

    async def test_any_other_database_error_propagates(self):
        # A dropped connection must become a 500 the client can retry, not a
        # scene test that quietly lost its questions. (Found the honest way:
        # a broken fake raised TypeError and the first draft swallowed it.)
        db = _db()

        async def broken_create(data):
            raise RuntimeError("connection reset")

        db.userword.create = broken_create
        with pytest.raises(RuntimeError):
            await compose_movie_lesson(
                db, user_id=USER, movie_id=FILM, words=["linger"], now=NOW,
            )

    async def test_asks_the_table_once_and_only_for_the_wanted_words(self):
        db = _db()
        await compose_movie_lesson(
            db, user_id=USER, movie_id=FILM, words=["a", "b", "a"], now=NOW,
        )
        assert len(db.userword.lookups) == 1
        where = db.userword.lookups[0]
        assert where["userId"] == USER
        assert where["word"] == {"in": ["a", "b"], "mode": "insensitive"}

    async def test_clamps_to_the_per_start_cap(self):
        db = _db()
        words = [f"w{i}" for i in range(MOVIE_LESSON_MAX_WORDS + 5)]
        picked = await compose_movie_lesson(
            db, user_id=USER, movie_id=FILM, words=words, now=NOW,
        )
        assert len(picked) == MOVIE_LESSON_MAX_WORDS
        assert len(db.userword.created) == MOVIE_LESSON_MAX_WORDS

    async def test_nothing_asked_writes_nothing(self):
        db = _db()
        assert await compose_movie_lesson(
            db, user_id=USER, movie_id=FILM, words=["", "  "], now=NOW,
        ) == []
        assert db.userword.created == []


class TestComposeForKindMovieLesson:
    async def test_requires_a_movie(self):
        with pytest.raises(ValueError, match="movie_id"):
            await compose_for_kind(_db(), kind="movie_lesson", user_id=USER, words=["x"])

    async def test_requires_at_least_one_word(self):
        for words in (None, [], ["", " "]):
            with pytest.raises(ValueError, match="word"):
                await compose_for_kind(
                    _db(), kind="movie_lesson", user_id=USER, movie_id=FILM, words=words,
                )

    async def test_dispatches_with_an_empty_reserve(self):
        # Same (picked, reserve) shape as every other kind, so the route
        # hydrates it identically. A lesson has nothing held back to pad from.
        db = _db()
        picked, reserve = await compose_for_kind(
            db, kind="movie_lesson", user_id=USER, movie_id=FILM, words=["linger"], now=NOW,
        )
        assert [r.word for r in picked] == ["linger"]
        assert reserve == []

    async def test_list_kinds_still_ignore_the_lesson_arguments(self):
        # Passing movie_id / words to a list kind must not change its path:
        # it still fails on the missing list_id, exactly as before.
        with pytest.raises(ValueError, match="list_id"):
            await compose_for_kind(
                _db(), kind="list_words", user_id=USER, movie_id=FILM, words=["x"],
            )
