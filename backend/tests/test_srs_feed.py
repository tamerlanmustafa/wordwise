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
    _fallback_mix,
    _draw_feed_rows,
    _feed_seed,
    _parse_cursors,
    _parse_mix,
    _proportional_quota,
    _spread_deficit,
    _sentence_match,
)
from src.services.feed_pool import FEED_MIX_LEVELS


class TestParseMix:
    def test_parses_the_default_mix(self):
        assert _parse_mix("A1:0,A2:0,B1:70,B2:20,C1:10,C2:0") == {
            "A1": 0, "A2": 0, "B1": 70, "B2": 20, "C1": 10, "C2": 0,
        }

    def test_tolerates_whitespace_and_case(self):
        assert _parse_mix(" b1 : 60 , b2:40 ") == {"B1": 60, "B2": 40}

    def test_accepts_the_ends_of_the_range(self):
        # The composition bar can drive any single level to 100, including the
        # two the mix used to exclude.
        assert _parse_mix("A1:100") == {"A1": 100}
        assert _parse_mix("C2:100") == {"C2": 100}

    def test_still_accepts_a_four_level_mix_from_an_old_build(self):
        # An install that hasn't taken the update keeps sending four levels.
        assert _parse_mix("A2:0,B1:70,B2:20,C1:10")["B1"] == 70

    def test_rejects_sum_below_100(self):
        with pytest.raises(HTTPException) as e:
            _parse_mix("B1:70,B2:20")
        assert e.value.status_code == 400
        assert "sum to 100" in e.value.detail

    def test_rejects_sum_above_100(self):
        with pytest.raises(HTTPException):
            _parse_mix("B1:70,B2:40")

    def test_rejects_unknown_level(self):
        # The mix spans A1–C2; anything else is not a CEFR level.
        with pytest.raises(HTTPException):
            _parse_mix("D1:100")
        with pytest.raises(HTTPException):
            _parse_mix("UNKNOWN:100")

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

    def test_mix_applied_never_names_a_level_the_user_zeroed(self):
        # The six-level panel sends every level, most of them at 0. A level the
        # user dialled to nothing must never appear in the page, however short
        # the ones they asked for turn out to be — redistribution stays inside
        # the mix. (The route's last-resort fallback is the one exception, and
        # it rewrites `requested` before ever reaching here.)
        mix = {"A1": 0, "A2": 0, "B1": 60, "B2": 40, "C1": 0, "C2": 0}
        stock = {lvl: 500 for lvl in FEED_MIX_LEVELS}
        stock["B1"] = 1
        counts = _allocate_mix(mix, 20, stock)
        assert set(counts) == {"B1", "B2"}
        assert sum(counts.values()) == 20

    def test_single_level_mix_takes_the_whole_page(self):
        for level in FEED_MIX_LEVELS:
            counts = _allocate_mix({level: 100}, 20, {level: 500})
            assert counts == {level: 20}

    def test_single_level_mix_that_runs_dry_reports_the_truth(self):
        # Nothing to redistribute to — the page is short and says so, rather
        # than quietly serving a level the user did not ask for.
        assert _allocate_mix({"C2": 100}, 20, {"C2": 5}) == {"C2": 5}


class TestFallbackMix:
    """The route's last resort: every level the user's mix names is empty for
    them. An empty Explore tab is a worse answer than a page off-mix."""

    def test_offers_the_levels_the_user_did_not_ask_for(self):
        spare, mix = _fallback_mix(["C2"])
        assert spare == ["A1", "A2", "B1", "B2", "C1"]
        assert sum(mix.values()) == 100
        assert "C2" not in mix

    def test_fills_a_whole_page_from_the_spare_levels(self):
        # The point of the fallback: a full page, and a mix_applied that names
        # where the cards actually came from.
        spare, mix = _fallback_mix(["A1"])
        counts = _allocate_mix(mix, 20, {lvl: 500 for lvl in spare})
        assert sum(counts.values()) == 20
        assert "A1" not in counts

    def test_survives_a_spare_set_that_does_not_divide_evenly(self):
        for asked in (["A1"], ["A1", "A2"], ["A1", "A2", "B1"], ["C1", "C2"]):
            _, mix = _fallback_mix(asked)
            assert sum(mix.values()) == 100

    def test_has_nothing_to_offer_when_the_mix_spans_everything(self):
        # A mix naming all six levels that is *still* empty means the user has
        # read the entire pool — there is no honest fallback, and the feed says
        # so rather than inventing one.
        assert _fallback_mix(list(FEED_MIX_LEVELS)) == ([], {})


class TestProportionalQuota:
    """Round one of a page: shares only, no stock count.

    Asking "how many B1 words are left for this user" is precisely the
    4,000-row scan the keyset rewrite exists to delete, so the first draw
    allocates blind and `_spread_deficit` handles whatever came back short.
    """

    def test_default_mix_page_of_twenty(self):
        assert _proportional_quota({"B1": 70, "B2": 20, "C1": 10}, 20) == {
            "B1": 14, "B2": 4, "C1": 2,
        }

    def test_always_totals_the_limit(self):
        # Largest-remainder, so a mix that does not divide evenly still fills
        # the page rather than handing back nineteen cards.
        assert sum(_proportional_quota({"A2": 33, "B1": 33, "B2": 34}, 20).values()) == 20

    def test_drops_levels_with_no_share(self):
        assert "A2" not in _proportional_quota({"A2": 0, "B1": 100}, 10)

    def test_does_not_clamp_to_anything(self):
        # The distinction from `_allocate_mix`: nothing here knows or cares
        # how deep a level is.
        assert _proportional_quota({"C2": 100}, 50) == {"C2": 50}


class TestSpreadDeficit:
    """Round two: a level came back short, so its slots go to the others."""

    def test_hands_every_unfilled_slot_out(self):
        assert sum(_spread_deficit(6, ["B1", "B2"]).values()) == 6

    def test_deals_round_robin_from_the_largest_share_first(self):
        # Receivers arrive ordered by share, so an odd slot lands on the
        # dominant level rather than a thin one.
        assert _spread_deficit(3, ["B1", "B2"]) == {"B1": 2, "B2": 1}

    def test_nobody_to_receive_means_a_short_page(self):
        # Every level dry. A short page is the honest answer; looping to find
        # more would not find any.
        assert _spread_deficit(5, []) == {}

    def test_nothing_to_spread_is_a_no_op(self):
        assert _spread_deficit(0, ["B1"]) == {}


class TestParseCursors:
    """The keyset position, one hash per level."""

    def test_parses_a_cursor_per_level(self):
        assert _parse_cursors("B1:9f3a,B2:41c0") == {"B1": "9f3a", "B2": "41c0"}

    def test_tolerates_whitespace_and_case(self):
        assert _parse_cursors(" b1 : 9f3a ") == {"B1": "9f3a"}

    def test_absent_means_start_from_the_beginning(self):
        assert _parse_cursors(None) == {}
        assert _parse_cursors("") == {}

    def test_drops_junk_rather_than_rejecting_the_request(self):
        # A cursor is a position, not an instruction. The worst a bad one can
        # do is restart that level, and a 400 would strand a client that has
        # no way to build a valid cursor except by asking us for one.
        assert _parse_cursors("B1:zzz,B2:41c0") == {"B2": "41c0"}
        assert _parse_cursors("NOPE:41c0") == {}
        assert _parse_cursors("B1:") == {}

    def test_survives_a_malformed_string_entirely(self):
        assert _parse_cursors("garbage") == {}


class TestDrawFeedRows:
    """The SQL the page is actually drawn with."""

    class _Db:
        def __init__(self):
            self.sql = ""
            self.args: tuple = ()

        async def query_raw(self, sql, *args):
            self.sql, self.args = sql, args
            return []

    async def _draw(self, quota, cursors=None):
        db = self._Db()
        await _draw_feed_rows(
            db, quota=quota, order_seed="7:tok", cursors=cursors or {}, user_id=7
        )
        return db

    async def test_one_branch_per_level_with_its_own_limit(self):
        db = await self._draw({"B1": 14, "B2": 4})

        assert db.sql.count("UNION ALL") == 1
        assert "LIMIT 14" in db.sql and "LIMIT 4" in db.sql

    async def test_orders_and_seeks_by_the_same_hash_expression(self):
        # If the ORDER BY and the keyset predicate ever disagree, the cursor
        # stops naming a position in the ordering and pages start overlapping.
        db = await self._draw({"B1": 14})

        assert "ORDER BY md5(l.id::text || ':' || $2)" in db.sql
        assert "md5(l.id::text || ':' || $2) > $3" in db.sql

    async def test_seeds_cursors_and_user_are_all_parameterised(self):
        db = await self._draw({"B1": 14}, {"B1": "9f3a"})

        assert db.args == (7, "7:tok", "9f3a")
        assert "9f3a" not in db.sql

    async def test_a_level_with_no_cursor_starts_from_the_beginning(self):
        db = await self._draw({"B1": 14})
        assert db.args[2] == ""

    async def test_never_offsets(self):
        # The whole point. An OFFSET would reintroduce both the cost that
        # grows with depth and the instability under a shrinking pool.
        db = await self._draw({"B1": 14, "C1": 2})
        assert "OFFSET" not in db.sql.upper()

    async def test_still_excludes_the_user_s_own_words(self):
        db = await self._draw({"B1": 14})
        assert "user_words uw" in db.sql and "uw.user_id = $1" in db.sql

    async def test_zero_quota_levels_are_not_queried(self):
        db = await self._draw({"B1": 20, "C2": 0})
        assert "'C2'" not in db.sql

    async def test_an_empty_quota_asks_nothing_at_all(self):
        db = self._Db()
        rows = await _draw_feed_rows(
            db, quota={}, order_seed="7:tok", cursors={}, user_id=7
        )
        assert rows == [] and db.sql == ""


class TestFeedSeed:
    """The client mints a token per cold start; the feed's order follows it."""

    def test_same_token_gives_the_same_order(self):
        # Paging depends on this: a cursor addresses a stable sequence only
        # while every page of a session is ordered by the same key.
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

    def test_is_a_string_postgres_can_concatenate(self):
        # It is interpolated into `md5(l.id::text || ':' || $2)` as a bound
        # parameter, so it has to survive as text rather than an int.
        assert isinstance(_feed_seed(7, "abc123"), str)


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
    def _run(self, levels=("B1", "B2"), **kwargs):
        db = _RecordingDb()
        asyncio.run(_eligible_lemma_candidates(db, list(levels), **kwargs))
        return db

    def test_always_filters_hidden_words_and_requires_an_llm_sentence(self):
        db = self._run()
        assert "hidden_words" in db.sql
        # #120: the "has a Haiku sentence" test is the denormalized flag on the
        # link, never a join to sentence_bank — the join rebuilt the whole
        # global-LLM set on every feed request (145,783 of 150,441 buffers).
        assert "sll.is_global" in db.sql
        assert "sentence_bank" not in db.sql
        # Real-word shape guard, shared with /today and the coverage report
        # (#116) — see tests/test_feed_pool.py for the fragment itself.
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


class TestCandidateCapIsPerLevel:
    """#116: the row cap must not be one global frequency-ordered LIMIT.

    frequency_rank correlates with CEFR level, so a global cap hands every slot
    to the easiest level in the band. Measured on prod: the feed's 4,000-row cap
    over A2+B1+B2+C1 returned 1,499 A2 / 1,417 B1 / 1,084 B2 and zero of C1's
    8,552 eligible lemmas, so the C1 bucket was empty and _page_plan quietly
    redistributed the user's requested C1 share to easier levels.
    """

    def _run(self, levels, **kwargs):
        db = _RecordingDb()
        asyncio.run(_eligible_lemma_candidates(db, list(levels), **kwargs))
        return db

    def test_cap_is_partitioned_by_level(self):
        sql = self._run(["A2", "B1", "B2", "C1"], limit=4000).sql
        assert "PARTITION BY l.cefr_level" in sql
        # A bare LIMIT would reintroduce the global cap this replaced.
        assert "LIMIT" not in sql.upper()

    def test_budget_is_split_evenly_across_the_requested_levels(self):
        assert "rn <= 1000" in self._run(["A2", "B1", "B2", "C1"], limit=4000).sql
        assert "rn <= 2000" in self._run(["B2", "C1"], limit=4000).sql
        # /today's default budget over its two-level band.
        assert "rn <= 1000" in self._run(["B1", "B2"], limit=2000).sql

    def test_a_tiny_budget_still_asks_each_level_for_something(self):
        # Integer division must not floor a level's allowance to zero, which
        # would return an empty pool rather than a small one.
        assert "rn <= 1" in self._run(["A2", "B1", "B2", "C1"], limit=2).sql

    def test_order_is_deterministic_so_word_of_the_hour_holds_still(self):
        # /today indexes into this list by a per-hour seed. frequency_rank has
        # ties, so without the id tiebreak the same hour could return a
        # different word on every call.
        sql = self._run(["B1", "B2"]).sql
        assert "ORDER BY frequency_rank ASC NULLS LAST, lemma_id" in sql
