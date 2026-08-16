"""
Unit tests for the Explore word-feed helpers in src/routes/srs.py.

The route handler needs a Postgres + Prisma harness, so the pure pieces it
is built from are pinned down here: mix parsing, per-page apportionment,
bucket-exhaustion redistribution, and the sentence-highlight offsets. The
candidate query is checked at the SQL level with a recording stub.
"""
from __future__ import annotations

import asyncio
import random
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from src.routes.srs import (
    _allocate_mix,
    _eligible_lemma_candidates,
    _feed_seed,
    _page_plan,
    _parse_mix,
    _sentence_match,
)


class TestParseMix:
    def test_parses_the_default_mix(self):
        assert _parse_mix("A2:0,B1:70,B2:20,C1:10") == {
            "A2": 0, "B1": 70, "B2": 20, "C1": 10,
        }

    def test_tolerates_whitespace_and_case(self):
        assert _parse_mix(" b1 : 60 , b2:40 ") == {"B1": 60, "B2": 40}

    def test_rejects_sum_below_100(self):
        with pytest.raises(HTTPException) as e:
            _parse_mix("B1:70,B2:20")
        assert e.value.status_code == 400
        assert "sum to 100" in e.value.detail

    def test_rejects_sum_above_100(self):
        with pytest.raises(HTTPException):
            _parse_mix("B1:70,B2:40")

    def test_rejects_unknown_level(self):
        # A1 is deliberately outside the feed's addressable levels.
        with pytest.raises(HTTPException):
            _parse_mix("A1:100")

    def test_rejects_non_numeric_share(self):
        with pytest.raises(HTTPException):
            _parse_mix("B1:lots")

    def test_rejects_empty(self):
        with pytest.raises(HTTPException):
            _parse_mix("")


class TestAllocateMix:
    def test_default_mix_page_of_twenty(self):
        # The worked example from the spec: 70/20/10 over 20 slots.
        plenty = {"B1": 500, "B2": 500, "C1": 500}
        assert _allocate_mix({"B1": 70, "B2": 20, "C1": 10}, 20, plenty) == {
            "B1": 14, "B2": 4, "C1": 2,
        }

    def test_page_always_totals_the_limit_when_stock_allows(self):
        plenty = {"A2": 500, "B1": 500, "B2": 500, "C1": 500}
        # 33/33/34 over 20 doesn't divide evenly — largest remainder decides.
        counts = _allocate_mix({"A2": 33, "B1": 33, "B2": 34}, 20, plenty)
        assert sum(counts.values()) == 20

    def test_zero_share_levels_are_dropped(self):
        plenty = {"A2": 50, "B1": 50}
        assert "A2" not in _allocate_mix({"A2": 0, "B1": 100}, 10, plenty)

    def test_exhausted_bucket_redistributes_to_remaining(self):
        # C1 can only supply 1 of its 2 slots; the missing slot goes to the
        # largest requested share (B1), not silently dropped.
        stock = {"B1": 500, "B2": 500, "C1": 1}
        counts = _allocate_mix({"B1": 70, "B2": 20, "C1": 10}, 20, stock)
        assert counts["C1"] == 1
        assert sum(counts.values()) == 20
        assert counts["B1"] == 15

    def test_redistribution_cascades_when_first_receiver_also_caps(self):
        # B1 wants 14 but holds 2; B2 absorbs what it can, then C1 takes
        # the rest. A single redistribution pass would leave the page short.
        stock = {"B1": 2, "B2": 6, "C1": 500}
        counts = _allocate_mix({"B1": 70, "B2": 20, "C1": 10}, 20, stock)
        assert counts["B1"] == 2
        assert counts["B2"] == 6
        assert counts["C1"] == 12
        assert sum(counts.values()) == 20

    def test_page_is_short_only_when_everything_is_drained(self):
        stock = {"B1": 3, "B2": 1, "C1": 0}
        counts = _allocate_mix({"B1": 70, "B2": 20, "C1": 10}, 20, stock)
        assert sum(counts.values()) == 4

    def test_empty_stock_yields_nothing(self):
        assert _allocate_mix({"B1": 100}, 20, {"B1": 0}) == {}

    def test_zero_limit_yields_nothing(self):
        assert _allocate_mix({"B1": 100}, 0, {"B1": 500}) == {}


class TestPagePlan:
    def test_proportions_hold_across_three_pages(self):
        requested = {"B1": 70, "B2": 20, "C1": 10}
        stock = {"B1": 500, "B2": 500, "C1": 500}
        for page in range(3):
            cursors, applied = _page_plan(requested, 20, stock, page)
            assert applied == {"B1": 14, "B2": 4, "C1": 2}
            # Each page starts exactly where the previous one stopped.
            assert cursors == {"B1": 14 * page, "B2": 4 * page, "C1": 2 * page}

    def test_pages_do_not_overlap(self):
        requested = {"B1": 70, "B2": 20, "C1": 10}
        stock = {"B1": 500, "B2": 500, "C1": 500}
        seen: set[tuple[str, int]] = set()
        for page in range(5):
            cursors, applied = _page_plan(requested, 20, stock, page)
            for lvl, n in applied.items():
                for i in range(cursors[lvl], cursors[lvl] + n):
                    assert (lvl, i) not in seen, f"{lvl}#{i} served twice"
                    seen.add((lvl, i))
        assert len(seen) == 100

    def test_page_plan_is_stable_for_the_same_inputs(self):
        # Same user + same day = same stock, so re-requesting a page must
        # return the identical slice (the feed pages, it doesn't re-roll).
        requested = {"B1": 70, "B2": 20, "C1": 10}
        stock = {"B1": 40, "B2": 9, "C1": 3}
        first = _page_plan(requested, 20, stock, 2)
        second = _page_plan(requested, 20, stock, 2)
        assert first == second

    def test_later_pages_absorb_a_bucket_that_ran_dry(self):
        # C1 holds 3: page 0 takes 2, page 1 takes the last 1 and tops up
        # from B1 to stay a full page.
        requested = {"B1": 70, "B2": 20, "C1": 10}
        stock = {"B1": 500, "B2": 500, "C1": 3}
        _, page0 = _page_plan(requested, 20, stock, 0)
        cursors, page1 = _page_plan(requested, 20, stock, 1)
        assert page0["C1"] == 2
        assert cursors["C1"] == 2
        assert page1["C1"] == 1
        assert sum(page1.values()) == 20


class TestFeedSeed:
    """The client mints a token per cold start; the feed's order follows it."""

    def test_same_token_gives_the_same_order(self):
        # Paging depends on this: `offset` addresses a stable sequence only
        # while every page of a session hashes to the same seed.
        assert _feed_seed(7, "abc123") == _feed_seed(7, "abc123")

    def test_a_new_token_deals_a_new_deck(self):
        assert _feed_seed(7, "abc123") != _feed_seed(7, "def456")

    def test_two_users_sharing_a_token_still_differ(self):
        assert _feed_seed(7, "abc123") != _feed_seed(8, "abc123")

    def test_no_token_falls_back_to_the_utc_day(self):
        # Older clients send nothing and keep the original behaviour:
        # stable for the day, reshuffled overnight.
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        assert _feed_seed(7, None) == _feed_seed(7, day)

    def test_empty_token_is_treated_as_absent(self):
        assert _feed_seed(7, "") == _feed_seed(7, None)

    def test_is_seedable_by_random(self):
        # The route feeds this straight into random.Random(...), which needs
        # a hashable, deterministic value.
        seed = _feed_seed(7, "abc123")
        first = random.Random(f"{seed}:B1")
        second = random.Random(f"{seed}:B1")
        assert first.random() == second.random()


class TestSentenceMatch:
    def test_finds_the_inflected_form_not_the_lemma(self):
        s = "She lingered by the door."
        assert _sentence_match(s, "lingered", "linger") == {"start": 4, "end": 12}

    def test_offsets_slice_back_to_the_matched_text(self):
        s = "She was reluctant to admit that she had made a mistake."
        m = _sentence_match(s, "reluctant", "reluctant")
        assert s[m["start"]:m["end"]] == "reluctant"

    def test_falls_back_to_the_lemma_when_no_matched_form(self):
        s = "A reluctant guest."
        assert _sentence_match(s, None, "reluctant") == {"start": 2, "end": 11}

    def test_is_case_insensitive(self):
        s = "Reluctant to move, he stayed."
        assert _sentence_match(s, "reluctant", "reluctant") == {"start": 0, "end": 9}

    def test_respects_word_boundaries(self):
        # "art" must not light up inside "start".
        s = "We start the art class."
        assert _sentence_match(s, "art", "art") == {"start": 13, "end": 16}

    def test_returns_none_when_the_form_is_absent(self):
        assert _sentence_match("Nothing to see here.", "absent", "absent") is None

    def test_does_not_crash_on_regex_metacharacters(self):
        # A matched_form with regex syntax must be escaped, not compiled.
        assert _sentence_match("Cost (net) rose.", "(net)", "net") == {"start": 5, "end": 10}


class _RecordingDb:
    """Captures the SQL `_eligible_lemma_candidates` builds."""

    def __init__(self):
        self.sql = ""
        self.args: tuple = ()

    async def query_raw(self, sql, *args):
        self.sql = sql
        self.args = args
        return []


class TestEligibleCandidatesQuery:
    def _run(self, **kwargs):
        db = _RecordingDb()
        asyncio.run(_eligible_lemma_candidates(db, ["B1", "B2"], **kwargs))
        return db

    def test_always_filters_hidden_words_and_requires_an_llm_sentence(self):
        db = self._run()
        assert "hidden_words" in db.sql
        assert "sb.movie_id IS NULL" in db.sql
        assert "sb.source = 'llm'" in db.sql
        # Real-word shape guard, shared with /today.
        assert "^[a-zA-Z]+$" in db.sql

    def test_scopes_to_the_requested_levels(self):
        db = self._run()
        assert "'B1','B2'" in db.sql

    def test_excludes_the_users_saved_and_learned_words(self):
        db = self._run(exclude_user_id=42)
        assert "user_words" in db.sql
        assert "uw.user_id = $1" in db.sql
        # The user id is parameterised, never interpolated.
        assert db.args == (42,)

    def test_today_path_does_not_exclude_user_words(self):
        # /today deliberately keeps showing words you've saved.
        db = self._run()
        assert "user_words" not in db.sql
        assert db.args == ()
