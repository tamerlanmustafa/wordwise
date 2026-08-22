"""
Unit tests for services/feed_pool.py — the one definition of "a lemma the
Explore feed may deal".

Two things are worth pinning: the fragment itself (it is interpolated into two
different queries, so its shape is a contract), and the fact that both call
sites actually use it. A metric computed from a slightly different WHERE clause
than the feed's would report depth the feed cannot serve, which is precisely
what the metric exists to detect (issue #116).
"""
from __future__ import annotations

from pathlib import Path

from src.services.feed_pool import (
    FEED_MIN_LEMMA_LENGTH,
    FEED_MIX_LEVELS,
    feed_eligibility_sql,
    feed_pool_by_level,
)


class _RecordingDb:
    def __init__(self, rows=None):
        self.sql = ""
        self.args: tuple = ()
        self._rows = rows or []

    async def query_raw(self, sql, *args):
        self.sql = sql
        self.args = args
        return self._rows


# ── the fragment ─────────────────────────────────────────────────────────────

class TestEligibilityFragment:
    def test_covers_shape_curation_and_a_readable_sentence(self):
        frag = feed_eligibility_sql("l")
        assert "^[a-zA-Z]+$" in frag
        assert f"length(l.lemma) >= {FEED_MIN_LEMMA_LENGTH}" in frag
        assert "hidden_words" in frag
        # #120: the "has a Haiku sentence" test is the denormalized flag on the
        # link, never a join to sentence_bank.
        assert "sll.is_global" in frag
        assert "sentence_bank" not in frag

    def test_hidden_words_stays_a_correlated_case_insensitive_probe(self):
        # Shared with the sentence worker's fragment (#129): a NOT IN has to
        # read all ~34k rows to build its hash, and a case-sensitive compare
        # silently fails to hide a word stored with capitals.
        frag = feed_eligibility_sql("l")
        assert "LOWER(hw.word) = LOWER(l.lemma)" in frag
        assert "NOT IN" not in frag

    def test_alias_is_honoured(self):
        frag = feed_eligibility_sql("cand")
        assert "cand.lemma" in frag
        assert "sll.lemma_id = cand.id" in frag

    def test_does_not_filter_by_level(self):
        # Level scoping belongs to the caller: /today asks for the user's band,
        # /feed for whatever the mix names, the report for all of them.
        frag = feed_eligibility_sql("l")
        assert "cefr_level" not in frag


# ── the pool count ───────────────────────────────────────────────────────────

class TestFeedPoolByLevel:
    async def test_counts_every_addressable_level_by_default(self):
        db = _RecordingDb([{"level": lvl, "n": 100} for lvl in FEED_MIX_LEVELS])
        counts = await feed_pool_by_level(db)
        assert set(counts) == set(FEED_MIX_LEVELS)
        for lvl in FEED_MIX_LEVELS:
            assert f"'{lvl}'" in db.sql

    async def test_a_drained_level_reports_zero_not_absent(self):
        # GROUP BY returns no row for an empty level. Dropping the key would
        # hide the exact failure this metric exists to catch.
        db = _RecordingDb([{"level": "A2", "n": 5}])
        counts = await feed_pool_by_level(db, ["A2", "C1"])
        assert counts == {"A2": 5, "C1": 0}

    async def test_ignores_levels_it_did_not_ask_for(self):
        db = _RecordingDb([{"level": "A2", "n": 5}, {"level": "C2", "n": 9}])
        assert await feed_pool_by_level(db, ["A2"]) == {"A2": 5}

    async def test_is_not_scoped_to_a_user(self):
        # This is global stock; the answer must not depend on who is asking.
        db = _RecordingDb([])
        await feed_pool_by_level(db)
        assert "user_words" not in db.sql
        assert db.args == ()

    async def test_empty_level_list_short_circuits(self):
        db = _RecordingDb([])
        assert await feed_pool_by_level(db, []) == {}
        assert db.sql == ""


# ── drift guards ─────────────────────────────────────────────────────────────

def test_both_call_sites_use_the_shared_definition():
    src = Path(__file__).resolve().parents[1] / "src"

    feed = (src / "routes" / "srs.py").read_text()
    assert "feed_eligibility_sql" in feed, (
        "routes/srs.py builds its own eligibility WHERE clause; use "
        "services.feed_pool.feed_eligibility_sql so the feed and the "
        "coverage metric can't drift."
    )
    assert "^[a-zA-Z]+$" not in feed

    report = (src / "services" / "vocab_coverage.py").read_text()
    assert "feed_pool_by_level" in report
