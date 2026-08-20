"""
Continuous translation-cache warming worker (issue #124).

Long-running process that fills `translation_cache` ahead of users, so a card
serves a cached row instead of firing a live DeepL request (10s timeout) on
the critical path of somebody's first Explore card.

## Why a worker and not the one-shot script

`warm_translation_cache.py` exists and does the same work, but the corpus is
larger than any single month's free allowance: the hot set is ~874k characters
per language against 500k/month from DeepL plus 500k/month from Google. Warming
ten languages is therefore a ~9-month job paced entirely by allowances that
reset on their own schedule. A script would mean a human remembering to run it
every month, nine times. A worker just wakes up and finds budget waiting.

## Scope: hot set only

Only `pool_lemmas` and `pool_sentences` — the words the Explore/Word-of-the-Hour
candidate pool can actually surface, and the one sentence each renders with.
The tail tiers are 79% of the corpus and consist of words the pool cannot reach,
so warming them would spend three years of allowance on cards nobody can see.

## Two budgets, two very different ceilings

DeepL's remaining characters come from its own /usage endpoint — authoritative,
and shared with live traffic, so a reserve is always held back. Google has no
equivalent cheap endpoint, so its spend is *derived from the cache itself*: the
sum of source-text lengths this month attributed to `provider='google'`. That
is an approximation (it misses failed calls and cache-bypassed context lookups)
and it is deliberately the conservative direction — it can under-count spend
only by the volume of work that never landed in the cache.

Runs as the fourth process in the background-worker container (see
docker/start-workers.sh); disable with TRANSLATION_WARM_WORKER_ENABLED=0.

    python -m src.workers.translation_warm_worker

Tunables (env):
    TRANSLATION_WARM_LANGS        priority-ordered target codes
    TRANSLATION_WARM_BATCH        texts per provider request     (default 50)
    TRANSLATION_WARM_SLEEP        seconds between requests       (default 1)
    TRANSLATION_WARM_IDLE_SLEEP   seconds when fully warm        (default 21600)
    TRANSLATION_WARM_CAP_SLEEP    seconds when out of budget     (default 21600)
    TRANSLATION_WARM_DEEPL_RESERVE  chars kept for live traffic  (default 50000)
    TRANSLATION_WARM_GOOGLE_RESERVE chars kept for live traffic  (default 50000)
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys
from dataclasses import dataclass
from typing import List, Optional

from src.services.translation_warming import (
    CharBudget,
    fetch_tier,
    select_uncached,
    take_within_budget,
)

logger = logging.getLogger("wordwise.translation_warm_worker")

# Priority order matters more than completeness: whichever language is first
# gets warmed to completion before the next one starts, because a language
# warmed halfway still fires a DeepL call on most pages, whereas one warmed
# fully is genuinely served from cache for the people who speak it.
DEFAULT_LANGS = "TR,ES,PT,RU,KO,AR,ID,HI,VI,TH,UK,AZ"

# Hot set only — see module docstring.
WARM_TIERS = ("pool_lemmas", "pool_sentences")

LANGS = [
    c.strip().upper()
    for c in os.environ.get("TRANSLATION_WARM_LANGS", DEFAULT_LANGS).split(",")
    if c.strip()
]
BATCH_SIZE = int(os.environ.get("TRANSLATION_WARM_BATCH", "50"))
BATCH_SLEEP = float(os.environ.get("TRANSLATION_WARM_SLEEP", "1"))
IDLE_SLEEP = float(os.environ.get("TRANSLATION_WARM_IDLE_SLEEP", "21600"))
CAP_SLEEP = float(os.environ.get("TRANSLATION_WARM_CAP_SLEEP", "21600"))
DEEPL_RESERVE = int(os.environ.get("TRANSLATION_WARM_DEEPL_RESERVE", "50000"))
GOOGLE_RESERVE = int(os.environ.get("TRANSLATION_WARM_GOOGLE_RESERVE", "50000"))
ERROR_SLEEP = 60.0

# Google Cloud Translation's recurring free allowance.
GOOGLE_FREE_CHARS_PER_MONTH = 500_000

# Characters warmed per cycle before re-reading the providers' remaining quota.
# Small enough that a concurrent spike in live traffic is noticed quickly,
# large enough that the check is not the dominant cost.
CYCLE_CHAR_BUDGET = 25_000

GOOGLE_SPEND_SQL = """
    SELECT COALESCE(SUM(LENGTH(source_text)), 0) AS chars
    FROM translation_cache
    WHERE provider = 'google'
      AND created_at >= date_trunc('month', now())
"""


@dataclass
class CycleResult:
    outcome: str  # "warmed" | "idle" | "cap"
    lang: Optional[str] = None
    warmed: int = 0
    chars: int = 0
    provider: Optional[str] = None


async def deepl_remaining(client, reserve: int) -> int:
    """Spendable DeepL characters, or 0 if usage cannot be read.

    Failing closed is deliberate: an unreadable quota means we do not know how
    much is left, and guessing high would spend live traffic's reserve.
    """
    try:
        usage = await client.get_usage()
    except Exception as exc:
        logger.warning("[warm] could not read DeepL usage: %s", exc)
        return 0
    return max(0, usage["character_limit"] - usage["character_count"] - reserve)


async def google_remaining(db, reserve: int, client=None) -> int:
    """Spendable Google characters this calendar month.

    Derived from the cache rather than an API, so it is an estimate — see the
    module docstring for why that is acceptable and which way it errs.

    An unconfigured Google has a budget of zero, not an error. Treating "the
    fallback is switched off" as a failure would put this worker in a 60-second
    retry loop emailing admins about a deployment choice, which is exactly the
    state a half-set pair of env vars leaves it in.
    """
    if client is not None and not getattr(client, "enabled", False):
        logger.info("[warm] Google fallback not enabled; treating its budget as 0")
        return 0
    try:
        rows = await db.query_raw(GOOGLE_SPEND_SQL)
        spent = int(rows[0]["chars"]) if rows else 0
    except Exception as exc:
        logger.warning("[warm] could not read Google spend: %s", exc)
        return 0
    return max(0, GOOGLE_FREE_CHARS_PER_MONTH - spent - reserve)


async def next_language_with_work(db, langs: List[str]) -> Optional[tuple]:
    """First (lang, tier, pending) in priority order that still has work.

    Walks tiers within a language before moving on, so a language is finished
    rather than every language being left partially warm.
    """
    for lang in langs:
        for tier in WARM_TIERS:
            texts = await fetch_tier(db, tier)
            pending = await select_uncached(db, texts, lang)
            if pending:
                return lang, tier, pending
    return None


async def run_cycle(
    db,
    service,
    deepl_client,
    langs: List[str],
    *,
    batch_size: int = BATCH_SIZE,
    batch_sleep: float = BATCH_SLEEP,
    cycle_chars: int = CYCLE_CHAR_BUDGET,
) -> CycleResult:
    """One pass: find work, find budget, warm until one of them runs out."""
    work = await next_language_with_work(db, langs)
    if work is None:
        return CycleResult(outcome="idle")

    lang, tier, pending = work

    # DeepL first — better output on every language it supports. Google picks
    # up the same language once DeepL's month is spent; the provider column
    # records which produced each row so the Google ones can be re-warmed with
    # DeepL later if quality proves inadequate.
    provider = None
    remaining = await deepl_remaining(deepl_client, DEEPL_RESERVE)
    if remaining <= 0:
        provider = "google"
        remaining = await google_remaining(
            db, GOOGLE_RESERVE, client=getattr(service, "google_client", None)
        )

    if remaining <= 0:
        return CycleResult(outcome="cap", lang=lang)

    budget = CharBudget(limit=min(remaining, cycle_chars))
    warmed = 0

    while pending and not budget.exhausted:
        batch, cost = take_within_budget(pending, budget, batch_size)
        if not batch:
            break
        try:
            await service.batch_translate(
                texts=batch,
                target_lang=lang,
                source_lang="en",
                force_provider=provider,
            )
        except Exception as exc:
            # Charge before re-raising: the provider has very likely billed
            # the characters even though we did not get to store them.
            budget.spend(cost)
            logger.error("[warm] %s/%s batch failed: %s", lang, tier, exc)
            raise
        budget.spend(cost)
        warmed += len(batch)
        pending = pending[len(batch):]
        if batch_sleep > 0 and pending and not budget.exhausted:
            await asyncio.sleep(batch_sleep)

    return CycleResult(
        outcome="warmed",
        lang=lang,
        warmed=warmed,
        chars=budget.spent,
        provider=provider or "deepl",
    )


async def run_forever() -> None:
    """Process entrypoint: connect, then loop cycles until SIGINT/SIGTERM."""
    from prisma import Prisma

    stop = asyncio.Event()

    def _handle_signal(*_):
        logger.info("[warm] shutdown signal received")
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _handle_signal)
        except NotImplementedError:
            signal.signal(sig, _handle_signal)

    async def _sleep(seconds: float) -> None:
        # Race the stop event against the sleep so SIGTERM stays responsive
        # during the long out-of-budget waits.
        try:
            await asyncio.wait_for(stop.wait(), timeout=seconds)
        except asyncio.TimeoutError:
            pass

    from src.services.admin_alerts import ConsecutiveFailureAlerter
    from src.services.translation_service import TranslationService
    from src.utils.deepl_client import DeepLClient

    db = Prisma()
    await db.connect()
    logger.info("[warm] starting (langs=%s tiers=%s)", ",".join(LANGS), ",".join(WARM_TIERS))

    alerter = ConsecutiveFailureAlerter("translation-warm-worker", fetch_rows=db.query_raw)

    deepl_client = DeepLClient()
    service = TranslationService(db, deepl_client=deepl_client)

    try:
        while not stop.is_set():
            try:
                result = await run_cycle(db, service, deepl_client, LANGS)
            except Exception as exc:
                logger.exception("[warm] cycle failed: %s", exc)
                await alerter.record_failure(exc)
                await _sleep(ERROR_SLEEP)
                continue

            await alerter.record_success()

            if result.outcome == "warmed":
                logger.info(
                    "[warm] %s via %s: %d rows, %s chars",
                    result.lang, result.provider, result.warmed, f"{result.chars:,}",
                )
                if result.warmed == 0:
                    # Budget was too small for even the next text — treat as
                    # capped rather than spinning on a batch that never fits.
                    await _sleep(CAP_SLEEP)
            elif result.outcome == "cap":
                logger.info(
                    "[warm] no budget left this period (next up: %s); sleeping %.0fs",
                    result.lang, CAP_SLEEP,
                )
                await _sleep(CAP_SLEEP)
            else:
                logger.info("[warm] all languages warm; sleeping %.0fs", IDLE_SLEEP)
                await _sleep(IDLE_SLEEP)
    finally:
        await db.disconnect()
        logger.info("[warm] stopped")


def main() -> None:
    from ..logging_config import configure_logging

    configure_logging(
        level=os.environ.get("WORKER_LOG_LEVEL", "INFO"),
        service="translation-warm-worker",
    )
    try:
        asyncio.run(run_forever())
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
