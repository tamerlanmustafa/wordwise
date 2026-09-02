"""
The wide distractor pool: where a quiz card's wrong answers come from.

No DB and no network. `build_pool` is exercised against a fake that records
the two calls it makes, because the two properties worth protecting are
structural: it must never reach a translation API, and it must never offer a
deck word back as a wrong answer.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from src.services.distractor_pool import (
    CANDIDATES_PER_BUCKET,
    MAX_CANDIDATES,
    build_pool,
    pool_for,
)

pytestmark = pytest.mark.asyncio


class FakeDb:
    """Records `query_raw` SQL + args and serves canned candidate/cache rows."""

    def __init__(self, candidates=None, cached=None, raise_on=None):
        self._candidates = candidates or []
        self._cached = cached or []
        self._raise_on = raise_on or set()
        self.sql: list[str] = []
        self.args: list[tuple] = []
        self.cache_where: list[dict] = []
        self.translationcache = SimpleNamespace(find_many=self._find_many)

    async def query_raw(self, sql, *args):
        if "query_raw" in self._raise_on:
            raise RuntimeError("boom")
        self.sql.append(sql)
        self.args.append(args)
        return list(self._candidates)

    async def _find_many(self, where=None, **_kw):
        if "cache" in self._raise_on:
            raise RuntimeError("boom")
        self.cache_where.append(where or {})
        return list(self._cached)


def candidate(lemma, pos, level):
    return {"lemma": lemma, "pos": pos, "cefr_level": level}


def cache_row(source_text, translated):
    return SimpleNamespace(sourceText=source_text, translated=translated)


class TestBuildPool:
    async def test_buckets_by_pos_and_level(self):
        db = FakeDb(
            candidates=[
                candidate("linger", "VERB", "B2"),
                candidate("ponder", "VERB", "B2"),
                candidate("kettle", "NOUN", "B2"),
            ],
            cached=[
                cache_row("linger", "demorarse"),
                cache_row("ponder", "reflexionar"),
                cache_row("kettle", "hervidor"),
            ],
        )
        pool = await build_pool(
            db, target_lang="ES",
            buckets=[("VERB", "B2"), ("NOUN", "B2")],
            exclude_lemmas=[],
        )
        assert pool[("VERB", "B2")] == ["demorarse", "reflexionar"]
        assert pool[("NOUN", "B2")] == ["hervidor"]

    async def test_only_cached_translations_survive(self):
        # This is the cost model: an uncached candidate is simply not a
        # candidate. Nothing here may ever reach a translation provider.
        db = FakeDb(
            candidates=[
                candidate("linger", "VERB", "B2"),
                candidate("ponder", "VERB", "B2"),
            ],
            cached=[cache_row("linger", "demorarse")],
        )
        pool = await build_pool(
            db, target_lang="ES", buckets=[("VERB", "B2")], exclude_lemmas=[],
        )
        assert pool == {("VERB", "B2"): ["demorarse"]}

    async def test_exactly_two_reads_and_no_more(self):
        db = FakeDb(
            candidates=[candidate("linger", "VERB", "B2")],
            cached=[cache_row("linger", "demorarse")],
        )
        await build_pool(
            db, target_lang="ES", buckets=[("VERB", "B2")], exclude_lemmas=[],
        )
        assert len(db.sql) == 1
        assert len(db.cache_where) == 1

    async def test_deck_words_are_excluded_in_sql(self):
        # A card's answer must never be another card's wrong answer, and the
        # cheapest place to enforce that is before the rows come back.
        db = FakeDb(candidates=[], cached=[])
        await build_pool(
            db, target_lang="ES", buckets=[("VERB", "B2")],
            exclude_lemmas=["Linger", "PONDER"],
        )
        assert db.args[0][1] == ["linger", "ponder"]

    async def test_cache_read_is_scoped_to_the_target_language(self):
        db = FakeDb(
            candidates=[candidate("linger", "VERB", "B2")],
            cached=[cache_row("linger", "demorarse")],
        )
        await build_pool(
            db, target_lang="tr", buckets=[("VERB", "B2")], exclude_lemmas=[],
        )
        assert db.cache_where[0]["targetLang"] == "TR"

    async def test_english_natives_get_no_pool(self):
        # Translating en->en is gibberish, so their deck has no translations
        # to build a grid from at all — don't spend two queries discovering it.
        db = FakeDb(candidates=[candidate("linger", "VERB", "B2")])
        assert await build_pool(
            db, target_lang="EN", buckets=[("VERB", "B2")], exclude_lemmas=[],
        ) == {}
        assert db.sql == []

    async def test_untagged_or_unplaced_cards_are_skipped(self):
        # ~14% of the registry has a NULL pos. A (None, None) bucket would
        # match everything, which is not a distractor rule.
        db = FakeDb(candidates=[])
        assert await build_pool(
            db, target_lang="ES",
            buckets=[(None, "B2"), ("VERB", None), (None, None)],
            exclude_lemmas=[],
        ) == {}
        assert db.sql == []

    async def test_candidate_query_failure_degrades_to_empty(self):
        # A pool failure must cost choice variety, never the session.
        db = FakeDb(raise_on={"query_raw"})
        assert await build_pool(
            db, target_lang="ES", buckets=[("VERB", "B2")], exclude_lemmas=[],
        ) == {}

    async def test_cache_failure_degrades_to_empty(self):
        db = FakeDb(
            candidates=[candidate("linger", "VERB", "B2")],
            raise_on={"cache"},
        )
        assert await build_pool(
            db, target_lang="ES", buckets=[("VERB", "B2")], exclude_lemmas=[],
        ) == {}

    async def test_per_bucket_cap_is_bounded(self):
        db = FakeDb(candidates=[], cached=[])
        await build_pool(
            db, target_lang="ES",
            buckets=[(p, "B2") for p in ("VERB", "NOUN", "ADJ", "ADV")],
            exclude_lemmas=[],
        )
        sql = db.sql[0]
        assert "row_number() OVER" in sql
        assert "PARTITION BY l.cefr_level, l.pos" in sql
        cap = int(sql.split("WHERE rn <=")[1].split()[0].rstrip(")"))
        assert 1 <= cap <= CANDIDATES_PER_BUCKET
        assert cap * 4 <= MAX_CANDIDATES

    async def test_level_is_compared_bare_not_cast(self):
        # Casting the column strips the Index Cond and mis-plans the row
        # estimate — the #118 trap, which lint cannot catch.
        db = FakeDb(candidates=[], cached=[])
        await build_pool(
            db, target_lang="ES", buckets=[("VERB", "B2")], exclude_lemmas=[],
        )
        where = db.sql[0].split("WHERE")[1]
        assert "l.cefr_level IN ('B2')" in where
        assert "cefr_level::text IN" not in where

    async def test_hidden_words_are_never_offered_as_options(self):
        # hidden_words is where profanity and junk lemmas live. A distractor
        # is printed on a tile, so it goes through the same curation.
        db = FakeDb(candidates=[], cached=[])
        await build_pool(
            db, target_lang="ES", buckets=[("VERB", "B2")], exclude_lemmas=[],
        )
        assert "hidden_words" in db.sql[0]


class TestPoolFor:
    POOL = {
        ("VERB", "B2"): ["demorarse"],
        ("VERB", "C1"): ["reflexionar"],
        ("NOUN", "B2"): ["hervidor"],
    }

    def test_exact_bucket_wins(self):
        assert pool_for(self.POOL, "VERB", "B2") == ["demorarse"]

    def test_falls_back_to_same_pos_other_level(self):
        # A B1 verb's options being C1 verbs is a fair grid; being nouns is not.
        assert set(pool_for(self.POOL, "VERB", "A1")) == {"demorarse", "reflexionar"}

    def test_falls_back_to_same_level_other_pos(self):
        # No adjectives cached at all, so level is the only thing left to
        # match on — every B2 bucket contributes, C1 does not.
        assert set(pool_for(self.POOL, "ADJ", "B2")) == {"demorarse", "hervidor"}
        assert "reflexionar" not in pool_for(self.POOL, "ADJ", "B2")

    def test_falls_back_to_everything_before_starving(self):
        # Widening beats starving: a card with no pool reverts to the
        # repetitive deck distractors, which is what this all exists to avoid.
        assert len(pool_for(self.POOL, "ADJ", "A1")) == 3

    def test_empty_pool_is_empty(self):
        assert pool_for({}, "VERB", "B2") == []

    def test_tolerates_missing_pos_and_level(self):
        assert len(pool_for(self.POOL, None, None)) == 3

    def test_matching_is_case_insensitive(self):
        assert pool_for(self.POOL, "verb", "b2") == ["demorarse"]
