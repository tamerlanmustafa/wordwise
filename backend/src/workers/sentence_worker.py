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
docker/start-workers.sh); disable with SENTENCE_WORKER_ENABLED=0. Lemmas
whose generation fails (LLM returned null / validation rejected) are
skipped for the life of the process so the loop never burns spend retrying
the same bad word; a restart retries them.

    python -m src.workers.sentence_worker

Tunables (env):
    SENTENCE_WORKER_BATCH_SIZE   words per LLM call            (default 15)
    SENTENCE_WORKER_PAGE_SIZE    lemmas fetched per DB query   (default 150)
    SENTENCE_WORKER_BATCH_SLEEP  seconds between LLM calls     (default 2)
    SENTENCE_WORKER_IDLE_SLEEP   seconds when backlog is empty (default 900)
    SENTENCE_WORKER_CAP_SLEEP    seconds after cost-cap hit    (default 3600)
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys
from dataclasses import dataclass
from typing import Iterable, List, Set

from src.services.llm_sentence_service import CostCapExceeded, WordRequest

logger = logging.getLogger("wordwise.sentence_worker")

BATCH_SIZE = int(os.environ.get("SENTENCE_WORKER_BATCH_SIZE", "15"))
PAGE_SIZE = int(os.environ.get("SENTENCE_WORKER_PAGE_SIZE", "150"))
BATCH_SLEEP = float(os.environ.get("SENTENCE_WORKER_BATCH_SLEEP", "2"))
IDLE_SLEEP = float(os.environ.get("SENTENCE_WORKER_IDLE_SLEEP", "900"))
CAP_SLEEP = float(os.environ.get("SENTENCE_WORKER_CAP_SLEEP", "3600"))
ERROR_SLEEP = 30.0

# Failed lemmas are only skipped in memory; once the set grows past this we
# drop it and give everything another chance rather than growing unbounded.
# Must exceed the lemma table (~158k) so it never trips mid-run: the fetch
# is priority-ordered, so clearing would immediately re-attempt the *most*
# failure-prone words (top of the backlog is the proper-noun residue the
# backfill already declined — first prod cycle skipped 121 of 150). A
# restart is the intended retry point.
MAX_SKIP_IDS = 250_000


def build_backlog_sql(skip_ids: Iterable[int], limit: int) -> str:
    """
    Lemmas that appear in at least one movie's vocabulary but have no global
    LLM sentence yet. Excludes admin-hidden words (never displayed, so not
    worth spend) and `skip_ids` (failed in this process). Highest
    priority_score first so the words users hit most get covered first.

    The "no LLM sentence yet" exclusion must stay an uncorrelated
    `l.id NOT IN (SELECT …)` — Postgres hashes that subplan once (like the
    hidden_words one), keeping the query ~60ms. As a correlated NOT EXISTS
    the planner picked a nested-loop anti-join that degraded past the
    30s client timeout once coverage grew, deadlocking the worker in a
    timeout/retry loop (2026-07-22 outage). NULL-safe because
    sentence_lemma_links.lemma_id is NOT NULL.

    skip_ids/limit are server-side integers, safe to inline — and inlining
    keeps the query compatible with prisma's query_raw (no array params).
    """
    skip = sorted({int(i) for i in skip_ids})
    skip_clause = f"AND l.id NOT IN ({', '.join(map(str, skip))})" if skip else ""
    return f"""
        SELECT l.id AS lemma_id, l.lemma AS lemma, l.cefr_level AS cefr_level
        FROM lemmas l
        WHERE EXISTS (
            SELECT 1 FROM movie_lemma_mappings mlm WHERE mlm.lemma_id = l.id
        )
        AND l.id NOT IN (SELECT sll.lemma_id
            FROM sentence_lemma_links sll
            JOIN sentence_bank sb ON sb.id = sll.sentence_id
            WHERE sb.movie_id IS NULL AND sb.source = 'llm'
        )
        AND LOWER(l.lemma) NOT IN (SELECT LOWER(word) FROM hidden_words)
        {skip_clause}
        ORDER BY l.priority_score DESC, l.id
        LIMIT {int(limit)}
    """


async def fetch_backlog(db, skip_ids: Iterable[int], limit: int) -> List[dict]:
    return await db.query_raw(build_backlog_sql(skip_ids, limit))


@dataclass
class CycleResult:
    outcome: str  # "generated" | "idle" | "cap"
    fetched: int = 0
    stored: int = 0


async def run_cycle(
    db,
    llm,
    skip_ids: Set[int],
    *,
    page_size: int = PAGE_SIZE,
    batch_size: int = BATCH_SIZE,
    batch_sleep: float = BATCH_SLEEP,
) -> CycleResult:
    """
    One pass: fetch a page of uncovered lemmas and generate sentences for
    them in batch_size chunks. Lemmas the LLM couldn't produce a valid
    sentence for are added to skip_ids so the next cycle moves past them.
    Returns "cap" as soon as the cost cap interrupts a chunk (partial work
    is kept — generate_and_store persists per sentence).
    """
    rows = await fetch_backlog(db, skip_ids, page_size)
    if not rows:
        return CycleResult(outcome="idle")

    stored_total = 0
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
            return CycleResult(outcome="cap", fetched=len(rows), stored=stored_total)

        stored_lemmas = {w.lower() for w in results}
        stored_total += len(stored_lemmas)
        for r in chunk:
            if r["lemma"].lower() not in stored_lemmas:
                skip_ids.add(r["lemma_id"])

        if len(skip_ids) > MAX_SKIP_IDS:
            logger.info(
                "[sentence-worker] skip set exceeded %d entries; clearing "
                "to retry previously failed lemmas",
                MAX_SKIP_IDS,
            )
            skip_ids.clear()

        if batch_sleep > 0 and i + batch_size < len(rows):
            await asyncio.sleep(batch_sleep)

    return CycleResult(outcome="generated", fetched=len(rows), stored=stored_total)


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
    skip_ids: Set[int] = set()
    try:
        while not stop.is_set():
            # Once-daily vocab-coverage snapshot. Runs before the LLM check so
            # it still fires when the LLM is unavailable; short-circuits on a
            # single indexed lookup when a recent snapshot already exists.
            # Isolated so a snapshot failure never disturbs sentence generation.
            try:
                from src.services.vocab_coverage import maybe_write_daily_snapshot

                await maybe_write_daily_snapshot(db)
            except Exception as exc:
                logger.warning("[sentence-worker] coverage snapshot skipped: %s", exc)

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
                result = await run_cycle(db, llm, skip_ids)
            except Exception as exc:
                logger.exception("[sentence-worker] cycle failed: %s", exc)
                await alerter.record_failure(exc)
                await _sleep(ERROR_SLEEP)
                continue

            # Any completed cycle (generated/cap/idle) means the loop is
            # healthy — cap and idle are expected states, not failures.
            await alerter.record_success()

            if result.outcome == "generated":
                logger.info(
                    "[sentence-worker] cycle done fetched=%d stored=%d skip=%d",
                    result.fetched,
                    result.stored,
                    len(skip_ids),
                )
                # If nothing in the page stored we're spinning on hopeless
                # lemmas (all newly skipped) — back off instead of re-paging.
                if result.stored == 0:
                    await _sleep(ERROR_SLEEP)
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
