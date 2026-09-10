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

from src.services.cefr_registry import TEACHABLE_FREQUENCY_CEILING
from src.services.feed_pool import (
    FEED_MIN_LEMMA_LENGTH,
    FEED_MIX_LEVELS,
    feed_eligibility_sql,
    feed_pool_by_level,
    real_word_sql,
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

    def test_does_not_scope_to_a_band(self):
        # Level scoping belongs to the caller: /today asks for the user's band,
        # /feed for whatever the mix names, the report for all of them. So the
        # fragment may not privilege one level over another.
        #
        # Originally that was "no servable level appears as a literal at all".
        # `plausible_frequency_sql` broke the letter of it while keeping the
        # intent: its CASE names every level, but to give each its own rarity
        # ceiling, not to restrict the query to any of them. So the assertion
        # is now symmetry — mention all six or none. A fragment that named
        # only A1, which is what scoping would actually look like, still fails.
        #
        # `cefr_level` also appears via trusted_registry_sql's `<> 'UNKNOWN'`.
        # That is not scoping either: UNKNOWN is the "could not classify"
        # holding pen (#91), never one of FEED_MIX_LEVELS, so no caller can
        # ever ask for it.
        frag = feed_eligibility_sql("l")
        named = [level for level in FEED_MIX_LEVELS if f"'{level}'" in frag]
        assert named in ([], FEED_MIX_LEVELS), (
            f"fragment names {named} but not every level — that is scoping"
        )

    def test_excludes_words_far_rarer_than_their_level(self):
        # Every level collects a rare tail nothing should teach: `souk` and
        # `carbuncle` at A1, `bastinado` and `mizzenmast` at C2. They arrive
        # from at least four unrelated causes, so the guard is on the output.
        frag = feed_eligibility_sql("l")
        assert "frequency_rank" in frag
        for level, ceiling in TEACHABLE_FREQUENCY_CEILING.items():
            assert f"WHEN '{level}' THEN {ceiling}" in frag

    def test_a_missing_frequency_rank_is_not_a_reason_to_hide_a_word(self):
        # "No frequency for this word" is the absence of evidence. Turning that
        # into a teaching decision is precisely the Zipf=0 mistake that put 684
        # dictionary-scrape words into the B2 deck.
        assert "frequency_rank IS NULL OR" in feed_eligibility_sql("l")

    def test_requires_a_level_something_actually_graded(self):
        # The quiz applied trusted_registry_sql and the feed did not, so the
        # feed served 3,850 A2 cards on 2026-09-06 whose "grade" was the old
        # populate_lemma_registry A2 default — `disport`, `pumpernickel`,
        # `unbreached`. One predicate, or they drift again.
        frag = feed_eligibility_sql("l")
        assert "l.cefr_level <> 'UNKNOWN'" in frag
        assert "l.source = 'fallback' AND l.confidence < 0.5" in frag


class TestRealWordSplit:
    """`real_word_sql` was split out for the quiz's distractor pool, which
    needs a word to be printable but not to be teachable. It is a split, not a
    second definition — so the feed's fragment must still be a strict superset
    of it, or the two drift apart and #116's guarantee quietly dies."""

    def test_feed_fragment_still_contains_everything_real_word_does(self):
        assert real_word_sql("l").strip() in feed_eligibility_sql("l")

    def test_real_word_keeps_shape_and_curation(self):
        frag = real_word_sql("l")
        assert "^[a-zA-Z]+$" in frag
        assert f"length(l.lemma) >= {FEED_MIN_LEMMA_LENGTH}" in frag
        assert "hidden_words" in frag

    def test_real_word_drops_only_the_sentence_requirement(self):
        # The distractor pool would be shrunk to the feed's few thousand
        # lemmas by this test, putting the option repetition straight back.
        assert "sll.is_global" not in real_word_sql("l")
        assert "sll.is_global" in feed_eligibility_sql("l")

    def test_alias_is_honoured(self):
        assert "cand.lemma" in real_word_sql("cand")


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


#: Modules that put a GRADED word in front of a user — the feed's cards, the
#: quiz's decks, the distractor tiles. Each must reach `lemmas` through a
#: shared fragment that carries the trust test, never a hand-written WHERE.
#:
#: Deliberately not every reader of the table. Admin panels and
#: vocab_coverage count the untrusted rows on purpose (that is the metric),
#: and the enrichment workers decide what to SPEND on rather than what to
#: show. The three below are the ones whose output a learner reads as "this
#: word is B1", which is the claim the trust test protects.
_WORD_SERVING_MODULES = (
    ("routes", "srs.py"),
    ("routes", "quiz.py"),
    ("services", "distractor_pool.py"),
)

_TRUST_CARRYING_FRAGMENTS = (
    "trusted_registry_sql",
    "real_word_sql",
    "feed_eligibility_sql",
)


def test_word_serving_readers_cannot_hand_roll_the_trust_test():
    """The feed served ungraded A2 cards for months because it built its own
    WHERE clause while the quiz called `trusted_registry_sql` — same table,
    same question, two answers (2026-09-06: 3,850 rows, 56% of the level)."""
    src = Path(__file__).resolve().parents[1] / "src"

    for parts in _WORD_SERVING_MODULES:
        path = src.joinpath(*parts)
        text = path.read_text()
        if "FROM lemmas" not in text:
            continue
        assert any(frag in text for frag in _TRUST_CARRYING_FRAGMENTS), (
            f"{'/'.join(parts)} reads `lemmas` to serve words but references "
            f"none of {_TRUST_CARRYING_FRAGMENTS}. A hand-written WHERE will "
            f"serve rows nothing ever graded — see feed_pool.real_word_sql."
        )


def test_the_trust_test_is_reachable_from_the_feed_fragment():
    """Not just imported somewhere in the module — actually composed in."""
    from src.services.cefr_registry import trusted_registry_sql

    assert trusted_registry_sql("l") in feed_eligibility_sql("l")
    assert trusted_registry_sql("l") in real_word_sql("l")
