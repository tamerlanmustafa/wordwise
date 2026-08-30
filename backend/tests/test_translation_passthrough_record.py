"""
Passthrough results are recorded, not merely refused.

`_save_to_cache` has always dropped a translation identical to its source,
because caching one would serve English-as-Turkish forever. Correct — but it
made two decisions with one `return`: don't cache it, AND don't remember it.
So prod could not answer "which words are the same in Turkish?" despite having
resolved 25,665 Turkish terms; every passthrough among them was discarded at
write time (measured 2026-08-30: `translation_cache` holds exactly 0 identical
rows, by construction, not by absence).

What is asserted here is the split: the cache still refuses them, and
`translation_passthroughs` now keeps the observation — cheaply (one statement
per batch, never one per row) and safely (a bookkeeping failure never reaches
the caller, who already has their translation).
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from src.services.translation_service import TranslationService


class _FakeCache:
    def __init__(self):
        self.upserts = []

    async def upsert(self, **kwargs):
        self.upserts.append(kwargs)


class _FakeDb:
    """Counts raw statements, so a per-row loop can't hide behind row counts."""

    def __init__(self, fail=False):
        self.translationcache = _FakeCache()
        self.raw_calls = []
        self.fail = fail

    async def execute_raw(self, sql, *args):
        if self.fail:
            raise RuntimeError("relation does not exist")
        self.raw_calls.append((sql, args))
        return len(args[0]) if args and isinstance(args[0], list) else 1


def _service(db):
    return TranslationService(db=db, deepl_client=object(), google_client=object())


def _terms(call):
    return call[1][0]


def _lang(call):
    return call[1][1]


def _provider(call):
    return call[1][2]


class TestSingleWrite:
    def test_a_passthrough_is_refused_by_the_cache_but_recorded(self):
        db = _FakeDb()
        asyncio.run(
            _service(db)._save_to_cache(
                source_text="khat", target_lang="TR", translated="  Khat ",
                provider="deepl",
            )
        )

        # Unchanged behaviour: it must not become a cached "translation".
        assert db.translationcache.upserts == []
        # New behaviour: but we now know it happened.
        assert len(db.raw_calls) == 1
        assert _terms(db.raw_calls[0]) == ["khat"]
        assert _lang(db.raw_calls[0]) == "TR"
        assert _provider(db.raw_calls[0]) == "deepl"

    def test_a_real_translation_is_cached_and_records_nothing(self):
        db = _FakeDb()
        asyncio.run(
            _service(db)._save_to_cache(
                source_text="gallant", target_lang="TR", translated="cesur",
            )
        )

        assert len(db.translationcache.upserts) == 1
        assert db.raw_calls == []

    def test_an_unnamed_provider_still_gets_a_row(self):
        # The column is NOT NULL: Postgres treats NULLs as distinct in a unique
        # index, so a null provider would accumulate duplicate rows for one
        # term instead of incrementing times_seen.
        db = _FakeDb()
        asyncio.run(
            _service(db)._save_to_cache(
                source_text="argon", target_lang="TR", translated="argon",
            )
        )

        assert _provider(db.raw_calls[0]) == "unknown"


class TestBatchWrite:
    def test_a_whole_batch_of_passthroughs_costs_one_statement(self):
        # The point of _save_many_to_cache is that a feed page doesn't pay a
        # round trip per row. Recording must not smuggle that loop back in.
        db = _FakeDb()
        rows = [(w, w, "EN") for w in ("khat", "grappa", "argon", "malt", "beanbag")]
        asyncio.run(_service(db)._save_many_to_cache(rows, "TR", provider="google"))

        assert db.translationcache.upserts == []
        assert len(db.raw_calls) == 1
        assert _terms(db.raw_calls[0]) == ["argon", "beanbag", "grappa", "khat", "malt"]

    def test_a_mixed_batch_splits_without_losing_either_side(self):
        db = _FakeDb()
        db.translationcache.create_many_calls = []

        async def create_many(data, skip_duplicates=False):
            db.translationcache.create_many_calls.append(data)

        db.translationcache.create_many = create_many

        rows = [("khat", "khat", "EN"), ("gallant", "cesur", "EN")]
        asyncio.run(_service(db)._save_many_to_cache(rows, "TR", provider="deepl"))

        cached = [r["sourceText"] for r in db.translationcache.create_many_calls[0]]
        assert cached == ["gallant"]
        assert _terms(db.raw_calls[0]) == ["khat"]

    def test_a_term_repeated_in_one_batch_is_collapsed(self):
        # ON CONFLICT raises "cannot affect row a second time" if one statement
        # touches the same key twice, so the dedupe is correctness, not tidiness.
        db = _FakeDb()
        rows = [("khat", "khat", "EN"), ("Khat", " khat ", "EN")]
        asyncio.run(_service(db)._save_many_to_cache(rows, "TR"))

        assert _terms(db.raw_calls[0]) == ["khat"]


class TestItNeverHurtsTheCaller:
    def test_english_targets_are_not_recorded(self):
        # EN→EN is identical by definition; it observes nothing.
        db = _FakeDb()
        asyncio.run(
            _service(db)._save_to_cache(
                source_text="khat", target_lang="EN", translated="khat",
            )
        )
        assert db.raw_calls == []

    def test_a_failed_record_is_swallowed(self):
        # The translation is already in the caller's hand. Bookkeeping that
        # can fail the request would be worse than the gap it closes — and
        # this fires on a table that may not exist yet on an older database.
        db = _FakeDb(fail=True)
        asyncio.run(
            _service(db)._save_to_cache(
                source_text="khat", target_lang="TR", translated="khat",
            )
        )
        assert db.translationcache.upserts == []

    def test_an_empty_or_blank_batch_issues_no_statement(self):
        db = _FakeDb()
        asyncio.run(_service(db)._record_passthroughs(["", "  "], "TR"))
        asyncio.run(_service(db)._record_passthroughs([], "TR"))
        assert db.raw_calls == []
