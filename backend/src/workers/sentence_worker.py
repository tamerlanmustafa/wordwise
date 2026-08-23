"""
Continuous example-sentence pre-generation worker (issue #86).

Long-running process that drains the "uncovered lemma" backlog: every lemma
that appears in some movie's vocabulary (movie_lemma_mappings) but has no
global LLM sentence (sentence_bank.movie_id IS NULL, source='llm') yet.
Generating ahead of time means the batch read path serves a cached row
instead of firing its on-request LLM slow path, so movie word lists load
fast on first click.

Same storage shape and cost controls as backfill_llm_sentences.py — global
SentenceBank rows shared across movies, spend capped cumulatively by
LLM_COST_CAP_USD via LLMSentenceService. Unlike the one-shot backfill this
keeps running: newly ingested movies push new lemmas into the backlog and
the worker picks them up on its next cycle.

Runs as the third process in the background-worker container (see
docker/start-workers.sh); disable with SENTENCE_WORKER_ENABLED=0.

A lemma the model declines (returned null / validation rejected) is recorded
on the row itself — lemmas.sentence_skip_at / sentence_skip_version — so the
loop never burns spend retrying the same bad word, and never re-learns it
after a restart (#153). Only a *completed* call can record a refusal: if the
API itself is unreachable the cycle ends as "unavailable" and writes nothing,
because an outage is not a fact about the word.

    python -m src.workers.sentence_worker

Tunables (env):
    SENTENCE_WORKER_BATCH_SIZE   words per LLM call            (default 15)
    SENTENCE_WORKER_PAGE_SIZE    lemmas fetched per DB query   (default 150)
    SENTENCE_WORKER_BATCH_SLEEP  seconds between LLM calls     (default 2)
    SENTENCE_WORKER_IDLE_SLEEP   seconds when backlog is empty (default 900)
    SENTENCE_WORKER_CAP_SLEEP    seconds after cost-cap hit    (default 3600)
    SENTENCE_WORKER_UNAVAIL_SLEEP seconds after an LLM outage  (default 300)
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys
from dataclasses import dataclass
from typing import Iterable, List

from src.services.hidden_words import hidden_word_exclusion_sql
from src.services.llm_sentence_service import (
    CostCapExceeded,
    ModelCallFailed,
    WordRequest,
)

logger = logging.getLogger("wordwise.sentence_worker")

BATCH_SIZE = int(os.environ.get("SENTENCE_WORKER_BATCH_SIZE", "15"))
PAGE_SIZE = int(os.environ.get("SENTENCE_WORKER_PAGE_SIZE", "150"))
BATCH_SLEEP = float(os.environ.get("SENTENCE_WORKER_BATCH_SLEEP", "2"))
IDLE_SLEEP = float(os.environ.get("SENTENCE_WORKER_IDLE_SLEEP", "900"))
CAP_SLEEP = float(os.environ.get("SENTENCE_WORKER_CAP_SLEEP", "3600"))
# Long enough that a dead API key or an empty credit balance is not retried
# every half minute for hours, short enough that a 5xx blip costs one page of
# progress. Five consecutive waits (~25 min) trips the admin alert.
UNAVAILABLE_SLEEP = float(os.environ.get("SENTENCE_WORKER_UNAVAIL_SLEEP", "300"))
ERROR_SLEEP = 30.0


def build_backlog_sql(limit: int) -> str:
    """
    Lemmas that appear in at least one movie's vocabulary but have no global
    LLM sentence yet. Excludes admin-hidden words (never displayed, so not
    worth spend), UNKNOWN-level words (#91 — the classifier could not place
    them, so they are never displayed either, and they are exactly the
    proper-noun residue the LLM keeps declining) and lemmas the running model
    has already declined. Highest priority_score first so the words users hit
    most get covered first.

    The refusal exclusion is `sentence_skip_version IS DISTINCT FROM $1`
    (#153). It replaces a process-local `Set[int]` that was empty at boot, so
    every Railway deploy — several a day, since the Worker redeploys on every
    push to main — restarted the re-buy of the same ~2,000 refusals from the
    top of the backlog. Three properties are load-bearing:

      * `IS DISTINCT FROM`, never `<>`. `NULL <> 'x'` evaluates to NULL, not
        true, so `<>` would filter out every lemma that has never been
        refused — the whole backlog — and the worker would go silently idle.
      * The parameter is the *running* signature, not a boolean. A lemma is
        skipped only while the model and prompt that declined it are still the
        ones in use, so changing either revokes every skip it produced without
        a cleanup pass. See LLMSentenceService.skip_version.
      * It is a predicate on `lemmas` itself, not a join or a subquery, so it
        rides the existing backward walk of ix_lemmas_priority_score and adds
        no scan. Measured on prod 2026-08-23: 24.8 ms / 9,554 buffers with
        nothing skipped, 46.6 ms / 19,047 buffers with the whole 2,072-lemma
        residue skipped (a full index walk returning zero rows, once per
        900 s idle cycle). No index; see the manual migration for why.

    The two exclusions use opposite idioms on purpose — the right one depends
    on how big the excluded set is.

    The "no LLM sentence yet" exclusion must stay an uncorrelated
    `l.id NOT IN (SELECT …)`: Postgres hashes that subplan once, keeping the
    query ~60ms. As a correlated NOT EXISTS the planner picked a nested-loop
    anti-join over the 7.7M-row link table that degraded past the 30s client
    timeout once coverage grew, deadlocking the worker in a timeout/retry loop
    (2026-07-22 outage). The subquery carries an explicit `lemma_id IS NOT
    NULL` because NOT IN returns *no rows at all* if one NULL reaches the
    hash — the worker would silently go idle rather than fail. The column is
    NOT NULL today, so this costs nothing (the subplan stays an index-only
    scan) and removes the load-bearing schema assumption (#129).

    The hidden_words exclusion goes the other way, via
    hidden_word_exclusion_sql: `LOWER(l.lemma) NOT IN (SELECT LOWER(word) …)`
    had to read all 34,095 rows on every cycle to build its hash — no index
    can serve a subquery that needs every row. Correlated, it becomes a
    per-row probe of ix_hidden_words_word_lower that the planner applies last,
    against the few hundred lemmas that survived the other filters. Measured
    in prod: 41ms → 28ms, and the seq scan is gone (#129).

    That subplan reads `sll.is_global` rather than joining to sentence_bank
    (#120). The join had to walk 48,537 sentences and probe a 7.7M-entry index
    once per sentence — 145,783 buffers, 97% of this query's cost — to rebuild
    the same 44k-row answer on every cycle. `is_global` is the same predicate
    denormalized onto the link and kept true by trigger, so the subplan is now
    an index-only scan of a 2 MB partial index.

    `limit` is a server-side integer, safe to inline. The skip signature is
    bound as $1 rather than interpolated: it is the only value here that is a
    string, and a parameter means there is no quoting rule to get wrong.
    """
    return f"""
        SELECT l.id AS lemma_id, l.lemma AS lemma, l.cefr_level AS cefr_level
        FROM lemmas l
        WHERE EXISTS (
            SELECT 1 FROM movie_lemma_mappings mlm WHERE mlm.lemma_id = l.id
        )
        AND l.id NOT IN (SELECT sll.lemma_id
            FROM sentence_lemma_links sll
            WHERE sll.is_global AND sll.lemma_id IS NOT NULL
        )
        AND {hidden_word_exclusion_sql("l.lemma")}
        AND l.cefr_level <> 'UNKNOWN'
        AND l.sentence_skip_version IS DISTINCT FROM $1::varchar
        ORDER BY l.priority_score DESC, l.id
        LIMIT {int(limit)}
    """


async def fetch_backlog(db, skip_version: str, limit: int) -> List[dict]:
    return await db.query_raw(build_backlog_sql(limit), skip_version)


async def mark_refusals(db, lemma_ids: Iterable[int], skip_version: str) -> int:
    """
    Record that the running model declined these lemmas, so no future cycle —
    or future process — pays for them again (#153).

    Called once per LLM chunk rather than once per cycle on purpose: a cycle
    can end early at the cost cap, and what was already learned should survive
    that. Ids are server-side integers from the row we just fetched and there
    are at most `batch_size` of them, so inlining costs nothing and keeps the
    statement free of array parameters.

    Callers must only reach here for a call that actually completed. A failed
    call yields the same empty result as a total refusal, and writing that
    would bury the whole backlog permanently — see ModelCallFailed.
    """
    ids = sorted({int(i) for i in lemma_ids})
    if not ids:
        return 0
    await db.execute_raw(
        "UPDATE lemmas SET sentence_skip_at = NOW(), sentence_skip_version = $1 "
        f"WHERE id IN ({', '.join(map(str, ids))})",
        skip_version,
    )
    return len(ids)


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
    One pass: fetch a page of uncovered lemmas and generate sentences for
    them in batch_size chunks. Lemmas the model declined are written to
    `lemmas.sentence_skip_*` so neither the next cycle nor the next process
    pays for them again.

    Returns "cap" as soon as the cost cap interrupts a chunk, and
    "unavailable" as soon as a call fails to reach the model. Both keep the
    partial work already done — generate_and_store persists per sentence, and
    mark_refusals runs per chunk — but "unavailable" records no refusals at
    all, for that chunk or any later one: the model never saw those words.
    """
    skip_version = llm.skip_version
    rows = await fetch_backlog(db, skip_version, page_size)
    if not rows:
        return CycleResult(outcome="idle")

    stored_total = 0
    refused_total = 0
    for i in range(0, len(rows), batch_size):
        chunk = rows[i : i + batch_size]
        lemma_id_map = {r["lemma"].lower(): r["lemma_id"] for r in chunk}
        word_reqs = [
            WordRequest(
                word=r["lemma"],
                lemma=r["lemma"],
                cefr=(str(r["cefr_level"]) if r.get("cefr_level") else None),
            )
            for r in chunk
        ]
        try:
            results = await llm.generate_and_store(
                db,
                words=word_reqs,
                lemma_id_map=lemma_id_map,
                context="sentence_worker",
            )
        except CostCapExceeded as cap_err:
            logger.warning("[sentence-worker] %s", cap_err)
            return CycleResult(
                outcome="cap",
                fetched=len(rows),
                stored=stored_total,
                refused=refused_total,
            )
        except ModelCallFailed as call_err:
            logger.warning(
                "[sentence-worker] model unreachable (%s); recording no "
                "refusals for this chunk",
                call_err,
            )
            return CycleResult(
                outcome="unavailable",
                fetched=len(rows),
                stored=stored_total,
                refused=refused_total,
            )

        stored_lemmas = {w.lower() for w in results}
        stored_total += len(stored_lemmas)
        refused_total += await mark_refusals(
            db,
            (r["lemma_id"] for r in chunk if r["lemma"].lower() not in stored_lemmas),
            skip_version,
        )

        if batch_sleep > 0 and i + batch_size < len(rows):
            await asyncio.sleep(batch_sleep)

    return CycleResult(
        outcome="generated",
        fetched=len(rows),
        stored=stored_total,
        refused=refused_total,
    )


async def write_coverage_snapshot_if_due(db) -> bool:
    """Write the daily vocab-coverage snapshot, swallowing anything it raises.

    The isolation is deliberate: a snapshot is observability, and observability
    failing must never stop the worker generating sentences. Returns True when a
    row was actually written.

    Swallowing it is also how the failure stayed invisible for five days
    (#154) — a WARN in the logs is not a signal anyone receives. The visible
    half now lives on the report itself: `vocab_snapshot_age` turns
    /admin/health/vocab-coverage red once no row has landed for three days, so
    this handler can keep being quiet without the outage being quiet too.
    """
    try:
        from src.services.vocab_coverage import maybe_write_daily_snapshot

        return await maybe_write_daily_snapshot(db)
    except Exception as exc:
        logger.warning("[sentence-worker] coverage snapshot skipped: %s", exc)
        return False


async def run_forever() -> None:
    """Process entrypoint: connect, then loop cycles until SIGINT/SIGTERM."""
    from prisma import Prisma

    stop = asyncio.Event()

    def _handle_signal(*_):
        logger.info("[sentence-worker] shutdown signal received")
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
    logger.info("[sentence-worker] starting (page=%d batch=%d)", PAGE_SIZE, BATCH_SIZE)

    # Email admins if cycles fail back-to-back (~3+ min stuck at the default
    # threshold of 5 × ERROR_SLEEP) — a silent retry loop here is a prod
    # outage nobody sees otherwise (2026-07-22).
    alerter = ConsecutiveFailureAlerter("sentence-worker", fetch_rows=db.query_raw)

    llm = None
    try:
        while not stop.is_set():
            # Once-daily vocab-coverage snapshot. Runs before the LLM check so
            # it still fires when the LLM is unavailable; short-circuits on a
            # single indexed lookup when a recent snapshot already exists.
            await write_coverage_snapshot_if_due(db)

            if llm is None:
                try:
                    from src.services.llm_sentence_service import LLMSentenceService

                    llm = LLMSentenceService()
                except Exception as exc:
                    # Most likely ANTHROPIC_API_KEY unset. Don't exit — the
                    # start script restarts the whole container when any
                    # process dies, which would crash-loop the job worker too.
                    logger.error(
                        "[sentence-worker] LLM unavailable (%s); retrying in %.0fs",
                        exc,
                        IDLE_SLEEP,
                    )
                    await _sleep(IDLE_SLEEP)
                    continue

            try:
                result = await run_cycle(db, llm)
            except Exception as exc:
                logger.exception("[sentence-worker] cycle failed: %s", exc)
                await alerter.record_failure(exc)
                await _sleep(ERROR_SLEEP)
                continue

            # An unreachable model is a failure even though the cycle returned
            # cleanly: nothing is being generated and nothing is being learned,
            # so it must count toward the alert rather than resetting it. On
            # 2026-08-22 the Anthropic credit balance ran out and the worker
            # churned for 35 hours without anyone hearing about it.
            if result.outcome == "unavailable":
                await alerter.record_failure(
                    ModelCallFailed("sentence generation API unreachable")
                )
            else:
                # Any other completed cycle (generated/cap/idle) means the loop
                # is healthy — cap and idle are expected states, not failures.
                await alerter.record_success()

            if result.outcome == "generated":
                logger.info(
                    "[sentence-worker] cycle done fetched=%d stored=%d refused=%d",
                    result.fetched,
                    result.stored,
                    result.refused,
                )
                # If nothing in the page stored we're spinning on hopeless
                # lemmas (all newly refused) — back off instead of re-paging.
                if result.stored == 0:
                    await _sleep(ERROR_SLEEP)
            elif result.outcome == "unavailable":
                logger.warning(
                    "[sentence-worker] model unreachable; sleeping %.0fs",
                    UNAVAILABLE_SLEEP,
                )
                await _sleep(UNAVAILABLE_SLEEP)
            elif result.outcome == "cap":
                logger.warning(
                    "[sentence-worker] cost cap reached; sleeping %.0fs", CAP_SLEEP
                )
                await _sleep(CAP_SLEEP)
            else:  # idle — backlog fully covered for now
                logger.info(
                    "[sentence-worker] backlog empty; sleeping %.0fs", IDLE_SLEEP
                )
                await _sleep(IDLE_SLEEP)
    finally:
        await db.disconnect()
        logger.info("[sentence-worker] stopped")


def main() -> None:
    from ..logging_config import configure_logging

    configure_logging(
        level=os.environ.get("WORKER_LOG_LEVEL", "INFO"),
        service="sentence-worker",
    )
    try:
        asyncio.run(run_forever())
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
