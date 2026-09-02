"""
Unit tests for session_kinds.py pure helpers.

The async composers are DB-touching and covered by smoke tests. Here we lock
down `plan_deck` — the rule that decides what a Practice session feels like —
plus the kind set, the alias table and the cooldown fragment.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from src.services.session_kinds import (
    DEPRECATED_KIND_ALIASES,
    KIND_SESSION_SIZE,
    LIST_KINDS,
    PRACTICE_SOURCE,
    RECALL_MAX,
    RECALL_MIN,
    REVIEW_COOLDOWN_HOURS,
    SAVED_TARGET,
    VALID_KINDS,
    canonical_kind,
    cooldown_where_fragment,
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
