"""
Pre-warm the global translation cache so DeepL is off the critical path of the
user's first card (issue #124).

The cache is global — a row translated once serves every user of that language
forever — so this is a one-time cost paid at a moment nobody is waiting,
rather than a latency tax charged to whoever happens to walk into a word
first. Today the cache holds ~4k rows against a reachable corpus of ~23k
lemmas and ~48.5k sentences, so most Explore pages are mostly misses and each
one fires a live DeepL request (10s timeout) while the card spins.

Nothing about how translation works at request time changes here. The batching
in `TranslationService.batch_translate` is already correct and this script
calls straight into it — the only thing being fixed is coverage.

## Read the budget section before running this

DeepL bills characters, and this project is on the **Free** plan: 500,000
characters per month, hard wall, *shared with live traffic*. Spending them all
here does not produce a bigger invoice, it produces 456 errors for real users
until the month rolls over. So:

  - the run is metered in characters, not dollars;
  - the ceiling comes from DeepL's own /usage endpoint, not a local ledger;
  - `--reserve-chars` is held back for live traffic and never spent here.

Warming one language's full candidate pool costs ~874k characters (~93k of
lemmas + ~781k of sentences). That is more than a whole month's free
allowance, so a full warm is not reachable on the current plan — narrow the
pool with `--pool-limit` and cover it completely for one language, or move to
DeepL Pro first. `--dry-run` prints the arithmetic for whatever scope you ask
for and spends nothing.

Idempotent and resumable: every tier is filtered against what is already
cached before anything is spent, so an interrupted run resumes by being run
again and a finished one is a no-op.

Run from the backend/ directory with the interpreter that has Prisma
installed (typically python3.11 on this machine — `python3` is Apple's 3.9):

    cd backend
    python3.11 warm_translation_cache.py --langs TR --dry-run
    python3.11 warm_translation_cache.py --langs TR --pool-limit 300 --budget-chars 50000
    python3.11 warm_translation_cache.py --langs TR,ES --tiers pool_lemmas
"""
import argparse
import asyncio
import logging
import os
import time
from typing import List

from prisma import Prisma

from src.services.translation_service import TranslationService
from src.services.translation_warming import (
    DEFAULT_POOL_LIMIT,
    TIERS,
    CharBudget,
    WarmStats,
    fetch_tier,
    select_uncached,
    summarize_plan,
    take_within_budget,
)
from src.utils.deepl_client import MAX_TEXTS_PER_REQUEST, DeepLClient, DeepLError

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("warm_translation_cache")

# Prisma talks to its query engine over HTTP, so httpx logs two INFO lines per
# statement. Across a long warm that buries the progress lines anyone watching
# the run actually needs.
logging.getLogger("httpx").setLevel(logging.WARNING)

# Never spend the last of the month's allowance: live traffic draws from the
# same pool, and a user hitting a cold word after this script drained it gets
# a 456 rather than a slow card.
DEFAULT_RESERVE_CHARS = 50_000

# Progress cadence. One line per batch is ~470 lines for a single tier; one
# line per 10 keeps a long run readable while still moving often enough to
# show it is alive.
LOG_EVERY_BATCHES = 10


async def warm_language(
    db: Prisma,
    service: TranslationService,
    lang: str,
    tiers: List[str],
    budget: CharBudget,
    stats: WarmStats,
    *,
    pool_limit: int,
    batch_size: int,
    sleep: float,
    dry_run: bool,
) -> None:
    """Walk the tiers for one language until they run out or the budget does."""
    for tier in tiers:
        if budget.exhausted:
            stats.stopped_on_budget = True
            return

        texts = await fetch_tier(db, tier, pool_limit=pool_limit)
        stats.considered += len(texts)

        pending = await select_uncached(db, texts, lang)
        stats.already_cached += len(texts) - len(pending)
        if not pending:
            logger.info("[%s/%s] already fully cached (%d rows)", lang, tier, len(texts))
            continue

        pending_chars = sum(len(t) for t in pending)
        logger.info(
            "[%s/%s] %d uncached of %d (%s chars); budget %s left",
            lang, tier, len(pending), len(texts),
            f"{pending_chars:,}", f"{budget.remaining:,}",
        )

        if dry_run:
            continue

        batches = 0
        tier_done = 0
        tier_chars = 0
        while pending:
            batch, cost = take_within_budget(pending, budget, batch_size)
            if not batch:
                # Nothing left that fits — the next item is larger than the
                # remaining budget, so this run is over.
                stats.stopped_on_budget = True
                logger.warning(
                    "[%s/%s] budget exhausted with %d rows unwarmed",
                    lang, tier, len(pending),
                )
                stats.record(tier, tier_done, tier_chars)
                return

            try:
                await service.batch_translate(
                    texts=batch,
                    target_lang=lang,
                    source_lang="en",
                )
            except Exception as exc:
                # A failed batch has still very likely been billed by DeepL, so
                # charge the budget before stopping. Better to under-warm than
                # to keep hammering a quota wall.
                budget.spend(cost)
                stats.record(tier, tier_done, tier_chars + cost)
                logger.error("[%s/%s] batch failed, stopping: %s", lang, tier, exc)
                raise

            budget.spend(cost)
            tier_done += len(batch)
            tier_chars += cost
            pending = pending[len(batch):]
            batches += 1

            if batches % LOG_EVERY_BATCHES == 0:
                logger.info(
                    "[%s/%s] %d/%d warmed, %s chars spent, %s left",
                    lang, tier, tier_done, tier_done + len(pending),
                    f"{tier_chars:,}", f"{budget.remaining:,}",
                )

            if sleep > 0 and pending:
                await asyncio.sleep(sleep)

        stats.record(tier, tier_done, tier_chars)
        logger.info(
            "[%s/%s] done: %d warmed, %s chars", lang, tier, tier_done, f"{tier_chars:,}"
        )


async def main() -> None:
    parser = argparse.ArgumentParser(
        description="Pre-warm the global translation cache (#124)."
    )
    parser.add_argument(
        "--langs", required=True,
        help="Comma-separated DeepL target codes, e.g. TR,ES. Never EN — the "
             "corpus is already English, so en→en is spend for nothing.",
    )
    parser.add_argument(
        "--tiers", default=",".join(TIERS),
        help=f"Comma-separated, in priority order. Default: {','.join(TIERS)}",
    )
    parser.add_argument(
        "--pool-limit", type=int, default=DEFAULT_POOL_LIMIT,
        help="Lemmas per CEFR level in the candidate pool. Lower it to cover a "
             "narrower pool completely rather than a wide one partially.",
    )
    parser.add_argument(
        "--budget-chars", type=int, default=None,
        help="Cap for this run. Also capped by DeepL's real remaining quota.",
    )
    parser.add_argument(
        "--reserve-chars", type=int, default=DEFAULT_RESERVE_CHARS,
        help="Monthly allowance held back for live traffic.",
    )
    parser.add_argument("--batch-size", type=int, default=MAX_TEXTS_PER_REQUEST)
    parser.add_argument("--sleep", type=float, default=0.5,
                        help="Seconds between DeepL requests.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Report the arithmetic, spend nothing.")
    args = parser.parse_args()

    langs = [c.strip().upper() for c in args.langs.split(",") if c.strip()]
    if not langs:
        raise SystemExit("--langs is empty")
    if "EN" in langs:
        raise SystemExit(
            "EN is the source language — translating en→en would spend "
            "characters producing the text we already have."
        )

    tiers = [t.strip() for t in args.tiers.split(",") if t.strip()]
    unknown = [t for t in tiers if t not in TIERS]
    if unknown:
        raise SystemExit(f"unknown tier(s): {', '.join(unknown)}; valid: {', '.join(TIERS)}")

    # Refuse to run keyless. Without DEEPL_API_KEY the client returns
    # "[MOCK TR] word" instead of a translation, and that is NOT caught by the
    # passthrough guard in _save_to_cache (it only rejects output identical to
    # its input), so every mock string would be written into the global cache
    # and served to real users forever. Same shape of guard as the spaCy check
    # in backfill_script_idioms.py, and for the same reason.
    if not os.getenv("DEEPL_API_KEY"):
        raise SystemExit(
            "DEEPL_API_KEY is not set. Warming now would write mock strings "
            "('[MOCK TR] word') into the global cache permanently."
        )

    client = DeepLClient()
    try:
        usage = await client.get_usage()
    except DeepLError as exc:
        raise SystemExit(f"could not read DeepL usage: {exc}")

    used = usage["character_count"]
    allowed = usage["character_limit"]
    spendable = max(0, allowed - used - args.reserve_chars)
    limit = min(spendable, args.budget_chars) if args.budget_chars else spendable

    logger.info(
        "DeepL quota: %s of %s used this period; %s spendable after a %s reserve",
        f"{used:,}", f"{allowed:,}", f"{spendable:,}", f"{args.reserve_chars:,}",
    )
    logger.info("This run may spend up to %s characters", f"{limit:,}")

    if limit <= 0 and not args.dry_run:
        raise SystemExit(
            "No spendable characters left this period. Raise the DeepL plan, "
            "lower --reserve-chars, or wait for the allowance to reset."
        )

    budget = CharBudget(limit=limit)
    stats = WarmStats()
    started = time.time()

    db = Prisma()
    await db.connect()
    try:
        service = TranslationService(db, deepl_client=client)

        if args.dry_run:
            # Price the corpus once — it is language-independent, since every
            # language translates the same English source text.
            plan = {t: await fetch_tier(db, t, pool_limit=args.pool_limit) for t in tiers}
            total = 0
            for tier, rows, chars in summarize_plan(plan):
                logger.info("  %-16s %6d rows  %10s chars", tier, rows, f"{chars:,}")
                total += chars
            logger.info("  %-16s %6s  %10s chars per language", "TOTAL", "", f"{total:,}")
            logger.info(
                "  %d language(s) requested → %s chars; %s spendable",
                len(langs), f"{total * len(langs):,}", f"{spendable:,}",
            )

        # Language-major: finish one language's tiers before starting the next.
        # A card renders a word AND its sentence in one batch, so a language
        # warmed halfway across every tier still pays a DeepL round trip on
        # every page — whereas one language warmed deeply is genuinely served
        # from cache for the users who speak it.
        for lang in langs:
            await warm_language(
                db, service, lang, tiers, budget, stats,
                pool_limit=args.pool_limit,
                batch_size=args.batch_size,
                sleep=args.sleep,
                dry_run=args.dry_run,
            )
    finally:
        await db.disconnect()

    elapsed = time.time() - started
    logger.info(
        "%s: %d translated, %d already cached, %s chars spent in %.0fs%s",
        "DRY RUN" if args.dry_run else "Done",
        stats.translated, stats.already_cached, f"{stats.chars_spent:,}", elapsed,
        " (stopped on budget)" if stats.stopped_on_budget else "",
    )
    for tier, count in stats.per_tier.items():
        logger.info("  %-16s %d", tier, count)


if __name__ == "__main__":
    asyncio.run(main())
