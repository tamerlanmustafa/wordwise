"""
Priority-ordered warming of the global translation cache (issue #124).

The read path is already right: `TranslationService.batch_translate` does one
cache read for a whole page, one DeepL request per 50 misses, one bulk write.
What is wrong is coverage — the cache holds ~4k rows against a reachable
corpus of ~23k lemmas and ~48.5k sentences, so most Explore pages are mostly
misses and a live DeepL round trip sits on the critical path of the user's
first card. This module supplies the offline job that fills the cache ahead of
them. It does not change how translation works at request time.

## Characters are the currency, not dollars

The sentence pre-generation worker meters itself in dollars because Anthropic
bills per token and the cap is a spend ceiling we choose. DeepL is different:
it bills characters, and on the Free plan the allowance is a hard monthly wall
(500,000 characters) that the *live request path shares*. Overspending here
does not produce a larger invoice, it produces 456 errors for real users for
the rest of the month. So the budget is in characters, it is checked against
DeepL's own `/usage` figure rather than a local ledger, and it holds a reserve
back for live traffic.

## Priority: warm what user number one actually hits

Warming is bounded but not cheap, so order matters more than completeness.
The tiers below walk the corpus in the order a real user meets it:

  1. `pool_lemmas`    — the words the Explore/Word-of-the-Hour candidate pool
                        can actually surface: the top `pool_limit` lemmas per
                        CEFR level by frequency rank. ~8 characters each, so
                        this tier buys the most coverage per character by a
                        wide margin.
  2. `pool_sentences` — the one example sentence each of those lemmas renders
                        with. ~66 characters each, and it must be *the same*
                        sentence the feed picks, hence the duplicated
                        ORDER BY (see `_BEST_SENTENCE_ORDER`).
  3. `tail_lemmas`    — every other reachable lemma, rarest last.
  4. `tail_sentences` — their sentences.

A run that only gets through tiers 1 and 2 has already taken DeepL off the
critical path for the overwhelming majority of first sessions.

## Resumability

There is no progress table. The cache *is* the progress marker: every tier is
filtered against what is already cached before anything is spent, so an
interrupted run resumes simply by being run again, and a completed run is a
no-op. That only holds because `select_uncached` keys on exactly the same
normalized text the write path uses — see `normalize_cache_text`.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from .translation_service import normalize_cache_text

logger = logging.getLogger(__name__)

# The CEFR levels a card can be drawn at. UNKNOWN is deliberately absent: it is
# a "could not classify" marker (#91), and those lemmas are never displayed, so
# translating them would spend characters on words no user can reach.
CEFR_LEVELS = ("A1", "A2", "B1", "B2", "C1", "C2")

# How many lemmas per CEFR level the feed's candidate pool can reach. Mirrors
# the `limit` default of `_eligible_lemma_candidates` in routes/srs.py — if
# that ever changes, this should follow it, or tier 1 stops describing the pool.
DEFAULT_POOL_LIMIT = 2000

# Rows per cache-existence query. Keeps the `IN` list to a sane size; this runs
# offline, so more round trips are cheaper than one enormous statement.
CACHE_PROBE_CHUNK = 500

# A lemma is reachable if a study card can be built from it. Kept identical to
# `_eligible_lemma_candidates`: at a real CEFR level, alphabetic, >= 4 chars,
# not curated away, and carrying at least one global LLM sentence to render.
# `sll.is_global` rather than a join to sentence_bank for the reason in #120 —
# the predicate is denormalized onto the link and trigger-maintained, so this
# is an index-only probe instead of walking 48.5k sentences.
_REACHABLE_LEMMA = """
    l.lemma ~ '^[a-zA-Z]+$'
    AND length(l.lemma) >= 4
    AND NOT EXISTS (SELECT 1 FROM hidden_words hw WHERE hw.word = l.lemma)
    AND EXISTS (
        SELECT 1 FROM sentence_lemma_links sll
        WHERE sll.lemma_id = l.id AND sll.is_global
    )
"""

# Which sentence a lemma renders with. Must stay byte-for-byte the ordering in
# the /feed and /today handlers: warming a *different* sentence than the one
# shown would spend the characters and still leave the card cold. The tie break
# is spelled on the link side (`sll.sentence_id`) so it matches
# ix_sll_global_lemma's key order.
_BEST_SENTENCE_ORDER = """
    ORDER BY
        sll.lemma_id,
        sll.is_representative DESC,
        sll.score DESC NULLS LAST,
        sll.sentence_id ASC
"""


def _pool_cte(pool_limit: int) -> str:
    """The feed's candidate pool: top `pool_limit` lemmas per CEFR level.

    One LATERAL per level rather than a single window function, because that
    is what the running query does — it fires `_eligible_lemma_candidates`
    once per level set. Comparing `l.cefr_level` bare (never `::text`) for the
    reason documented in routes/srs.py: the cast hides the column from the
    planner's statistics and disables the index (#118).
    """
    levels = ", ".join(f"'{lvl}'" for lvl in CEFR_LEVELS)
    return f"""
        pool AS (
            SELECT p.id, p.lemma, p.frequency_rank
            FROM unnest(ARRAY[{levels}]::proficiencylevel[]) AS lvl
            CROSS JOIN LATERAL (
                SELECT l.id, l.lemma, l.frequency_rank
                FROM lemmas l
                WHERE l.cefr_level = lvl
                  AND {_REACHABLE_LEMMA}
                ORDER BY l.frequency_rank ASC NULLS LAST
                LIMIT {int(pool_limit)}
            ) p
        )
    """


def build_tier_sql(tier: str, pool_limit: int = DEFAULT_POOL_LIMIT) -> str:
    """SQL for one warming tier, returning `text` ordered most-reachable first.

    Every tier yields the same one-column shape so the caller can treat them
    uniformly and simply stop when the budget runs out.
    """
    pool = _pool_cte(pool_limit)

    if tier == "pool_lemmas":
        # Group by lemma, not id: two ids can share a spelling and the cache is
        # keyed on the text, so translating both would pay twice for one row.
        return f"""
            WITH {pool}
            SELECT lemma AS text, MIN(frequency_rank) AS rank
            FROM pool
            GROUP BY lemma
            ORDER BY rank ASC NULLS LAST, lemma
        """

    if tier == "pool_sentences":
        return f"""
            WITH {pool},
            best AS (
                SELECT DISTINCT ON (sll.lemma_id)
                    sll.lemma_id AS lemma_id,
                    sb.sentence  AS sentence
                FROM sentence_lemma_links sll
                JOIN sentence_bank sb ON sb.id = sll.sentence_id
                WHERE sll.is_global
                  AND sll.lemma_id IN (SELECT id FROM pool)
                {_BEST_SENTENCE_ORDER}
            )
            SELECT b.sentence AS text, MIN(p.frequency_rank) AS rank
            FROM best b
            JOIN pool p ON p.id = b.lemma_id
            GROUP BY b.sentence
            ORDER BY rank ASC NULLS LAST, text
        """

    if tier == "tail_lemmas":
        return f"""
            WITH {pool}
            SELECT l.lemma AS text, MIN(l.frequency_rank) AS rank
            FROM lemmas l
            WHERE l.cefr_level IN ({", ".join(f"'{lvl}'" for lvl in CEFR_LEVELS)})
              AND {_REACHABLE_LEMMA}
              AND l.id NOT IN (SELECT id FROM pool)
            GROUP BY l.lemma
            ORDER BY rank ASC NULLS LAST, l.lemma
        """

    if tier == "tail_sentences":
        # Every remaining global LLM sentence. No pool exclusion — a sentence
        # already warmed in tier 2 is filtered by the cache probe, not here.
        return """
            SELECT sb.sentence AS text, NULL::int AS rank
            FROM sentence_bank sb
            WHERE sb.movie_id IS NULL
              AND sb.source = 'llm'
              AND sb.sentence IS NOT NULL
              AND sb.sentence <> ''
            GROUP BY sb.sentence
            ORDER BY sb.sentence
        """

    raise ValueError(f"unknown warming tier: {tier}")


TIERS: Tuple[str, ...] = (
    "pool_lemmas",
    "pool_sentences",
    "tail_lemmas",
    "tail_sentences",
)


@dataclass
class CharBudget:
    """Characters this run may spend, across all target languages.

    Deliberately not a dollar ledger. On the DeepL Free plan the number that
    matters is the monthly character allowance, which live traffic draws from
    too — so the budget is a slice of a shared, non-renewable pool rather than
    a spend ceiling. `spend()` refuses a charge it cannot cover in full rather
    than partially applying it, so a batch is either paid for or not attempted.
    """

    limit: int
    spent: int = 0

    @property
    def remaining(self) -> int:
        return max(0, self.limit - self.spent)

    @property
    def exhausted(self) -> bool:
        return self.remaining <= 0

    def can_afford(self, chars: int) -> bool:
        return chars <= self.remaining

    def spend(self, chars: int) -> None:
        if not self.can_afford(chars):
            raise ValueError(
                f"budget overrun: {chars} chars requested, {self.remaining} left"
            )
        self.spent += chars


@dataclass
class WarmStats:
    """What a run actually did, for the closing log line and the tests."""

    considered: int = 0
    already_cached: int = 0
    translated: int = 0
    chars_spent: int = 0
    per_tier: Dict[str, int] = field(default_factory=dict)
    stopped_on_budget: bool = False

    def record(self, tier: str, translated: int, chars: int) -> None:
        self.translated += translated
        self.chars_spent += chars
        self.per_tier[tier] = self.per_tier.get(tier, 0) + translated


def take_within_budget(
    texts: Sequence[str],
    budget: CharBudget,
    max_batch: int,
) -> Tuple[List[str], int]:
    """The next batch to translate, and what it costs.

    Takes texts in priority order until either `max_batch` is reached or the
    next one would not fit, and returns the cost so the caller can charge the
    budget only once the work has actually succeeded. Stops at the first text
    that does not fit rather than skipping it to fit a later, shorter one:
    the ordering is a priority, and hopping over an expensive item to reach a
    rarer cheap one would warm the wrong things at the end of a run.

    Returns ([], 0) when nothing fits.
    """
    batch: List[str] = []
    cost = 0
    for text in texts:
        if len(batch) >= max_batch:
            break
        size = len(text)
        if cost + size > budget.remaining:
            break
        batch.append(text)
        cost += size
    return batch, cost


async def select_uncached(
    db,
    texts: Sequence[str],
    target_lang: str,
    *,
    chunk: int = CACHE_PROBE_CHUNK,
) -> List[str]:
    """Which of `texts` have no cache row yet, in the order given.

    The request path discovers misses inside `batch_translate`, after which
    the characters are already committed. A warmer has to know *before* it
    spends, so it probes first. That means the cache is read twice per batch
    (once here, once inside `batch_translate`) — two cheap indexed queries in
    an offline job, in exchange for a budget that is accurate rather than
    retrospective.

    Keys on `normalize_cache_text`, the same function the write path uses. If
    these two ever diverge, every probe reports a miss and the job re-buys the
    whole corpus under keys nothing reads.
    """
    normalized: List[str] = []
    seen = set()
    for text in texts:
        key = normalize_cache_text(text or "")
        if key and key not in seen:
            seen.add(key)
            normalized.append(key)

    if not normalized:
        return []

    cached = set()
    lang = target_lang.upper()
    for start in range(0, len(normalized), chunk):
        window = normalized[start : start + chunk]
        rows = await db.translationcache.find_many(
            where={"targetLang": lang, "sourceText": {"in": window}}
        )
        cached.update(r.sourceText for r in rows)

    return [t for t in normalized if t not in cached]


async def fetch_tier(
    db,
    tier: str,
    *,
    pool_limit: int = DEFAULT_POOL_LIMIT,
    limit: Optional[int] = None,
) -> List[str]:
    """Source texts for one tier, most-reachable first."""
    sql = build_tier_sql(tier, pool_limit)
    if limit:
        sql = f"{sql} LIMIT {int(limit)}"
    rows = await db.query_raw(sql)
    return [r["text"] for r in rows if r.get("text")]


def summarize_plan(tier_texts: Dict[str, List[str]]) -> List[Tuple[str, int, int]]:
    """(tier, rows, characters) — what a dry run reports per tier."""
    return [
        (tier, len(texts), sum(len(t) for t in texts))
        for tier, texts in tier_texts.items()
    ]


def affordable_languages(
    per_language_chars: int,
    remaining: int,
    langs: Iterable[str],
) -> List[str]:
    """How many of `langs` fit in `remaining` at `per_language_chars` each.

    Used only to make the dry-run report say something honest about scope —
    warming half of every language leaves every language cold on the cards it
    did not reach, whereas warming one language fully takes DeepL off the path
    for the users who speak it.
    """
    if per_language_chars <= 0:
        return list(langs)
    affordable = remaining // per_language_chars
    return list(langs)[: max(0, affordable)]
