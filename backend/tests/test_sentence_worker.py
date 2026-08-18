"""
Unit tests for the continuous sentence pre-generation worker (issue #86).

DB-free: a fake Prisma client returns canned backlog rows and a fake LLM
service records generate_and_store calls, so we assert the backlog SQL,
chunking, failed-lemma skip behaviour, and cost-cap handling without a live
Postgres or an Anthropic key.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from src.services.llm_sentence_service import CostCapExceeded
from src.workers import sentence_worker as sw


def _row(lemma_id: int, lemma: str, cefr: str | None = "B1") -> dict:
    return {"lemma_id": lemma_id, "lemma": lemma, "cefr_level": cefr}


class _FakeDb:
    """query_raw returns the next canned page each call."""

    def __init__(self, pages: list[list[dict]]):
        self._pages = list(pages)
        self.queries: list[str] = []

    async def query_raw(self, sql: str, *args):
        self.queries.append(sql)
        return self._pages.pop(0) if self._pages else []


class _FakeLLM:
    """
    generate_and_store echoes back a result per word, minus `fail_words`,
    mirroring the real service (invalid sentences are silently dropped).
    """

    def __init__(self, fail_words: set[str] | None = None, cap_on_call: int | None = None):
        self.fail_words = fail_words or set()
        self.cap_on_call = cap_on_call
        self.calls: list[list] = []

    async def generate_and_store(self, db, *, words, lemma_id_map, context):
        self.calls.append(list(words))
        if self.cap_on_call is not None and len(self.calls) >= self.cap_on_call:
            raise CostCapExceeded("spent $50.00 ≥ cap $50.00")
        return {
            w.word: {"sentence": f"A sentence with {w.word}.", "word_position": 4,
                     "matched_form": w.word}
            for w in words
            if w.word not in self.fail_words
        }


# ─── import safety ──────────────────────────────────────────────────────────

def test_worker_importable_without_anthropic_sdk():
    """
    CI installs requirements-dev.txt, which omits the anthropic SDK, yet the
    worker (and this file) import WordRequest/CostCapExceeded from the LLM
    service. Guard that those imports never require the SDK — only
    instantiating LLMSentenceService may. Subprocess so the block on
    `anthropic` can't leak into other tests.
    """
    code = (
        "import sys; sys.modules['anthropic'] = None; "
        "import src.workers.sentence_worker"
    )
    proc = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        cwd=Path(__file__).resolve().parents[1],
    )
    assert proc.returncode == 0, proc.stderr


# ─── backlog SQL ────────────────────────────────────────────────────────────

def test_backlog_sql_targets_uncovered_movie_lemmas():
    sql = sw.build_backlog_sql(skip_ids=[], limit=100)
    # In some movie's vocabulary…
    assert "movie_lemma_mappings" in sql
    # …without a global LLM sentence…
    assert "sll.is_global" in sql
    # …never spending on admin-hidden words, most valuable lemmas first.
    assert "hidden_words" in sql
    assert "ORDER BY l.priority_score DESC" in sql
    assert "LIMIT 100" in sql
    assert "NOT IN (" not in sql.replace("NOT IN (SELECT", "")  # no skip clause


def test_backlog_sql_keeps_coverage_exclusion_uncorrelated():
    """
    The 'already covered' exclusion must be an uncorrelated NOT IN subplan
    (hashed once by Postgres), not a correlated NOT EXISTS: the anti-join
    plan the latter produced degraded past the client timeout as coverage
    grew, wedging the worker in a retry loop (2026-07-22 outage).
    """
    sql = sw.build_backlog_sql(skip_ids=[], limit=100)
    assert "NOT EXISTS" not in sql
    assert "l.id NOT IN (" in sql
    assert "SELECT sll.lemma_id" in sql


def test_backlog_sql_reads_the_denormalized_flag_not_a_join():
    """
    #120: the coverage subplan must filter on sentence_lemma_links.is_global,
    never by joining to sentence_bank. The join made this subplan walk 48,537
    sentences and probe a 7.7M-entry index once each — 145,783 buffers, 97% of
    the query — to rebuild the same answer on every worker cycle.
    """
    sql = sw.build_backlog_sql(skip_ids=[], limit=100)
    assert "sll.is_global" in sql
    assert "sentence_bank" not in sql


def test_backlog_sql_excludes_skip_ids():
    sql = sw.build_backlog_sql(skip_ids=[7, 3, 3], limit=10)
    assert "l.id NOT IN (3, 7)" in sql


# ─── run_cycle ──────────────────────────────────────────────────────────────

async def test_cycle_generates_in_chunks_and_reports_stored():
    rows = [_row(i, f"word{i}") for i in range(1, 6)]
    db = _FakeDb(pages=[rows])
    llm = _FakeLLM()
    skip: set[int] = set()

    result = await sw.run_cycle(db, llm, skip, page_size=5, batch_size=2, batch_sleep=0)

    assert result.outcome == "generated"
    assert result.fetched == 5
    assert result.stored == 5
    # 5 lemmas at batch_size 2 → 3 LLM calls of sizes 2, 2, 1.
    assert [len(c) for c in llm.calls] == [2, 2, 1]
    assert skip == set()


async def test_cycle_skips_lemmas_the_llm_could_not_cover():
    rows = [_row(1, "alpha"), _row(2, "beta"), _row(3, "gamma")]
    db = _FakeDb(pages=[rows])
    llm = _FakeLLM(fail_words={"beta"})
    skip: set[int] = set()

    result = await sw.run_cycle(db, llm, skip, page_size=10, batch_size=10, batch_sleep=0)

    assert result.stored == 2
    # beta failed → excluded from the next fetch so we never retry-loop it.
    assert skip == {2}


async def test_cycle_stops_at_cost_cap_keeping_partial_progress():
    rows = [_row(i, f"word{i}") for i in range(1, 5)]
    db = _FakeDb(pages=[rows])
    llm = _FakeLLM(cap_on_call=2)  # first chunk stores, second raises
    skip: set[int] = set()

    result = await sw.run_cycle(db, llm, skip, page_size=4, batch_size=2, batch_sleep=0)

    assert result.outcome == "cap"
    assert result.stored == 2


async def test_cycle_idles_when_backlog_is_empty():
    db = _FakeDb(pages=[[]])
    llm = _FakeLLM()

    result = await sw.run_cycle(db, llm, set(), page_size=10, batch_size=5, batch_sleep=0)

    assert result.outcome == "idle"
    assert llm.calls == []


async def test_skip_set_is_cleared_once_it_grows_past_the_cap(monkeypatch):
    monkeypatch.setattr(sw, "MAX_SKIP_IDS", 2)
    rows = [_row(1, "alpha"), _row(2, "beta"), _row(3, "gamma")]
    db = _FakeDb(pages=[rows])
    llm = _FakeLLM(fail_words={"alpha", "beta", "gamma"})
    skip: set[int] = set()

    await sw.run_cycle(db, llm, skip, page_size=10, batch_size=10, batch_sleep=0)

    # All three failed → set hit 3 > 2 → cleared so a later pass can retry.
    assert skip == set()


async def test_cycle_passes_cefr_and_lemma_ids_to_the_llm():
    rows = [_row(9, "wistful", cefr="C1"), _row(10, "plain", cefr=None)]
    db = _FakeDb(pages=[rows])
    llm = _FakeLLM()

    await sw.run_cycle(db, llm, set(), page_size=10, batch_size=10, batch_sleep=0)

    (call,) = llm.calls
    by_word = {w.word: w for w in call}
    assert by_word["wistful"].cefr == "C1"
    assert by_word["wistful"].lemma == "wistful"
    assert by_word["plain"].cefr is None
