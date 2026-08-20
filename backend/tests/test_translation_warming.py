"""
Offline warming of the global translation cache (#124).

Two things have to hold or the job is worse than useless:

  1. It must not overspend. DeepL's Free allowance is a hard monthly wall that
     live traffic draws from too, so a run that blows through it turns cold
     cards into 456 errors for real users.
  2. It must key rows exactly the way the read path looks them up. A warmer
     whose normalization drifts from `batch_translate`'s would report every
     text as a miss, buy the whole corpus, store it under keys nobody reads,
     and leave the cache as cold as it found it — while spending everything.

The round-trip test below pins (2) directly: warm a text, then serve it.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from src.services.translation_service import TranslationService, normalize_cache_text
from src.services.translation_warming import (
    TIERS,
    CharBudget,
    WarmStats,
    affordable_languages,
    build_tier_sql,
    select_uncached,
    take_within_budget,
)


class _FakeCacheTable:
    """`db.translationcache`, counting probes so chunking is observable."""

    def __init__(self, rows=None):
        self.rows = list(rows or [])
        self.read_calls = 0
        self.write_calls = 0

    async def find_many(self, where):
        self.read_calls += 1
        wanted = set(where["sourceText"]["in"])
        lang = where["targetLang"]
        return [r for r in self.rows if r.sourceText in wanted and r.targetLang == lang]

    async def find_first(self, where):
        for r in self.rows:
            if r.sourceText == where["sourceText"] and r.targetLang == where["targetLang"]:
                return r
        return None

    async def create_many(self, data, skip_duplicates=False):
        self.write_calls += 1
        for d in data:
            self.rows.append(
                SimpleNamespace(
                    sourceText=d["sourceText"],
                    translated=d["translated"],
                    targetLang=d["targetLang"],
                    sourceLang=d.get("sourceLang"),
                    createdAt=None,
                )
            )
        return len(data)

    async def upsert(self, where, data):
        self.write_calls += 1
        return None


class _FakeDb:
    def __init__(self, rows=None, tier_rows=None):
        self.translationcache = _FakeCacheTable(rows)
        self.tier_rows = tier_rows or {}
        self.queries = []

    async def query_raw(self, sql, *args):
        self.queries.append(sql)
        for tier, rows in self.tier_rows.items():
            if f"-- tier:{tier}" in sql:
                return rows
        return []


def _row(source, translated, lang="TR"):
    return SimpleNamespace(
        sourceText=source, translated=translated, targetLang=lang,
        sourceLang="EN", createdAt=None,
    )


class _RecordingDeepL:
    """Counts requests and the characters they carried."""

    def __init__(self):
        self.calls = []

    @property
    def chars(self) -> int:
        return sum(len(t) for call in self.calls for t in call)

    async def translate_many(self, texts, target_lang, source_lang="auto", context=None):
        self.calls.append(list(texts))
        return [
            {"translated": f"{t}-{target_lang}", "detected_source_lang": "EN"}
            for t in texts
        ]

    async def translate(self, text, target_lang, source_lang="auto", context=None):
        return (await self.translate_many([text], target_lang, source_lang, context))[0]


class TestCharBudget:
    def test_refuses_a_charge_it_cannot_cover(self):
        # All-or-nothing on purpose: a partially paid batch would leave the
        # ledger claiming characters DeepL never billed, or the reverse.
        budget = CharBudget(limit=100)
        budget.spend(80)
        assert not budget.can_afford(21)
        with pytest.raises(ValueError):
            budget.spend(21)
        assert budget.spent == 80

    def test_exhausted_at_the_limit(self):
        budget = CharBudget(limit=10)
        budget.spend(10)
        assert budget.exhausted
        assert budget.remaining == 0


class TestTakeWithinBudget:
    def test_stops_at_the_first_text_that_does_not_fit(self):
        # It must NOT hop over the expensive item to fit a later cheap one.
        # The ordering is a priority — the frequent word comes first — and
        # reordering by size would spend the tail of a run on rare words.
        budget = CharBudget(limit=10)
        batch, cost = take_within_budget(["abcd", "efghijkl", "mn"], budget, 50)
        assert batch == ["abcd"]
        assert cost == 4

    def test_respects_the_per_request_cap(self):
        budget = CharBudget(limit=10_000)
        batch, cost = take_within_budget([f"w{i}" for i in range(120)], budget, 50)
        assert len(batch) == 50
        assert cost == sum(len(t) for t in batch)

    def test_returns_nothing_when_broke(self):
        budget = CharBudget(limit=3)
        assert take_within_budget(["longer-than-three"], budget, 50) == ([], 0)

    def test_cost_is_not_charged_by_the_planner(self):
        # take_within_budget only prices the batch; the caller charges after
        # the work succeeds, so a crash mid-run cannot silently consume budget.
        budget = CharBudget(limit=100)
        take_within_budget(["abcd"], budget, 50)
        assert budget.spent == 0


class TestSelectUncached:
    def test_returns_only_misses_in_priority_order(self):
        db = _FakeDb(rows=[_row("cached", "x", "TR")])
        out = asyncio.run(select_uncached(db, ["cached", "fresh", "later"], "TR"))
        assert out == ["fresh", "later"]

    def test_a_hit_in_another_language_is_still_a_miss(self):
        db = _FakeDb(rows=[_row("word", "x", "ES")])
        assert asyncio.run(select_uncached(db, ["word"], "TR")) == ["word"]

    def test_normalizes_exactly_like_the_write_path(self):
        # The cache stores the normalized form, so the probe has to ask for the
        # normalized form. "He ran home." is stored as "he ran home".
        sentence = "He ran home."
        db = _FakeDb(rows=[_row(normalize_cache_text(sentence), "x", "TR")])
        assert asyncio.run(select_uncached(db, [sentence], "TR")) == []

    def test_dedupes_before_spending(self):
        # A word repeats across the corpus; paying for it twice is pure waste.
        db = _FakeDb()
        out = asyncio.run(select_uncached(db, ["Run", "run", "RUN."], "TR"))
        assert out == ["run"]

    def test_chunks_the_probe(self):
        db = _FakeDb()
        asyncio.run(select_uncached(db, [f"w{i}" for i in range(250)], "TR", chunk=100))
        assert db.translationcache.read_calls == 3

    def test_drops_empty_texts(self):
        db = _FakeDb()
        assert asyncio.run(select_uncached(db, ["", "   ", "real"], "TR")) == ["real"]


class TestWarmedRowsAreServedFromCache:
    """The whole point of the job, asserted end to end."""

    def test_a_warmed_text_costs_the_reader_no_deepl_call(self):
        db = _FakeDb()
        deepl = _RecordingDeepL()
        service = TranslationService(db, deepl_client=deepl)
        corpus = ["Resolve", "He ran home."]

        # Warming pass — the offline job.
        pending = asyncio.run(select_uncached(db, corpus, "TR"))
        asyncio.run(service.batch_translate(pending, "TR", source_lang="en"))
        assert len(deepl.calls) == 1

        # Reading pass — the user's first card, same source text as it appears
        # in the feed (original casing and punctuation, not normalized).
        deepl.calls.clear()
        results = asyncio.run(service.batch_translate(corpus, "TR", source_lang="en"))

        assert deepl.calls == [], "warmed rows must not re-hit DeepL"
        assert all("error" not in r for r in results)
        assert results[0]["translated"] == "resolve-TR"

    def test_a_second_warm_run_is_a_no_op(self):
        # Resumability: the cache is the progress marker, so re-running after
        # an interruption must not re-buy what already landed.
        db = _FakeDb()
        deepl = _RecordingDeepL()
        service = TranslationService(db, deepl_client=deepl)
        corpus = ["alpha", "beta"]

        for _ in range(2):
            pending = asyncio.run(select_uncached(db, corpus, "TR"))
            if pending:
                asyncio.run(service.batch_translate(pending, "TR", source_lang="en"))

        assert deepl.chars == len("alpha") + len("beta")


class TestTierSql:
    def test_every_declared_tier_builds(self):
        for tier in TIERS:
            assert "SELECT" in build_tier_sql(tier)

    def test_unknown_tier_is_rejected(self):
        with pytest.raises(ValueError):
            build_tier_sql("everything")

    def test_pool_tiers_honour_the_pool_limit(self):
        assert "LIMIT 300" in build_tier_sql("pool_lemmas", pool_limit=300)

    def test_pool_sentences_pick_the_sentence_the_feed_shows(self):
        # If this ordering drifts from routes/srs.py the job warms a different
        # sentence than the card renders: characters spent, card still cold.
        sql = build_tier_sql("pool_sentences")
        assert "sll.is_representative DESC" in sql
        assert "sll.score DESC NULLS LAST" in sql
        assert "sll.sentence_id ASC" in sql

    def test_unknown_cefr_is_never_warmed(self):
        # UNKNOWN is a "could not classify" marker (#91), never displayed —
        # translating it would spend characters on unreachable words.
        for tier in ("pool_lemmas", "tail_lemmas"):
            assert "UNKNOWN" not in build_tier_sql(tier)

    def test_lemma_cefr_is_compared_without_a_text_cast(self):
        # `cefr_level::text` hides the column from the planner and disables the
        # index (#118). The pool query must compare the enum bare.
        assert "cefr_level::text" not in build_tier_sql("pool_lemmas")

    def test_hidden_words_are_excluded(self):
        assert "hidden_words" in build_tier_sql("pool_lemmas")


class TestAffordableLanguages:
    def test_reports_how_many_languages_actually_fit(self):
        assert affordable_languages(100, 250, ["TR", "ES", "PT"]) == ["TR", "ES"]

    def test_none_fit_when_one_language_exceeds_the_remainder(self):
        assert affordable_languages(874_000, 412_000, ["TR"]) == []


class TestWarmStats:
    def test_totals_roll_up_per_tier(self):
        stats = WarmStats()
        stats.record("pool_lemmas", 10, 80)
        stats.record("pool_sentences", 5, 330)
        assert stats.translated == 15
        assert stats.chars_spent == 410
        assert stats.per_tier == {"pool_lemmas": 10, "pool_sentences": 5}
