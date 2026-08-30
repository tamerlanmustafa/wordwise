"""
Continuous learner-definition pre-generation worker.

Long-running process that drains the "no definition yet" backlog: every lemma
that already has a global LLM example sentence but no `lemmas.definition`. The
definition is the one-line gloss under the word on the Explore card and the
movie-detail card deck.

WHY IT IS DOWNSTREAM OF THE SENTENCE WORKER, NOT PART OF IT
-----------------------------------------------------------
The definition must describe the sense the card's example sentence uses, not
the word's most frequent sense — otherwise a polysemous word gets a definition
that contradicts both the sentence beside it and the aligned gloss beneath it
(`word_sentence_examples.word_translation`, see ALIGN_SYSTEM_PROMPT). The
sentence is therefore the sense anchor, and it is an *input* here.

That could instead have been one call: extend SYSTEM_PROMPT so sentence
generation also returns a definition. Two things ruled it out. Changing that
prompt bumps SENTENCE_PROMPT_VERSION, which by design re-admits every lemma
the running model has refused (#153) — on prod 2026-08-23 that residue was
2,072 lemmas, re-bought for nothing. And 34,849 of 42,668 lemmas already have
a sentence, so the sentence-anchored backfill prompt has to exist regardless;
folding it in would have meant building and maintaining both. One prompt, one
worker, and new lemmas get a definition on the cycle after their sentence.

The cost of the split is one extra input pass over the sentence (~15 tokens
per lemma). At Haiku's input rate that is under a dollar across the corpus.

STATE MODEL
-----------
Unlike the sentence worker, which records only refusals, this worker stamps
`lemmas.definition_version` on every *completed* attempt. Three states from
two columns:

    definition_version IS NULL                          never attempted
    definition_version set AND definition IS NOT NULL   generated
    definition_version set AND definition IS NULL       model declined

so the backlog predicate `definition_version IS DISTINCT FROM <signature>`
is simultaneously "not done" and "not refused by the running prompt", and
bumping DEFINITION_PROMPT_VERSION re-admits the whole corpus for a rewrite.

Because the same column marks success, a mis-recorded outage is worse here
than it was in #153: writing the signature for a batch the model never saw
would mark those lemmas permanently *done* with an empty definition, and no
future cycle would revisit them. Hence the same hard split as the sentence
worker — a cycle that cannot reach the model returns "unavailable" and writes
nothing at all.

    python -m src.workers.definition_worker

Tunables (env):
    DEFINITION_WORKER_ENABLED      set to 1 to enable       (default OFF —
                                   shares LLM_COST_CAP_USD with the sentence
                                   worker and there is no sub-budget, so
                                   raise the cap before switching it on;
                                   see docker/start-workers.sh)
    DEFINITION_WORKER_BATCH_SIZE   lemmas per LLM call      (default 15)
    DEFINITION_WORKER_PAGE_SIZE    lemmas per DB query      (default 150)
    DEFINITION_WORKER_BATCH_SLEEP  seconds between calls    (default 2)
    DEFINITION_WORKER_IDLE_SLEEP   seconds when caught up   (default 900)
    DEFINITION_WORKER_CAP_SLEEP    seconds after cost cap   (default 3600)
    DEFINITION_WORKER_UNAVAIL_SLEEP seconds after outage    (default 300)
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys
from dataclasses import dataclass
from typing import List

from src.services.hidden_words import hidden_word_exclusion_sql
from src.services.llm_sentence_service import (
    CostCapExceeded,
    DefinitionRequest,
    ModelCallFailed,
)

logger = logging.getLogger("wordwise.definition_worker")

BATCH_SIZE = int(os.environ.get("DEFINITION_WORKER_BATCH_SIZE", "15"))
PAGE_SIZE = int(os.environ.get("DEFINITION_WORKER_PAGE_SIZE", "150"))
BATCH_SLEEP = float(os.environ.get("DEFINITION_WORKER_BATCH_SLEEP", "2"))
IDLE_SLEEP = float(os.environ.get("DEFINITION_WORKER_IDLE_SLEEP", "900"))
CAP_SLEEP = float(os.environ.get("DEFINITION_WORKER_CAP_SLEEP", "3600"))
UNAVAILABLE_SLEEP = float(os.environ.get("DEFINITION_WORKER_UNAVAIL_SLEEP", "300"))
ERROR_SLEEP = 30.0


def build_backlog_sql(limit: int) -> str:
    """
    Lemmas that have a global LLM sentence but no definition from the running
    prompt, highest priority_score first so the words users actually hit are
    covered before the tail.

    The sentence comes back with the row. Fetching it here rather than in a
    second query is what makes the whole cycle two round trips instead of
    N+1: the definition prompt needs the sentence text for every lemma in the
    batch, so a separate lookup would be a per-lemma read of the same 7.7M-row
    link table the DISTINCT ON already walks.

    Four properties are inherited from the sentence worker's backlog query
    (see its docstring for the measurements behind each):

      * `sll.is_global` rather than a join to sentence_bank (#120) — the same
        predicate denormalized onto the link and kept true by trigger, so the
        global-LLM set is a 2 MB partial index probe instead of 48,537 B-tree
        descents rebuilt every cycle.
      * `IS DISTINCT FROM`, never `<>`. `NULL <> 'x'` is NULL, so `<>` would
        filter out every lemma never attempted — the entire backlog on day one
        — and the worker would start life permanently idle.
      * The version predicate is on `lemmas` itself, not a join or subquery,
        so it rides the existing walk of ix_lemmas_priority_score.
      * hidden_words is excluded correlated, via hidden_word_exclusion_sql, so
        the planner applies it last against the few rows that survive (#129).

    UNKNOWN-level lemmas are excluded for the same reason the sentence worker
    excludes them (#91): they are never displayed, so a definition for one is
    spend with no surface to appear on.

    The lateral picks the same sentence every read path shows — representative
    link first, then score, then sentence_id — so the definition is anchored to
    the sentence the user will actually see, not merely to *a* sentence for the
    lemma. The ORDER BY states the tie-break on the link side
    (`sll.sentence_id`) to match ix_sll_global_lemma's key order, the same
    reason /srs/feed spells it that way.

    It is a LATERAL rather than a joined DISTINCT ON because the LIMIT is
    applied to `lemmas` first: the subquery runs once per surviving row, not
    once per lemma in the registry. Measured on prod 2026-08-30 at page_size
    150, with the backlog completely undrained (the worst case — every lemma
    still qualifies):

        Execution Time: 2.203 ms   Buffers: shared hit=1,829

        Index Scan Backward using ix_lemmas_priority_score  (163 rows read)
        Index Only Scan using ix_sll_global_lemma           (162 loops)
        Index Scan using ix_hidden_words_word_lower         (163 loops)

    All three of the intended indexes, no seq scan, and an order of magnitude
    under the sentence worker's equivalent query (24.8 ms / 9,554 buffers) —
    that one has to hash the whole coverage set to ask "which lemmas have NO
    sentence", where this one only has to fetch a sentence it knows exists.

    `limit` is a server-side integer, safe to inline. The signature is bound as
    $1: it is the only string here, and a parameter means no quoting rule to
    get wrong.
    """
    return f"""
        SELECT l.id AS lemma_id,
               l.lemma AS lemma,
               l.cefr_level AS cefr_level,
               s.sentence AS sentence
        FROM lemmas l
        JOIN LATERAL (
            SELECT sb.sentence
            FROM sentence_lemma_links sll
            JOIN sentence_bank sb ON sb.id = sll.sentence_id
            WHERE sll.lemma_id = l.id
              AND sll.is_global
            ORDER BY sll.is_representative DESC,
                     sll.score DESC NULLS LAST,
                     sll.sentence_id ASC
            LIMIT 1
        ) s ON TRUE
        WHERE l.definition_version IS DISTINCT FROM $1::varchar
          AND l.cefr_level <> 'UNKNOWN'
          AND {hidden_word_exclusion_sql("l.lemma")}
        ORDER BY l.priority_score DESC, l.id
        LIMIT {int(limit)}
    """


async def fetch_backlog(db, definition_version: str, limit: int) -> List[dict]:
    return await db.query_raw(build_backlog_sql(limit), definition_version)


async def record_results(
    db,
    definitions: dict,
    chunk: List[dict],
    definition_version: str,
) -> tuple[int, int]:
    """
    Write one completed batch: the definitions that passed validation, and the
    signature on every lemma in the batch — including the refusals, so no
    future cycle or process pays for them again.

    Returns (stored, refused).

    Called once per chunk rather than once per cycle for the same reason
    mark_refusals is: a cycle can end early at the cost cap, and what the model
    already answered should survive that.

    Callers must only reach here for a call that actually completed. See the
    module docstring — writing this signature for a batch the model never saw
    marks those lemmas permanently done with no definition.
    """
    stored = 0
    refused_ids: List[int] = []
    for row in chunk:
        lemma_id = int(row["lemma_id"])
        definition = definitions.get(row["lemma"].lower())
        if definition:
            await db.execute_raw(
                "UPDATE lemmas SET definition = $1, definition_version = $2 "
                "WHERE id = $3",
                definition,
                definition_version,
                lemma_id,
            )
            stored += 1
        else:
            refused_ids.append(lemma_id)

    if refused_ids:
        # Ids are server-side integers from the rows we just fetched and there
        # are at most batch_size of them, so inlining keeps the statement free
        # of array parameters — same call the sentence worker makes.
        ids_sql = ", ".join(str(i) for i in sorted(set(refused_ids)))
        await db.execute_raw(
            "UPDATE lemmas SET definition = NULL, definition_version = $1 "
            f"WHERE id IN ({ids_sql})",
            definition_version,
        )
    return stored, len(refused_ids)


@dataclass
class CycleResult:
    outcome: str  # "generated" | "idle" | "cap" | "unavailable"
    fetched: int = 0
    stored: int = 0
    refused: int = 0


async def run_cycle(
    db,
    llm,
    *,
    page_size: int = PAGE_SIZE,
    batch_size: int = BATCH_SIZE,
    batch_sleep: float = BATCH_SLEEP,
) -> CycleResult:
    """
    One pass: fetch a page of undefined lemmas with their anchor sentences and
    define them in batch_size chunks.

    Returns "cap" as soon as the cost cap interrupts a chunk and "unavailable"
    as soon as a call fails to reach the model. Both keep the work already
    written — record_results runs per chunk — but "unavailable" writes nothing
    for the chunk that failed, or any later one.
    """
    definition_version = llm.definition_version
    rows = await fetch_backlog(db, definition_version, page_size)
    if not rows:
        return CycleResult(outcome="idle")

    stored_total = 0
    refused_total = 0
    for i in range(0, len(rows), batch_size):
        chunk = rows[i : i + batch_size]
        requests = [
            DefinitionRequest(
                lemma=r["lemma"],
                cefr=(str(r["cefr_level"]) if r.get("cefr_level") else None),
                sentence=r["sentence"],
            )
            for r in chunk
        ]
        try:
            definitions = await llm.define_words(
                db, requests, context="definition_worker"
            )
        except CostCapExceeded as cap_err:
            logger.warning("[definition-worker] %s", cap_err)
            return CycleResult(
                outcome="cap",
                fetched=len(rows),
                stored=stored_total,
                refused=refused_total,
            )
        except ModelCallFailed as call_err:
            logger.warning(
                "[definition-worker] model unreachable (%s); recording nothing "
                "for this chunk",
                call_err,
            )
            return CycleResult(
                outcome="unavailable",
                fetched=len(rows),
                stored=stored_total,
                refused=refused_total,
            )

        stored, refused = await record_results(
            db, definitions, chunk, definition_version
        )
        stored_total += stored
        refused_total += refused

        if batch_sleep > 0 and i + batch_size < len(rows):
            await asyncio.sleep(batch_sleep)

    return CycleResult(
        outcome="generated",
        fetched=len(rows),
        stored=stored_total,
        refused=refused_total,
    )


async def run_forever() -> None:
    """Process entrypoint: connect, then loop cycles until SIGINT/SIGTERM."""
    from prisma import Prisma

    stop = asyncio.Event()

    def _handle_signal(*_):
        logger.info("[definition-worker] shutdown signal received")
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _handle_signal)
        except NotImplementedError:
            # Windows
            signal.signal(sig, _handle_signal)

    async def _sleep(seconds: float) -> None:
        # Race the stop event against the sleep so SIGTERM stays responsive
        # even during the long idle/cap waits.
        try:
            await asyncio.wait_for(stop.wait(), timeout=seconds)
        except asyncio.TimeoutError:
            pass

    from src.services.admin_alerts import ConsecutiveFailureAlerter

    db = Prisma()
    await db.connect()
    logger.info("[definition-worker] starting (page=%d batch=%d)", PAGE_SIZE, BATCH_SIZE)

    alerter = ConsecutiveFailureAlerter("definition-worker", fetch_rows=db.query_raw)

    llm = None
    try:
        while not stop.is_set():
            if llm is None:
                try:
                    from src.services.llm_sentence_service import LLMSentenceService

                    llm = LLMSentenceService()
                except Exception as exc:
                    # Most likely ANTHROPIC_API_KEY unset. Don't exit — the
                    # start script restarts the whole container when any
                    # process dies, which would crash-loop the job worker too.
                    logger.error(
                        "[definition-worker] LLM unavailable (%s); retrying in %.0fs",
                        exc,
                        IDLE_SLEEP,
                    )
                    await _sleep(IDLE_SLEEP)
                    continue

            try:
                result = await run_cycle(db, llm)
            except Exception as exc:
                logger.exception("[definition-worker] cycle failed: %s", exc)
                await alerter.record_failure(exc)
                await _sleep(ERROR_SLEEP)
                continue

            # An unreachable model is a failure even though the cycle returned
            # cleanly: nothing is being generated and nothing is being learned,
            # so it counts toward the alert rather than resetting it (#154).
            if result.outcome == "unavailable":
                await alerter.record_failure(
                    ModelCallFailed("definition generation API unreachable")
                )
            else:
                await alerter.record_success()

            if result.outcome == "generated":
                logger.info(
                    "[definition-worker] cycle done fetched=%d stored=%d refused=%d",
                    result.fetched,
                    result.stored,
                    result.refused,
                )
                # Nothing stored means the page was all refusals — back off
                # instead of immediately re-paging behind them.
                if result.stored == 0:
                    await _sleep(ERROR_SLEEP)
            elif result.outcome == "unavailable":
                logger.warning(
                    "[definition-worker] model unreachable; sleeping %.0fs",
                    UNAVAILABLE_SLEEP,
                )
                await _sleep(UNAVAILABLE_SLEEP)
            elif result.outcome == "cap":
                logger.warning(
                    "[definition-worker] cost cap reached; sleeping %.0fs", CAP_SLEEP
                )
                await _sleep(CAP_SLEEP)
            else:  # idle — every lemma with a sentence now has a definition
                logger.info(
                    "[definition-worker] backlog empty; sleeping %.0fs", IDLE_SLEEP
                )
                await _sleep(IDLE_SLEEP)
    finally:
        await db.disconnect()
        logger.info("[definition-worker] stopped")


def main() -> None:
    from ..logging_config import configure_logging

    configure_logging(
        level=os.environ.get("WORKER_LOG_LEVEL", "INFO"),
        service="definition-worker",
    )
    try:
        asyncio.run(run_forever())
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
