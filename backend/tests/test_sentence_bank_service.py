"""
Unit tests for sentence_bank_service.get_llm_examples_for_lemmas and the
quiz-route glue (_cards_response) that attaches its results to session
card payloads.

Quiz/review surfaces must only ever show LLM-authored (Haiku) example
sentences — never raw subtitle extracts — so these tests pin the SQL
filter and the degrade-to-no-sentence behavior.
"""
from __future__ import annotations

from src.routes import quiz as quiz_routes
from src.services.quiz_service import CardSpec
from src.services.sentence_bank_service import get_llm_examples_for_lemmas


class _FakeDb:
    """Serves the helper's single raw query and records what was asked."""

    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    async def query_raw(self, sql: str, *args):
        self.calls.append((" ".join(sql.split()), args))
        return self.rows


async def test_returns_best_sentence_per_lemma():
    db = _FakeDb([
        {"lemma": "run", "sentence": "She runs every morning before work."},
        {"lemma": "cold", "sentence": "The soup went cold while we talked."},
    ])
    out = await get_llm_examples_for_lemmas(db, ["run", "cold", "missing"])
    assert out == {
        "run": "She runs every morning before work.",
        "cold": "The soup went cold while we talked.",
    }


async def test_query_restricts_to_global_llm_rows():
    db = _FakeDb([])
    await get_llm_examples_for_lemmas(db, ["run"])
    sql, args = db.calls[0]
    # The whole point of the helper: subtitle-extracted rows must never
    # qualify — only the Haiku-authored global sentences.
    assert "sb.movie_id IS NULL" in sql
    assert "sb.source = 'llm'" in sql
    assert args == (["run"],)


async def test_empty_input_short_circuits():
    db = _FakeDb([])
    assert await get_llm_examples_for_lemmas(db, []) == {}
    assert db.calls == []


async def test_cards_response_attaches_examples():
    db = _FakeDb([{"lemma": "run", "sentence": "She runs every morning."}])
    cards = [
        CardSpec(word="run", card_type="mcq", translation="correr",
                 choices=[{"word": "correr", "is_correct": True}]),
        CardSpec(word="walk", card_type="self_rate", translation="caminar"),
    ]
    resp = await quiz_routes._cards_response(db, session_id=7, cards=cards)
    by_word = {c.word: c for c in resp.cards}
    assert resp.session_id == 7
    assert by_word["run"].example_sentence == "She runs every morning."
    assert by_word["walk"].example_sentence is None


async def test_cards_response_survives_lookup_failure():
    class _BrokenDb:
        async def query_raw(self, *args):
            raise RuntimeError("db down")

    cards = [CardSpec(word="run", card_type="self_rate", translation=None)]
    resp = await quiz_routes._cards_response(_BrokenDb(), session_id=1, cards=cards)
    assert resp.cards[0].example_sentence is None
