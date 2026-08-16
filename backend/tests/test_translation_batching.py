"""
Batched translation: one cache read, one DeepL request per 50 misses.

The bug these pin down: `batch_translate` used to loop `get_translation`
behind a semaphore, costing a DB round trip AND an HTTP round trip per text.
A feed page of 20 cards (20 words + 20 sentences) meant 40 of each, which
dominated the endpoint's latency. Batching only the API would still leave 40
sequential cache queries, so both halves are asserted here.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from src.services.translation_service import TranslationService
from src.utils.deepl_client import DeepLClient, DeepLError, MAX_TEXTS_PER_REQUEST


class _FakeCacheTable:
    """Stands in for `db.translationcache`, counting reads."""

    def __init__(self, rows=None):
        self.rows = rows or []
        self.read_calls = 0
        self.written = []

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

    async def upsert(self, where, data):
        self.written.append(data["create"])
        return None


class _FakeDb:
    def __init__(self, rows=None):
        self.translationcache = _FakeCacheTable(rows)


def _row(source, translated, lang="ES"):
    return SimpleNamespace(
        sourceText=source, translated=translated, targetLang=lang,
        sourceLang="EN", createdAt=None,
    )


class _RecordingDeepL:
    """Counts how many HTTP calls the service actually makes."""

    def __init__(self, fail=False):
        self.calls = []
        self.fail = fail

    async def translate_many(self, texts, target_lang, source_lang="auto", context=None):
        if self.fail:
            raise DeepLError("boom")
        self.calls.append(list(texts))
        return [{"translated": f"{t}-{target_lang}", "detected_source_lang": "EN"} for t in texts]

    async def translate(self, text, target_lang, source_lang="auto", context=None):
        results = await self.translate_many([text], target_lang, source_lang, context)
        return results[0]


def _service(db, deepl):
    svc = TranslationService(db, deepl_client=deepl)
    return svc


class TestBatchTranslateRoundTrips:
    def test_one_cache_read_for_the_whole_batch(self):
        db = _FakeDb()
        deepl = _RecordingDeepL()
        texts = [f"word{i}" for i in range(40)]

        asyncio.run(_service(db, deepl).batch_translate(texts, "ES"))

        # The whole point: not 40.
        assert db.translationcache.read_calls == 1

    def test_one_deepl_request_for_forty_misses(self):
        db = _FakeDb()
        deepl = _RecordingDeepL()
        texts = [f"word{i}" for i in range(40)]

        asyncio.run(_service(db, deepl).batch_translate(texts, "ES"))

        assert len(deepl.calls) == 1
        assert len(deepl.calls[0]) == 40

    def test_chunks_at_the_deepl_per_request_limit(self):
        db = _FakeDb()
        deepl = _RecordingDeepL()
        texts = [f"word{i}" for i in range(MAX_TEXTS_PER_REQUEST + 10)]

        asyncio.run(_service(db, deepl).batch_translate(texts, "ES"))

        # translate_many owns the chunking, so the service issues one call and
        # the client splits it — either way, no per-text calls.
        assert len(deepl.calls) == 1

    def test_cached_texts_never_reach_deepl(self):
        db = _FakeDb([_row("hello", "hola"), _row("world", "mundo")])
        deepl = _RecordingDeepL()

        out = asyncio.run(_service(db, deepl).batch_translate(["hello", "world"], "ES"))

        assert deepl.calls == []
        assert [r["translated"] for r in out] == ["hola", "mundo"]

    def test_only_the_misses_are_sent(self):
        db = _FakeDb([_row("hello", "hola")])
        deepl = _RecordingDeepL()

        asyncio.run(_service(db, deepl).batch_translate(["hello", "world"], "ES"))

        assert deepl.calls == [["world"]]

    def test_repeated_text_is_paid_for_once(self):
        # A page routinely repeats a word across its sentences.
        db = _FakeDb()
        deepl = _RecordingDeepL()

        out = asyncio.run(_service(db, deepl).batch_translate(["dog", "dog", "cat"], "ES"))

        assert sorted(deepl.calls[0]) == ["cat", "dog"]
        # …but every input slot still gets its answer.
        assert out[0]["translated"] == out[1]["translated"]


class TestBatchTranslateCorrectness:
    def test_results_line_up_with_input_order(self):
        db = _FakeDb()
        deepl = _RecordingDeepL()
        texts = ["alpha", "beta", "gamma"]

        out = asyncio.run(_service(db, deepl).batch_translate(texts, "ES"))

        assert [r["source"] for r in out] == texts
        assert [r["translated"] for r in out] == ["alpha-ES", "beta-ES", "gamma-ES"]

    def test_newly_translated_text_is_written_back_to_the_cache(self):
        # This is what makes the corpus a one-time cost: the cache is global,
        # so the next user of this word pays nothing.
        db = _FakeDb()
        deepl = _RecordingDeepL()

        asyncio.run(_service(db, deepl).batch_translate(["hello"], "ES"))

        assert [w["sourceText"] for w in db.translationcache.written] == ["hello"]

    def test_lookup_is_normalized_the_same_way_as_single_translation(self):
        # get_translation caches on the normalized key, so a batch read that
        # used raw text would miss every row it wrote.
        db = _FakeDb([_row("hello", "hola")])
        deepl = _RecordingDeepL()

        out = asyncio.run(_service(db, deepl).batch_translate(["Hello."], "ES"))

        assert deepl.calls == []
        assert out[0]["translated"] == "hola"

    def test_empty_input_makes_no_calls(self):
        db = _FakeDb()
        deepl = _RecordingDeepL()

        assert asyncio.run(_service(db, deepl).batch_translate([], "ES")) == []
        assert db.translationcache.read_calls == 0
        assert deepl.calls == []

    def test_a_failed_cache_read_still_translates(self):
        db = _FakeDb()

        async def boom(where):
            raise RuntimeError("db down")

        db.translationcache.find_many = boom
        deepl = _RecordingDeepL()

        out = asyncio.run(_service(db, deepl).batch_translate(["hello"], "ES"))

        assert out[0]["translated"] == "hello-ES"


class TestDeepLClientMultiText:
    def test_sends_every_text_in_one_request(self):
        client = DeepLClient(api_key="k")
        sent = {}

        async def fake_post(texts, target_lang, source_lang, context):
            sent["texts"] = list(texts)
            return [{"text": f"{t}!", "detected_source_language": "EN"} for t in texts]

        client._post_translate = fake_post
        out = asyncio.run(client.translate_many(["a", "b", "c"], "ES"))

        assert sent["texts"] == ["a", "b", "c"]
        assert [o["translated"] for o in out] == ["a!", "b!", "c!"]

    def test_splits_past_the_per_request_limit(self):
        client = DeepLClient(api_key="k")
        batches = []

        async def fake_post(texts, target_lang, source_lang, context):
            batches.append(len(texts))
            return [{"text": t, "detected_source_language": "EN"} for t in texts]

        client._post_translate = fake_post
        n = MAX_TEXTS_PER_REQUEST + 3
        asyncio.run(client.translate_many([f"t{i}" for i in range(n)], "ES"))

        assert batches == [MAX_TEXTS_PER_REQUEST, 3]

    def test_empty_strings_keep_their_slot_without_being_sent(self):
        client = DeepLClient(api_key="k")
        sent = {}

        async def fake_post(texts, target_lang, source_lang, context):
            sent["texts"] = list(texts)
            return [{"text": f"{t}!", "detected_source_language": "EN"} for t in texts]

        client._post_translate = fake_post
        out = asyncio.run(client.translate_many(["a", "", "c"], "ES"))

        assert sent["texts"] == ["a", "c"]
        assert [o["translated"] for o in out] == ["a!", "", "c!"]

    def test_rejects_a_response_that_would_mispair_translations(self):
        # Silently zipping a short response would attach the wrong
        # translation to a word — worse than failing.
        client = DeepLClient(api_key="k")

        async def short_post(texts, target_lang, source_lang, context):
            return [{"text": "only-one", "detected_source_language": "EN"}]

        client._post_translate = short_post
        with pytest.raises(DeepLError):
            asyncio.run(client.translate_many(["a", "b"], "ES"))

    def test_single_translate_still_works_through_the_batch_path(self):
        client = DeepLClient(api_key="k")

        async def fake_post(texts, target_lang, source_lang, context):
            return [{"text": "hola", "detected_source_language": "EN"}]

        client._post_translate = fake_post
        out = asyncio.run(client.translate("hello", "ES"))

        assert out["translated"] == "hola"
        assert out["detected_source_lang"] == "EN"

    def test_mock_mode_without_an_api_key_preserves_slots(self):
        client = DeepLClient(api_key="placeholder")
        # The constructor falls back to $DEEPL_API_KEY, which is set in a dev
        # environment — null it explicitly so this never reaches the network.
        client.api_key = None
        out = asyncio.run(client.translate_many(["a", ""], "ES"))
        assert out[0]["translated"] == "[MOCK ES] a"
        assert out[1]["translated"] == ""
