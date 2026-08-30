"""
Unit tests for LLMSentenceService.define_words — the one-line learner gloss
under the headword on the Explore card and the movie-detail deck.

Pure unit: the Anthropic client and DB are faked, so no SDK, key, or network.
The service is built via __new__ to skip __init__ (which needs the API key),
the same construction test_word_gloss_align uses.

Most of the value here is in _validate_definition. The prompt asks for a lot of
things; only the ones that would visibly break a card or teach a learner
nothing are enforced in code, and circularity is the one that matters most —
it is both the worst outcome for the reader and the failure an LLM produces
most readily on a rare word.
"""
from types import SimpleNamespace

import pytest

from src.services.llm_cost_ledger import LedgerSpendTracker
from src.services.llm_sentence_service import (
    CostCapExceeded,
    DEFINITION_PROMPT_VERSION,
    DefinitionRequest,
    LLMSentenceService,
    MAX_DEF_CHARS,
    ModelCallFailed,
)


class _FakeMessages:
    def __init__(self, text, raises=None):
        self.text = text
        self.raises = raises
        self.calls = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.raises:
            raise self.raises
        return SimpleNamespace(
            content=[SimpleNamespace(type="text", text=self.text)],
            usage=SimpleNamespace(
                model_dump=lambda: {"input_tokens": 200, "output_tokens": 60}
            ),
        )


class _FakeClient:
    def __init__(self, text, raises=None):
        self.messages = _FakeMessages(text, raises)


class _FakeLedger:
    def __init__(self):
        self.created = []

    async def create(self, data):
        self.created.append(data)


class _FakeDB:
    def __init__(self, spend=0.0):
        self._spend = spend
        self.llmusageledger = _FakeLedger()

    async def query_raw(self, sql: str = "", *args, **kwargs):
        # Mirrors the settled/tail split in services/llm_cost_ledger.py — see
        # test_word_gloss_align for why the second statement must answer zero.
        cutoff = "2026-01-01 00:00:00+00"
        if "$1" in sql:
            return [{"settled": 0.0, "tail": 0.0, "cutoff": cutoff}]
        return [{"settled": self._spend, "tail": 0.0, "cutoff": cutoff}]


def _service(reply_text, cap=0.0, raises=None):
    svc = LLMSentenceService.__new__(LLMSentenceService)
    svc._client = _FakeClient(reply_text, raises)
    svc._model = "claude-haiku-test"
    svc._cap_usd = cap
    svc._spend = LedgerSpendTracker()
    return svc


def _req(lemma="abandon", cefr="B1", sentence=None):
    return DefinitionRequest(
        lemma=lemma,
        cefr=cefr,
        sentence=sentence or f"They chose to {lemma} the plan after arguing.",
    )


# ─── the happy path ─────────────────────────────────────────────────────────

async def test_define_returns_gloss_per_lemma_and_records_usage():
    svc = _service(
        '{"definitions": [{"word": "abandon", "definition": "to leave '
        'something behind for good"}]}'
    )
    db = _FakeDB()

    out = await svc.define_words(db, [_req("abandon")])

    assert out == {"abandon": "to leave something behind for good"}
    # We paid for the call → a ledger row lands regardless of parse outcome.
    assert len(db.llmusageledger.created) == 1


async def test_the_anchor_sentence_is_sent_to_the_model():
    """The sense anchor is the whole design. If the sentence stopped being
    sent, definitions would silently drift to the most frequent sense and
    nothing else in the system would notice."""
    svc = _service('{"definitions": []}')

    await svc.define_words(
        _FakeDB(), [_req("bank", sentence="She sat on the river bank to rest.")]
    )

    payload = svc._client.messages.calls[0]["messages"][0]["content"]
    assert "river bank" in payload


async def test_the_system_prompt_is_cached():
    """Same lever the sentence path uses: the definition prompt is ~350 tokens
    resent on every batch of 15, so caching it is most of this job's input
    bill across a 42k-lemma corpus."""
    svc = _service('{"definitions": []}')

    await svc.define_words(_FakeDB(), [_req()])

    system = svc._client.messages.calls[0]["system"]
    assert system[0]["cache_control"] == {"type": "ephemeral"}


async def test_missing_entries_come_back_as_none_not_absent():
    """A caller records a durable fact per lemma, so every lemma it asked
    about must appear in the result — a missing key and a None would otherwise
    be the same lookup and the worker would skip stamping the row."""
    svc = _service(
        '{"definitions": [{"word": "abandon", "definition": "to leave for good"}]}'
    )

    out = await svc.define_words(_FakeDB(), [_req("abandon"), _req("linger")])

    assert set(out) == {"abandon", "linger"}
    assert out["linger"] is None


# ─── validation ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "lemma, definition",
    [
        # The circular ones — the failure this check exists for.
        ("abandon", "to abandon something completely"),
        ("abandon", "the act of abandoning a place"),
        ("linger", "to linger somewhere for a while"),
        # Prefix stem catches inflections the exact word would miss.
        ("govern", "a system of government"),
    ],
)
def test_circular_definitions_are_rejected(lemma, definition):
    svc = _service("")
    assert svc._validate_definition(definition, _req(lemma)) is None


@pytest.mark.parametrize(
    "lemma, definition",
    [
        # Doubled final consonant before -ing/-ed.
        ("get", "to be getting hold of something"),
        ("run", "the act of running fast"),
        ("sit", "to be sitting down somewhere"),
        # Dropped -e before -ing.
        ("give", "the act of giving freely"),
        ("take", "to be taking something away"),
    ],
)
def test_short_lemma_inflections_are_caught_too(lemma, definition):
    """
    English spells short inflections three ways and only the plain one falls
    out of the lemma unchanged, so matching the bare word missed all of these.
    They matter more than the long-lemma case, not less: the version stamp
    marks the row done either way, so a circular gloss that slips through is
    permanent until someone bumps DEFINITION_PROMPT_VERSION.
    """
    svc = _service("")
    assert svc._validate_definition(definition, _req(lemma)) is None


@pytest.mark.parametrize(
    "lemma, definition",
    [
        ("run", "to move quickly on foot"),
        ("give", "to hand something to someone"),
        ("get", "to obtain or receive something"),
        ("take", "to pick up and carry away"),
        ("be", "to exist before now"),
    ],
)
def test_the_widened_stems_do_not_reject_honest_definitions(lemma, definition):
    """The other half of the previous test. Widening a rejection rule is only
    safe if it still lets the good case through — an over-eager check would
    refuse every definition of the most common verbs in the language, and
    those are exactly the words a learner most needs a gloss for."""
    svc = _service("")
    assert svc._validate_definition(definition, _req(lemma)) is not None


def test_short_lemmas_use_whole_word_matching_not_a_prefix():
    """
    A 4-char prefix is a good stem for a long word and a disaster for a short
    one: `\\bbe` fires on "before" and "between", which is most of the
    vocabulary available for defining "be". Short lemmas therefore match
    whole-word plus simple inflections.
    """
    svc = _service("")
    # "before" must NOT read as circular for the lemma "be".
    assert svc._validate_definition("to exist before now", _req("be")) is not None
    # But the bare word still does.
    assert svc._validate_definition("to be something", _req("be")) is None


def test_over_long_definitions_are_rejected():
    svc = _service("")
    too_long = "to " + ("very " * 40) + "leave"
    assert len(too_long) > MAX_DEF_CHARS
    assert svc._validate_definition(too_long, _req()) is None


@pytest.mark.parametrize(
    "definition",
    [
        "to leave behind (verb)",       # POS label
        "to **leave** behind",          # markdown
        "to leave behind [formal]",     # bracketed register note
        "to leave\nbehind for good",    # multi-line
    ],
)
def test_unrenderable_definitions_are_rejected(definition):
    """The card has one Text node and no rich text — anything that would
    render as literal junk is a refusal, not something to clean up."""
    svc = _service("")
    assert svc._validate_definition(definition, _req()) is None


def test_a_trailing_period_is_stripped_rather_than_refused():
    """Punctuation the card can normalise is not worth re-buying the call for.
    Contrast the rules above, which reject — the line is 'can we fix it here'."""
    svc = _service("")
    assert (
        svc._validate_definition("to leave something behind.", _req())
        == "to leave something behind"
    )


def test_surrounding_quotes_are_stripped():
    svc = _service("")
    assert (
        svc._validate_definition('"to leave something behind"', _req())
        == "to leave something behind"
    )


async def test_invalid_definitions_surface_as_refusals_not_errors():
    """A rejected definition must look identical to the model declining —
    both are 'nothing usable for this lemma', and the worker stamps the row
    either way so it is not re-bought."""
    svc = _service(
        '{"definitions": [{"word": "abandon", "definition": "to abandon it"}]}'
    )

    out = await svc.define_words(_FakeDB(), [_req("abandon")])

    assert out == {"abandon": None}


# ─── failure modes ──────────────────────────────────────────────────────────

async def test_cost_cap_raises_before_the_model_is_called():
    svc = _service('{"definitions": []}', cap=1.0)
    db = _FakeDB(spend=2.0)

    with pytest.raises(CostCapExceeded):
        await svc.define_words(db, [_req()])

    assert svc._client.messages.calls == []


async def test_a_failed_call_raises_rather_than_returning_all_none():
    """
    The distinction that keeps an outage from being written to the rows. An
    all-None return is indistinguishable from a batch of refusals, and this
    worker stamps success into the same column — so recording one would mark
    every lemma in the batch permanently done with an empty definition.
    """
    svc = _service("", raises=RuntimeError("connection reset"))

    with pytest.raises(ModelCallFailed):
        await svc.define_words(_FakeDB(), [_req("abandon"), _req("linger")])


@pytest.mark.parametrize(
    "reply",
    [
        '["to leave behind"]',   # bare array
        'null',                  # literal null
        '"to leave behind"',     # bare string
        '42',                    # bare number
    ],
)
async def test_valid_json_that_is_not_an_object_is_refusals_not_a_crash(reply):
    """
    `json.loads` succeeding does not mean an object came back, and none of
    these have `.get`. The AttributeError that used to raise here escaped
    define_words and run_cycle entirely, AFTER the call was billed — so the
    page was never stamped and the worker re-bought the same 15 lemmas every
    30 seconds forever, emailing admins the whole time. A paid infinite loop
    is a much worse outcome than a page of refusals.
    """
    svc = _service(reply)
    db = _FakeDB()

    out = await svc.define_words(db, [_req("abandon")])

    assert out == {"abandon": None}
    assert len(db.llmusageledger.created) == 1


async def test_malformed_json_is_refusals_not_an_exception():
    """A reply that arrived but could not be parsed is different from a reply
    that never arrived: we were billed, the model formed an opinion, and the
    lemmas are simply unanswered."""
    svc = _service("Sure! Here are your definitions:")
    db = _FakeDB()

    out = await svc.define_words(db, [_req("abandon")])

    assert out == {"abandon": None}
    assert len(db.llmusageledger.created) == 1


def test_definition_version_pins_model_and_prompt():
    """The only revocation mechanism there is — a rewrite of the prompt must
    move this string, or the worker will skip every lemma it already handled
    and the rewrite reaches nothing."""
    svc = _service("")
    assert svc.definition_version == f"claude-haiku-test|{DEFINITION_PROMPT_VERSION}"
