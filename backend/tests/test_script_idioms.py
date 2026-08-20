"""
Tests for precomputed script idioms (issue #106).

Idiom detection is a pure function of `cleaned_script_text`, which never
changes after ingestion — yet it ran a full spaCy parse on every request to
/movies/{id}/vocabulary/preview, /vocabulary/full and /api/cefr/classify-script.
Measured in production: 2.4s for a 5 KB script, 21.0s for a 414 KB one, on
every call, against a 0.16s baseline. Opening one movie paid for it twice
(#122).

What matters and is asserted here:
1. A script that has been parsed once is never parsed again — including the
   script that legitimately has *no* idioms, which NULL-vs-`[]` distinguishes.
2. A never-parsed script computes, stores, and serves the result.
3. The stored value survives a round-trip in either encoding (Prisma hands Json
   columns back deserialized; rows written by raw SQL can arrive as a string).
4. A failed write costs a reparse, never the user's request.
5. The NLP queue cap still applies to the parse, and only to the parse — a
   cached read must not consume a slot.
6. Ingestion computes the list next to the text, and invalidates it when the
   text is rewritten.

spaCy is never imported: it isn't installed in CI, and none of this needs a
real model.
"""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from src.services import script_idioms
from src.services.script_idioms import get_script_idioms, store_script_idioms

IDIOMS = [
    {"phrase": "break a leg", "type": "idiom", "cefr_level": "B2", "words": ["break", "a", "leg"]},
    {"phrase": "give up", "type": "phrasal_verb", "cefr_level": "A2", "words": ["give", "up"]},
]


class FakeScriptTable:
    def __init__(self, fail: bool = False):
        self.updates: list[dict] = []
        self.fail = fail

    async def update(self, where, data):
        if self.fail:
            raise RuntimeError("db down")
        self.updates.append({"where": where, "data": data})
        return SimpleNamespace(id=where["id"])


class FakeDB:
    def __init__(self, fail: bool = False):
        self.moviescript = FakeScriptTable(fail=fail)


def script(idioms=None, text="he had to give up"):
    return SimpleNamespace(id=7, cleanedScriptText=text, idioms=idioms)


@pytest.fixture
def no_real_spacy(monkeypatch):
    """Stand in for the detector, counting how often it is actually run.

    `spacy_available` is forced True here: the model isn't installed in this
    env, and the write-gating behaviour it drives has its own tests below.
    """
    calls = []

    async def fake_compute(text, doc=None):
        calls.append(text)
        return IDIOMS

    async def available():
        return True

    monkeypatch.setattr(script_idioms, "compute_idioms", fake_compute)
    monkeypatch.setattr(script_idioms, "spacy_available", available)
    return calls


# ---------------------------------------------------------------------------
# 1-2. Parse once, then never again
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_stored_idioms_are_served_without_parsing(no_real_spacy):
    db = FakeDB()

    result = await get_script_idioms(db, script(idioms=IDIOMS))

    assert result == IDIOMS
    assert no_real_spacy == [], "a stored script must not reach spaCy"
    assert db.moviescript.updates == []


@pytest.mark.asyncio
async def test_a_script_with_no_idioms_is_not_reparsed_forever(no_real_spacy):
    """The reason NULL and [] have to mean different things: an idiom-free
    script is a legitimate answer, not a cache miss."""
    db = FakeDB()

    assert await get_script_idioms(db, script(idioms=[])) == []
    assert no_real_spacy == []


@pytest.mark.asyncio
async def test_first_read_computes_stores_and_returns(no_real_spacy):
    db = FakeDB()
    row = script(idioms=None)

    result = await get_script_idioms(db, row)

    assert result == IDIOMS
    assert no_real_spacy == ["he had to give up"]
    # ...and it was written back, so the next reader gets it for free.
    assert len(db.moviescript.updates) == 1
    assert db.moviescript.updates[0]["where"] == {"id": 7}


@pytest.mark.asyncio
async def test_a_script_without_text_returns_empty_without_parsing(no_real_spacy):
    db = FakeDB()

    assert await get_script_idioms(db, script(idioms=None, text="")) == []
    assert no_real_spacy == []
    assert db.moviescript.updates == []


# ---------------------------------------------------------------------------
# 3. Decoding whatever the column holds
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_a_json_string_in_the_column_is_still_a_hit(no_real_spacy):
    """Prisma deserializes Json columns, but rows written through raw SQL or
    older code can surface as a string — that must not force a reparse."""
    db = FakeDB()

    assert await get_script_idioms(db, script(idioms=json.dumps(IDIOMS))) == IDIOMS
    assert no_real_spacy == []


@pytest.mark.asyncio
@pytest.mark.parametrize("garbage", ["not json at all", {"phrase": "x"}, 42])
async def test_an_unusable_stored_value_is_treated_as_a_miss(no_real_spacy, garbage):
    db = FakeDB()

    assert await get_script_idioms(db, script(idioms=garbage)) == IDIOMS
    assert no_real_spacy, "garbage in the column must fall back to computing"


@pytest.mark.asyncio
async def test_non_idiom_entries_are_dropped_from_a_stored_list(no_real_spacy):
    db = FakeDB()
    stored = [IDIOMS[0], "junk", {"no_phrase": 1}]

    assert await get_script_idioms(db, script(idioms=stored)) == [IDIOMS[0]]
    assert no_real_spacy == []


# ---------------------------------------------------------------------------
# 4. A failed write is not a failed request
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_a_failed_write_still_serves_the_computed_idioms(no_real_spacy):
    db = FakeDB(fail=True)

    assert await get_script_idioms(db, script(idioms=None)) == IDIOMS


@pytest.mark.asyncio
async def test_store_never_raises():
    await store_script_idioms(FakeDB(fail=True), 7, IDIOMS)  # must not raise


# ---------------------------------------------------------------------------
# 5. The NLP queue cap covers the parse, and only the parse
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_a_cache_miss_respects_the_queue_cap(no_real_spacy):
    from src.utils.nlp_executor import NLPOverloaded, nlp_slot

    db = FakeDB()
    with nlp_slot(1):  # queue already full
        with pytest.raises(NLPOverloaded):
            await get_script_idioms(db, script(idioms=None), max_pending=1)


@pytest.mark.asyncio
async def test_a_cache_hit_does_not_consume_a_queue_slot(no_real_spacy):
    """The point of #106: a full NLP queue must not stop an already-parsed
    movie from serving its idioms."""
    from src.utils.nlp_executor import nlp_slot

    db = FakeDB()
    with nlp_slot(1):
        assert await get_script_idioms(db, script(idioms=IDIOMS), max_pending=1) == IDIOMS


# ---------------------------------------------------------------------------
# 6. Ingestion computes at write time, and invalidates on rewrite
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ingestion_precomputes_idioms_for_the_text_it_stores(monkeypatch):
    from src.services.script_ingestion_service import ScriptIngestionService

    async def fake_compute(text, doc=None):
        assert text == "he had to give up"
        return IDIOMS

    async def available():
        return True

    monkeypatch.setattr(script_idioms, "compute_idioms", fake_compute)
    monkeypatch.setattr(script_idioms, "spacy_available", available)

    service = ScriptIngestionService.__new__(ScriptIngestionService)
    value = await service._precompute_idioms("he had to give up")

    assert value is not None
    assert getattr(value, "data", value) == IDIOMS


@pytest.mark.asyncio
async def test_ingestion_leaves_the_column_null_when_the_parse_fails(monkeypatch):
    """NULL means 'compute on first read', so a parse failure at ingestion
    degrades to the old behaviour for one request instead of losing idioms."""
    from src.services.script_ingestion_service import ScriptIngestionService

    async def boom(text):
        raise RuntimeError("parse blew up")

    async def available():
        return True

    # spaCy present, parse itself fails — otherwise this would pass for the
    # unrelated reason that the test env has no model.
    monkeypatch.setattr(script_idioms, "compute_idioms", boom)
    monkeypatch.setattr(script_idioms, "spacy_available", available)

    service = ScriptIngestionService.__new__(ScriptIngestionService)

    assert await service._precompute_idioms("some text") is None
    assert await service._precompute_idioms(None) is None


# ---------------------------------------------------------------------------
# 7. A parse made without spaCy is served, never stored
# ---------------------------------------------------------------------------
#
# detect_phrasal_verbs_and_idioms deliberately degrades when the model is
# missing: it drops the in-context dependency parse and matches phrasal verbs
# by substring, which is what produces "her makeup" -> "make up". Tolerable for
# one response; permanent if it lands in the column.

@pytest.fixture
def spacy_missing(monkeypatch):
    calls = []

    async def fake_compute(text, doc=None):
        calls.append(text)
        return IDIOMS

    async def unavailable():
        return False

    monkeypatch.setattr(script_idioms, "compute_idioms", fake_compute)
    monkeypatch.setattr(script_idioms, "spacy_available", unavailable)
    return calls


@pytest.mark.asyncio
async def test_a_degraded_parse_is_served_but_not_stored(spacy_missing):
    db = FakeDB()

    result = await get_script_idioms(db, script(idioms=None))

    assert result == IDIOMS, "the request must still be answered"
    assert db.moviescript.updates == [], "a substring-only parse must not be frozen in"


@pytest.mark.asyncio
async def test_ingestion_stores_nothing_when_spacy_is_missing(monkeypatch):
    from src.services.script_ingestion_service import ScriptIngestionService

    async def unavailable():
        return False

    async def fake_compute(text, doc=None):
        raise AssertionError("must not even parse without the model")

    monkeypatch.setattr(script_idioms, "spacy_available", unavailable)
    monkeypatch.setattr(script_idioms, "compute_idioms", fake_compute)

    service = ScriptIngestionService.__new__(ScriptIngestionService)

    assert await service._precompute_idioms("he had to give up") is None


def test_the_backfill_refuses_to_run_without_spacy():
    """The offline backfill writes to every row it touches, so it is the most
    damaging place to run a degraded parse."""
    import ast
    from pathlib import Path

    src = (Path(__file__).resolve().parents[1] / "backfill_script_idioms.py").read_text()
    tree = ast.parse(src)
    called = {
        getattr(n.func, "id", None) or getattr(n.func, "attr", None)
        for n in ast.walk(tree)
        if isinstance(n, ast.Call)
    }

    assert "spacy_available" in called
    assert "SystemExit" in called


def test_routes_read_idioms_through_the_cache_not_the_detector():
    """Static guard: a future handler must not go back to parsing per request."""
    import ast
    from pathlib import Path

    routes = Path(__file__).resolve().parents[1] / "src" / "routes"
    for route_file in (routes / "movies.py", routes / "cefr.py"):
        tree = ast.parse(route_file.read_text())
        called = {
            getattr(n.func, "id", None) or getattr(n.func, "attr", None)
            for n in ast.walk(tree)
            if isinstance(n, ast.Call)
        }
        assert "detect_phrasal_verbs_and_idioms_async" not in called, (
            f"{route_file.name} parses idioms per request — read them via "
            "get_script_idioms so the parse happens once per script (#106)."
        )
        assert "get_script_idioms" in called
