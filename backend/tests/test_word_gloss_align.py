"""
Unit tests for LLMSentenceService.align_word_translation — the word gloss
aligned to a sentence translation so a vocab card's headword matches the
sentence beside it (e.g. gallant → "Cesur", not the isolated sense).

Pure unit: the Anthropic client and DB are faked, so no SDK, key, or network.
We build the service via __new__ to skip __init__ (which needs the API key).
"""
from types import SimpleNamespace

import pytest

from src.services.llm_sentence_service import LLMSentenceService, CostCapExceeded


class _FakeMessages:
    def __init__(self, text):
        self.text = text
        self.calls = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(
            content=[SimpleNamespace(type="text", text=self.text)],
            usage=SimpleNamespace(model_dump=lambda: {"input_tokens": 12, "output_tokens": 4}),
        )


class _FakeClient:
    def __init__(self, text):
        self.messages = _FakeMessages(text)


class _FakeLedger:
    def __init__(self):
        self.created = []

    async def create(self, data):
        self.created.append(data)


class _FakeDB:
    def __init__(self, spend=0.0):
        self._spend = spend
        self.llmusageledger = _FakeLedger()

    async def query_raw(self, *args, **kwargs):
        return [{"total": self._spend}]


def _service(reply_text, cap=0.0):
    svc = LLMSentenceService.__new__(LLMSentenceService)
    svc._client = _FakeClient(reply_text)
    svc._model = "claude-haiku-test"
    svc._cap_usd = cap
    return svc


async def test_align_returns_gloss_and_records_usage():
    svc = _service('{"translation": "cesur"}')
    db = _FakeDB()
    gloss = await svc.align_word_translation(
        db,
        word="gallant",
        sentence="The gallant young man helped the old woman.",
        sentence_translation="Cesur genç adam yaşlı kadına yardım etti.",
        target_lang="TR",
    )
    assert gloss == "cesur"
    # We paid for the call → a ledger row is written.
    assert len(db.llmusageledger.created) == 1
    # The sentence translation is sent so the model can align to it.
    sent_payload = svc._client.messages.calls[0]["messages"][0]["content"]
    assert "Cesur genç adam" in sent_payload


async def test_align_returns_none_on_null_translation():
    svc = _service('{"translation": null}')
    assert await svc.align_word_translation(
        _FakeDB(), "x", "a sentence here.", "bir cümle burada.", "TR"
    ) is None


async def test_align_returns_none_on_non_json():
    svc = _service("I think the word is cesur.")
    assert await svc.align_word_translation(
        _FakeDB(), "x", "a sentence here.", "bir cümle burada.", "TR"
    ) is None


async def test_align_raises_when_cost_cap_reached():
    # Cap 1.0, already spent 2.0 → refuse before calling the model.
    svc = _service('{"translation": "cesur"}', cap=1.0)
    db = _FakeDB(spend=2.0)
    with pytest.raises(CostCapExceeded):
        await svc.align_word_translation(
            db, "gallant", "The gallant man.", "Cesur adam.", "TR"
        )
    # Model was never called.
    assert svc._client.messages.calls == []


async def test_align_skips_blank_inputs():
    svc = _service('{"translation": "cesur"}')
    assert await svc.align_word_translation(_FakeDB(), "gallant", "", "Cesur.", "TR") is None
    assert svc._client.messages.calls == []


def test_parse_gloss_handles_fences_quotes_and_overlong():
    assert LLMSentenceService._parse_gloss('```json\n{"translation": "cesur"}\n```') == "cesur"
    assert LLMSentenceService._parse_gloss('{"translation": "\'koşmak\'"}') == "koşmak"
    # A whole-sentence "gloss" is a model miss, not a word — reject it.
    long = "x" * 80
    assert LLMSentenceService._parse_gloss('{"translation": "%s"}' % long) is None
    assert LLMSentenceService._parse_gloss("not json") is None
