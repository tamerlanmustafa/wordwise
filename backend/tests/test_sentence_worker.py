"""
Unit tests for the continuous sentence pre-generation worker (issue #86).

DB-free: a fake Prisma client returns canned backlog rows and a fake LLM
service records generate_and_store calls, so we assert the backlog SQL,
chunking, refusal persistence, and cost-cap handling without a live
Postgres or an Anthropic key.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from src.services.llm_sentence_service import CostCapExceeded, ModelCallFailed
from src.workers import sentence_worker as sw

SKIP_VERSION = "claude-haiku-4-5-20251001|1"


def _row(lemma_id: int, lemma: str, cefr: str | None = "B1") -> dict:
    return {"lemma_id": lemma_id, "lemma": lemma, "cefr_level": cefr}


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
    generate_and_store echoes back a result per word, minus `fail_words`,
    mirroring the real service (invalid sentences are silently dropped).
    `unreachable_on_call` mirrors the other failure mode: the API call never
    completed, so the model formed no opinion about any of the words.

    `unstorable_words` is the third: the model wrote a sentence and the
    database would not take it. Those words are absent from the result *and*
    reported in `persist_failures`, because the two are different facts and
    only one of them is about the word.
    """

    def __init__(
        self,
        fail_words: set[str] | None = None,
        cap_on_call: int | None = None,
        unreachable_on_call: int | None = None,
        skip_version: str = SKIP_VERSION,
        unstorable_words: set[str] | None = None,
    ):
        self.fail_words = fail_words or set()
        self.unstorable_words = unstorable_words or set()
        self.cap_on_call = cap_on_call
        self.unreachable_on_call = unreachable_on_call
        self.skip_version = skip_version
        self.calls: list[list] = []

    async def generate_and_store(
        self, db, *, words, lemma_id_map, context, persist_failures=None
    ):
        self.calls.append(list(words))
        if self.cap_on_call is not None and len(self.calls) >= self.cap_on_call:
            raise CostCapExceeded("spent $50.00 ≥ cap $50.00")
        if self.unreachable_on_call is not None and len(self.calls) >= self.unreachable_on_call:
            raise ModelCallFailed(
                "Error code: 400 - Your credit balance is too low to access "
                "the Anthropic API."
            )
        if persist_failures is not None:
            persist_failures.update(
                w.lemma.lower() for w in words if w.word in self.unstorable_words
            )
        return {
            w.word: {"sentence": f"A sentence with {w.word}.", "word_position": 4,
                     "matched_form": w.word}
            for w in words
            if w.word not in self.fail_words and w.word not in self.unstorable_words
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
    sql = sw.build_backlog_sql(limit=100)
    # In some movie's vocabulary…
    assert "movie_lemma_mappings" in sql
    # …without a global LLM sentence…
    assert "sll.is_global" in sql
    # …never spending on admin-hidden words, most valuable lemmas first.
    assert "hidden_words" in sql
    assert "ORDER BY l.priority_score DESC" in sql
    assert "LIMIT 100" in sql
    # The refusal list is a column predicate now, not a list of ids inlined
    # into the statement text (#153) — the only NOT IN left is the coverage
    # subplan below.
    assert "NOT IN (" not in sql.replace("NOT IN (SELECT", "")


def test_backlog_sql_keeps_coverage_exclusion_uncorrelated():
    """
    The 'already covered' exclusion must be an uncorrelated NOT IN subplan
    (hashed once by Postgres), not a correlated NOT EXISTS: the anti-join
    plan the latter produced degraded past the client timeout as coverage
    grew, wedging the worker in a retry loop (2026-07-22 outage).
    """
    sql = sw.build_backlog_sql(limit=100)
    assert "l.id NOT IN (" in sql
    assert "SELECT sll.lemma_id" in sql
    # The hidden_words check is correlated by design (see #129); this one
    # must never be.
    assert "NOT EXISTS (SELECT 1 FROM sentence_lemma_links" not in sql


def test_backlog_sql_guards_the_not_in_subquery_against_nulls():
    """
    #129: a single NULL reaching a NOT IN subquery makes the whole predicate
    return no rows, so the worker would go silently idle instead of erroring.
    sentence_lemma_links.lemma_id is NOT NULL today; the guard makes that a
    property of the query rather than an assumption about the schema.
    """
    sql = sw.build_backlog_sql(limit=100)
    assert "sll.lemma_id IS NOT NULL" in sql


def test_backlog_sql_probes_hidden_words_instead_of_reading_it_whole():
    """
    #129: `LOWER(l.lemma) NOT IN (SELECT LOWER(word) FROM hidden_words)` read
    all 34,095 rows on every cycle to build its hash — no index can serve a
    subquery that needs every row. The correlated form probes
    ix_hidden_words_word_lower for the few hundred lemmas that survive the
    other filters (prod: 41ms → 28ms, seq scan gone).
    """
    sql = sw.build_backlog_sql(limit=100)
    assert "NOT IN (SELECT LOWER(word) FROM hidden_words)" not in sql
    assert "NOT EXISTS (SELECT 1 FROM hidden_words hw" in sql
    assert "LOWER(hw.word) = LOWER(l.lemma)" in sql


def test_backlog_sql_reads_the_denormalized_flag_not_a_join():
    """
    #120: the coverage subplan must filter on sentence_lemma_links.is_global,
    never by joining to sentence_bank. The join made this subplan walk 48,537
    sentences and probe a 7.7M-entry index once each — 145,783 buffers, 97% of
    the query — to rebuild the same answer on every worker cycle.
    """
    sql = sw.build_backlog_sql(limit=100)
    assert "sll.is_global" in sql
    assert "sentence_bank" not in sql


# ─── persisted refusals (#153) ──────────────────────────────────────────────

def test_backlog_sql_excludes_lemmas_the_running_version_already_refused():
    """
    The skip list moved off the process and onto the row (#153). Before this,
    it was a `Set[int]` that was empty at boot, so every Railway deploy — and
    the Worker redeploys on every push to main — restarted the re-buy of the
    same ~2,000 refusals from the top of the backlog.
    """
    sql = sw.build_backlog_sql(limit=100)
    assert "l.sentence_skip_version IS DISTINCT FROM $1" in sql


def test_backlog_sql_uses_is_distinct_from_so_a_null_means_not_refused():
    """
    The one substitution that silently empties the backlog. `sentence_skip_version`
    is NULL for every lemma nobody has refused, and `NULL <> 'x'` evaluates to
    NULL rather than true — so a plain `<>` would filter out the entire table
    and the worker would report an empty backlog forever while the coverage gap
    grew. IS DISTINCT FROM is the three-valued-logic-safe comparison.
    """
    sql = sw.build_backlog_sql(limit=100)
    assert "IS DISTINCT FROM" in sql
    assert "sentence_skip_version <>" not in sql
    assert "sentence_skip_version =" not in sql
    # A bare "has it ever been refused" test would ban a word permanently on
    # one bad day; the predicate must compare against the running signature.
    assert "sentence_skip_version IS NOT NULL" not in sql
    assert "sentence_skip_at IS NULL" not in sql


async def test_fetch_binds_the_running_skip_version():
    db = _FakeDb(pages=[[]])
    await sw.fetch_backlog(db, SKIP_VERSION, 10)
    (_, args), = db.queries
    assert args == (SKIP_VERSION,)


async def test_refusals_are_persisted_against_the_running_version():
    """
    A refused lemma is written to the row, so the next process inherits what
    this one learned instead of paying to learn it again.
    """
    rows = [_row(1, "alpha"), _row(2, "beta"), _row(3, "gamma")]
    db = _FakeDb(pages=[rows])
    llm = _FakeLLM(fail_words={"beta"})

    result = await sw.run_cycle(db, llm, page_size=10, batch_size=10, batch_sleep=0)

    assert result.stored == 2
    assert result.refused == 1
    (sql, args), = db.writes
    assert "UPDATE lemmas" in sql
    assert "sentence_skip_at = NOW()" in sql
    assert "WHERE id IN (2)" in sql          # beta only — alpha and gamma stored
    assert args == (SKIP_VERSION,)


async def test_a_word_the_database_would_not_store_is_not_recorded_as_refused():
    """The third outcome, and the one that used to be invisible.

    `mark_refusals` stamps `sentence_skip_version`, which is permanent under
    the running prompt — the word is never asked about again. That is the right
    answer when the *model* declined it, and completely wrong when a connection
    reset dropped the insert: the word is fine, our write was not.

    Before this split the two were indistinguishable at this layer, and the
    service papered over it by swallowing every persistence error and reporting
    the word as stored — which is where the orphan sentences came from.
    """
    rows = [_row(1, "alpha"), _row(2, "beta"), _row(3, "gamma")]
    db = _FakeDb(pages=[rows])
    llm = _FakeLLM(fail_words={"beta"}, unstorable_words={"gamma"})

    result = await sw.run_cycle(db, llm, page_size=10, batch_size=10, batch_sleep=0)

    assert result.stored == 1          # alpha
    assert result.refused == 1         # beta — the model declined it
    (sql, _args), = db.writes
    assert "WHERE id IN (2)" in sql    # gamma is left alone for the next cycle
    assert "3" not in sql.split("WHERE id IN")[1]


async def test_a_page_that_will_not_persist_stops_instead_of_re_buying_it():
    """The cost loop this closes.

    A lemma whose write failed still has no sentence link, so the backlog hands
    it straight back on the next cycle — and the retry asks the model for a new
    sentence, which is a new charge. If persistence is broken for the whole
    page that repeats for ever, once per cycle, paying every time.

    Reporting nothing as stored is what stops it: the cycle's existing "nothing
    stored, we are spinning on hopeless words" backoff was already there and
    only needed to be told the truth.
    """
    rows = [_row(1, "alpha"), _row(2, "beta")]
    db = _FakeDb(pages=[rows])
    llm = _FakeLLM(unstorable_words={"alpha", "beta"})

    result = await sw.run_cycle(db, llm, page_size=10, batch_size=10, batch_sleep=0)

    assert result.stored == 0
    assert result.refused == 0        # nothing was the word's fault
    assert db.writes == []            # and nothing was written off


async def test_a_model_that_never_answered_records_no_refusals():
    """
    The reason this fix needed the ModelCallFailed split. `generate_sentences`
    used to swallow an API error and return all-None, which is byte-identical
    to "the model looked at these fifteen words and had nothing for any of
    them". Harmless while the skip list died with the process; catastrophic
    once it is written to `lemmas`. On 2026-08-22 prod's Anthropic credit
    balance ran out and every call started returning 400 — the old shape would
    have buried the entire 2,072-lemma backlog inside about fourteen cycles.
    """
    rows = [_row(i, f"word{i}") for i in range(1, 5)]
    db = _FakeDb(pages=[rows])
    llm = _FakeLLM(unreachable_on_call=1)

    result = await sw.run_cycle(db, llm, page_size=4, batch_size=2, batch_sleep=0)

    assert result.outcome == "unavailable"
    assert result.refused == 0
    assert db.writes == []


async def test_an_outage_keeps_refusals_learned_before_it():
    """The split is per-chunk, not all-or-nothing: a completed call's verdict
    is real and stays, an interrupted one records nothing."""
    rows = [_row(i, f"word{i}") for i in range(1, 5)]
    db = _FakeDb(pages=[rows])
    llm = _FakeLLM(fail_words={"word1", "word2"}, unreachable_on_call=2)

    result = await sw.run_cycle(db, llm, page_size=4, batch_size=2, batch_sleep=0)

    assert result.outcome == "unavailable"
    assert result.refused == 2                # chunk 1 completed and declined both
    (sql, _), = db.writes
    assert "WHERE id IN (1, 2)" in sql


async def test_no_write_is_issued_when_the_model_covered_everything():
    db = _FakeDb(pages=[[_row(1, "alpha")]])
    llm = _FakeLLM()

    result = await sw.run_cycle(db, llm, page_size=10, batch_size=10, batch_sleep=0)

    assert result.refused == 0
    assert db.writes == []


async def test_the_skip_version_comes_from_the_llm_service():
    """
    Revocation is the signature, not a cleanup job: the worker asks the
    service what would decline a word *right now* and stores that, so pointing
    at another model or bumping SENTENCE_PROMPT_VERSION re-admits every lemma
    the previous one refused — the stored string simply stops matching.
    """
    db = _FakeDb(pages=[[_row(1, "alpha")]])
    llm = _FakeLLM(fail_words={"alpha"}, skip_version="some-other-model|9")

    await sw.run_cycle(db, llm, page_size=10, batch_size=10, batch_sleep=0)

    (_, query_args), = db.queries
    (_, write_args), = db.writes
    assert query_args == ("some-other-model|9",)
    assert write_args == ("some-other-model|9",)


def test_the_process_lifetime_skip_cache_is_gone():
    """
    MAX_SKIP_IDS documented "a restart is the intended retry point", which
    stopped being true the day the Worker started auto-deploying on every push
    to main. The retry point is now a model or prompt change.
    """
    assert not hasattr(sw, "MAX_SKIP_IDS")


def test_skip_version_pins_both_the_model_and_the_prompt(monkeypatch):
    """
    Both halves of the signature have to be live, because both change what the
    model will accept. Dropping either one turns the skip from a cache into a
    graveyard: the words stay buried after the very change that would have let
    them through.

    Read off the class rather than an instance — constructing the service
    imports the anthropic SDK, which CI's requirements-dev.txt omits.
    """
    from types import SimpleNamespace

    from src.services import llm_sentence_service as svc

    read = svc.LLMSentenceService.skip_version.fget
    haiku = SimpleNamespace(_model="claude-haiku-4-5-20251001")

    baseline = read(haiku)
    assert "claude-haiku-4-5-20251001" in baseline
    assert svc.SENTENCE_PROMPT_VERSION in baseline

    # Point at another model → different signature → old refusals re-admitted.
    assert read(SimpleNamespace(_model="claude-sonnet-4-6")) != baseline
    # Edit the prompt and bump the constant → same, without touching the model.
    monkeypatch.setattr(svc, "SENTENCE_PROMPT_VERSION", "2")
    assert read(haiku) != baseline


# ─── run_cycle ──────────────────────────────────────────────────────────────

async def test_cycle_generates_in_chunks_and_reports_stored():
    rows = [_row(i, f"word{i}") for i in range(1, 6)]
    db = _FakeDb(pages=[rows])
    llm = _FakeLLM()

    result = await sw.run_cycle(db, llm, page_size=5, batch_size=2, batch_sleep=0)

    assert result.outcome == "generated"
    assert result.fetched == 5
    assert result.stored == 5
    # 5 lemmas at batch_size 2 → 3 LLM calls of sizes 2, 2, 1.
    assert [len(c) for c in llm.calls] == [2, 2, 1]
    assert db.writes == []


async def test_cycle_stops_at_cost_cap_keeping_partial_progress():
    rows = [_row(i, f"word{i}") for i in range(1, 5)]
    db = _FakeDb(pages=[rows])
    llm = _FakeLLM(cap_on_call=2)  # first chunk stores, second raises

    result = await sw.run_cycle(db, llm, page_size=4, batch_size=2, batch_sleep=0)

    assert result.outcome == "cap"
    assert result.stored == 2


async def test_cycle_idles_when_backlog_is_empty():
    db = _FakeDb(pages=[[]])
    llm = _FakeLLM()

    result = await sw.run_cycle(db, llm, page_size=10, batch_size=5, batch_sleep=0)

    assert result.outcome == "idle"
    assert llm.calls == []


async def test_cycle_passes_cefr_and_lemma_ids_to_the_llm():
    rows = [_row(9, "wistful", cefr="C1"), _row(10, "plain", cefr=None)]
    db = _FakeDb(pages=[rows])
    llm = _FakeLLM()

    await sw.run_cycle(db, llm, page_size=10, batch_size=10, batch_sleep=0)

    (call,) = llm.calls
    by_word = {w.word: w for w in call}
    assert by_word["wistful"].cefr == "C1"
    assert by_word["wistful"].lemma == "wistful"
    assert by_word["plain"].cefr is None


# ── daily coverage snapshot isolation (#154) ─────────────────────────────────

async def test_snapshot_failure_never_reaches_the_worker_cycle(monkeypatch, caplog):
    """The whole reason #154 stayed invisible for five days: this call swallows
    everything, on purpose, because a failed metric must not stop sentence
    generation. Pin that — a raising snapshot returns False and logs, it does
    not propagate. The visibility half is vocab_snapshot_age on the report."""
    import src.services.vocab_coverage as vc

    async def _boom(db, *a, **k):
        raise RuntimeError(
            'could not resize shared memory segment "/PostgreSQL.1" to 8388608 '
            "bytes: No space left on device"
        )

    monkeypatch.setattr(vc, "maybe_write_daily_snapshot", _boom)

    with caplog.at_level("WARNING"):
        wrote = await sw.write_coverage_snapshot_if_due(_FakeDb(pages=[]))

    assert wrote is False
    assert "coverage snapshot skipped" in caplog.text


async def test_snapshot_success_is_reported(monkeypatch):
    import src.services.vocab_coverage as vc

    async def _wrote(db, *a, **k):
        return True

    monkeypatch.setattr(vc, "maybe_write_daily_snapshot", _wrote)
    assert await sw.write_coverage_snapshot_if_due(_FakeDb(pages=[])) is True
