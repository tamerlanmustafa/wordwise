"""
Unit tests for the learner-definition pre-generation worker.

DB-free, same shape as test_sentence_worker: a fake Prisma client returns
canned backlog rows and a fake LLM service records define_words calls, so the
backlog SQL, chunking, result persistence and cost-cap handling are asserted
without a live Postgres or an Anthropic key.

The state model is the interesting part and most of what is tested here. This
worker stamps `definition_version` on SUCCESS as well as refusal — one column
carrying three states — which makes a mis-recorded outage strictly worse than
it was for sentences (#153): it would mark a batch permanently *done* with an
empty definition, and no later cycle would revisit it.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from src.services.llm_sentence_service import CostCapExceeded, ModelCallFailed
from src.workers import definition_worker as dw

DEF_VERSION = "claude-haiku-4-5-20251001|1"


def _row(lemma_id: int, lemma: str, cefr: str | None = "B1") -> dict:
    return {
        "lemma_id": lemma_id,
        "lemma": lemma,
        "cefr_level": cefr,
        "sentence": f"They chose to {lemma} the plan after a long argument.",
    }


class _FakeDb:
    """query_raw returns the next canned page each call; execute_raw is taped."""

    def __init__(self, pages: list[list[dict]]):
        self._pages = list(pages)
        self.queries: list[tuple[str, tuple]] = []
        self.writes: list[tuple[str, tuple]] = []

    async def query_raw(self, sql: str, *args):
        self.queries.append((sql, args))
        return self._pages.pop(0) if self._pages else []

    async def execute_raw(self, sql: str, *args):
        self.writes.append((sql, args))
        return 1


class _FakeLLM:
    """
    define_words echoes a definition per lemma, minus `fail_lemmas` (which
    mirror the real service returning None for a word it declined or whose
    output failed validation).
    """

    def __init__(
        self,
        fail_lemmas: set[str] | None = None,
        cap_on_call: int | None = None,
        unreachable_on_call: int | None = None,
        definition_version: str = DEF_VERSION,
    ):
        self.fail_lemmas = fail_lemmas or set()
        self.cap_on_call = cap_on_call
        self.unreachable_on_call = unreachable_on_call
        self.definition_version = definition_version
        self.calls: list[list] = []

    async def define_words(self, db, requests, context="definition_worker"):
        self.calls.append(list(requests))
        if self.cap_on_call is not None and len(self.calls) >= self.cap_on_call:
            raise CostCapExceeded("spent $60.00 ≥ cap $60.00")
        if self.unreachable_on_call is not None and len(self.calls) >= self.unreachable_on_call:
            raise ModelCallFailed(
                "Error code: 400 - Your credit balance is too low to access "
                "the Anthropic API."
            )
        return {
            r.lemma.lower(): (
                None if r.lemma in self.fail_lemmas else f"to deal with {r.lemma[:3]}xyz"
            )
            for r in requests
        }


# ─── import safety ──────────────────────────────────────────────────────────

def test_worker_importable_without_anthropic_sdk():
    """
    CI installs requirements-dev.txt, which omits the anthropic SDK, yet this
    worker imports DefinitionRequest/CostCapExceeded from the LLM service.
    Guard that those imports never require the SDK — only instantiating
    LLMSentenceService may. Subprocess so the block can't leak.
    """
    code = (
        "import sys; sys.modules['anthropic'] = None; "
        "import src.workers.definition_worker"
    )
    proc = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        cwd=Path(__file__).resolve().parents[1],
    )
    assert proc.returncode == 0, proc.stderr


# ─── backlog SQL ────────────────────────────────────────────────────────────

def test_backlog_sql_requires_a_sentence_to_anchor_the_sense():
    """
    The whole point of the design: a lemma is only definable once it has a
    global LLM sentence, because that sentence is what fixes which sense to
    define. The JOIN is therefore inner, not left — a lemma without one must
    not appear in the backlog at all.
    """
    sql = dw.build_backlog_sql(limit=100)
    assert "sll.is_global" in sql
    assert "JOIN LATERAL" in sql
    assert "LEFT JOIN" not in sql
    assert "s.sentence AS sentence" in sql


def test_backlog_sql_returns_the_same_sentence_the_card_shows():
    """
    The definition must describe the sense of the sentence the user actually
    sees, so the pick order here has to match every read path's: representative
    link first, then score, then sentence_id. A different order could anchor
    the definition to a sentence the card never renders.
    """
    sql = dw.build_backlog_sql(limit=100)
    assert "ORDER BY sll.is_representative DESC" in sql
    assert "sll.score DESC NULLS LAST" in sql
    # Stated on the link side to match ix_sll_global_lemma's key order (#120).
    assert "sll.sentence_id ASC" in sql


def test_backlog_sql_uses_is_distinct_from_not_inequality():
    """
    `NULL <> 'x'` is NULL, so a plain `<>` would filter out every lemma that
    has never been attempted — the entire backlog on day one — and the worker
    would start life permanently idle. #153 hit exactly this trap.
    """
    sql = dw.build_backlog_sql(limit=100)
    assert "l.definition_version IS DISTINCT FROM $1::varchar" in sql
    assert "definition_version <>" not in sql


def test_backlog_sql_skips_unknown_and_hidden_words():
    """UNKNOWN-level lemmas (#91) are never displayed, and hidden words are
    curated away, so a definition for either is spend with no surface."""
    sql = dw.build_backlog_sql(limit=100)
    assert "l.cefr_level <> 'UNKNOWN'" in sql
    assert "NOT EXISTS (SELECT 1 FROM hidden_words hw" in sql
    assert "ORDER BY l.priority_score DESC" in sql
    assert "LIMIT 100" in sql


# ─── writing results ────────────────────────────────────────────────────────

async def test_cycle_stores_definitions_and_stamps_the_version():
    db = _FakeDb([[_row(1, "abandon"), _row(2, "linger")]])
    llm = _FakeLLM()

    result = await dw.run_cycle(db, llm, page_size=10, batch_size=10, batch_sleep=0)

    assert result.outcome == "generated"
    assert result.stored == 2
    assert result.refused == 0
    # One UPDATE per stored lemma, each carrying the running signature.
    assert len(db.writes) == 2
    for sql, args in db.writes:
        assert "SET definition = $1, definition_version = $2" in sql
        assert args[1] == DEF_VERSION


async def test_cycle_stamps_refusals_so_they_are_never_re_bought():
    """
    A lemma the model declined gets the signature with a NULL definition. That
    is what keeps it out of the next cycle's backlog — and out of every future
    process's, which the sentence worker's in-memory set failed to do (#153).
    """
    db = _FakeDb([[_row(1, "abandon"), _row(2, "zzzz")]])
    llm = _FakeLLM(fail_lemmas={"zzzz"})

    result = await dw.run_cycle(db, llm, page_size=10, batch_size=10, batch_sleep=0)

    assert result.stored == 1
    assert result.refused == 1
    refusal_writes = [w for w in db.writes if "definition = NULL" in w[0]]
    assert len(refusal_writes) == 1
    sql, args = refusal_writes[0]
    assert "WHERE id IN (2)" in sql
    assert args[0] == DEF_VERSION


async def test_cycle_chunks_a_page_into_batches():
    db = _FakeDb([[_row(i, f"word{i}") for i in range(1, 8)]])
    llm = _FakeLLM()

    await dw.run_cycle(db, llm, page_size=10, batch_size=3, batch_sleep=0)

    assert [len(c) for c in llm.calls] == [3, 3, 1]


async def test_cycle_passes_the_anchor_sentence_to_the_model():
    """Without the sentence the model defines the most frequent sense, which
    is the failure this whole design exists to prevent."""
    db = _FakeDb([[_row(1, "abandon")]])
    llm = _FakeLLM()

    await dw.run_cycle(db, llm, page_size=10, batch_size=10, batch_sleep=0)

    (request,) = llm.calls[0]
    assert request.lemma == "abandon"
    assert "abandon the plan" in request.sentence
    assert request.cefr == "B1"


# ─── failure modes ──────────────────────────────────────────────────────────

async def test_cost_cap_stops_the_cycle_but_keeps_earlier_batches():
    db = _FakeDb([[_row(i, f"word{i}") for i in range(1, 7)]])
    llm = _FakeLLM(cap_on_call=2)

    result = await dw.run_cycle(db, llm, page_size=10, batch_size=3, batch_sleep=0)

    assert result.outcome == "cap"
    # The first batch's three definitions were already written and stay written.
    assert result.stored == 3
    assert len(db.writes) == 3


async def test_unreachable_model_writes_absolutely_nothing_for_that_chunk():
    """
    The load-bearing test. A failed call means the model never saw those
    lemmas, so stamping the version would mark them permanently done with an
    empty definition — worse than #153's version of this bug, which only
    mis-recorded refusals that a prompt bump could revoke.
    """
    db = _FakeDb([[_row(i, f"word{i}") for i in range(1, 7)]])
    llm = _FakeLLM(unreachable_on_call=1)

    result = await dw.run_cycle(db, llm, page_size=10, batch_size=3, batch_sleep=0)

    assert result.outcome == "unavailable"
    assert result.stored == 0
    assert result.refused == 0
    assert db.writes == []


async def test_unreachable_midway_keeps_the_completed_batch_only():
    db = _FakeDb([[_row(i, f"word{i}") for i in range(1, 7)]])
    llm = _FakeLLM(unreachable_on_call=2)

    result = await dw.run_cycle(db, llm, page_size=10, batch_size=3, batch_sleep=0)

    assert result.outcome == "unavailable"
    assert result.stored == 3
    # Exactly the three from the batch the model actually answered.
    assert len(db.writes) == 3


async def test_empty_backlog_is_idle_not_an_error():
    db = _FakeDb([[]])
    llm = _FakeLLM()

    result = await dw.run_cycle(db, llm, page_size=10, batch_size=10, batch_sleep=0)

    assert result.outcome == "idle"
    assert llm.calls == []
    assert db.writes == []
