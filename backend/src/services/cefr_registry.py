"""
Reconcile a script's fresh CEFR classifications against the `lemmas` registry
(issue #119).

`word_classifications` stores a level per (script, word); `lemmas` stores one
per word. Classification is script-sensitive in a way the word itself is not:
the proper-noun branch in cefr_classifier.py fires on capitalisation, so
"Journey" opening a line of dialogue is stored UNKNOWN for that script while
the registry — and every other script — has it at A1. `should_keep_word` drops
UNKNOWN, so those rows disappear from the movie vocabulary screens even though
we already know the level. Prod on 2026-08-18: 526,251 rows over 8,521 words,
69% of every UNKNOWN row in the table.

This is the write-side half of the fix; prisma/manual/
2026_08_18_backfill_unknown_cefr_from_lemmas_issue_119.sql applies the same
rule to rows already stored. Both exist because the level is duplicated ~135x
with nothing tying the copies together — #127 normalises that away and retires
this helper.

The registry is trusted only where it is a real classification. A `lemmas` row
with source='fallback' and no confidence is the classifier's own "I gave up"
output written through populate_lemma_registry's A2 default, which is the #91
bucket wearing a different label — promoting UNKNOWN to that is a downgrade,
not a recovery. The deliberate whitelists share source='fallback' but carry
real confidence (kids 0.95, informal slang 0.85), so the split is on
confidence, exactly as the #91 backfill did it.
"""
from __future__ import annotations

import logging
from dataclasses import replace
from typing import List, Optional, Protocol

from src.services.cefr_classifier import (
    CEFRLevel,
    ClassificationSource,
    WordClassification,
)

logger = logging.getLogger(__name__)

# `lemma` is unique, so the ANY(...) drives an index scan; the level and source
# predicates only filter what it returns. Both compare a literal against the
# enum column rather than casting the column to text — a `cefr_level::text`
# predicate is what mis-planned the vocabulary queries in #118. The output
# casts are free: they shape the returned row, not the plan.
_REGISTRY_LOOKUP_SQL = (
    "SELECT lemma, cefr_level::text AS cefr_level, confidence, "
    "source::text AS source, frequency_rank "
    "FROM lemmas "
    "WHERE lemma = ANY($1::text[]) "
    "AND cefr_level <> 'UNKNOWN' "
    "AND NOT (source = 'fallback' AND confidence < 0.5)"
)


class _SupportsQueryRaw(Protocol):
    async def query_raw(self, sql: str, *args): ...


def _as_level(value: str) -> Optional[CEFRLevel]:
    try:
        return CEFRLevel(value)
    except ValueError:
        return None


def _as_source(value: str, default: ClassificationSource) -> ClassificationSource:
    try:
        return ClassificationSource(value)
    except ValueError:
        return default


async def apply_registry_levels(
    db: _SupportsQueryRaw, classifications: List[WordClassification]
) -> int:
    """
    Replace UNKNOWN classifications in place with the level `lemmas` already
    holds for that word. Returns how many were recovered.

    One query for the whole script, not one per word: the UNKNOWN lemmas go as
    a single text[] parameter so a large script (~4,700 distinct forms) can
    never approach the bind-parameter limit, and the event loop waits on one
    round trip.

    Entries are REPLACED, never mutated. classify_word hands back the objects
    it keeps in _GLOBAL_CEFR_CACHE, so editing one in place would relabel that
    word for every other movie in the process — the same trap the C2-spike
    fix in classify_text documents.

    Call it before statistics, difficulty scoring and the DB insert, so the
    stored rows, the movie's difficulty and the lemma registry all see one set
    of levels.
    """
    unknown_lemmas = sorted({
        cls.lemma
        for cls in classifications
        if cls.cefr_level == CEFRLevel.UNKNOWN and cls.lemma
    })
    if not unknown_lemmas:
        return 0

    rows = await db.query_raw(_REGISTRY_LOOKUP_SQL, unknown_lemmas)
    known = {row["lemma"]: row for row in rows}
    if not known:
        return 0

    recovered = 0
    for i, cls in enumerate(classifications):
        if cls.cefr_level != CEFRLevel.UNKNOWN:
            continue
        row = known.get(cls.lemma)
        if row is None:
            continue
        level = _as_level(row["cefr_level"])
        if level is None:
            continue

        classifications[i] = replace(
            cls,
            cefr_level=level,
            confidence=row["confidence"],
            source=_as_source(row["source"], cls.source),
            # The registry's rank is a fallback, not an override: the
            # classifier's is measured against this script's text.
            frequency_rank=(
                cls.frequency_rank
                if cls.frequency_rank is not None
                else row["frequency_rank"]
            ),
        )
        recovered += 1

    if recovered:
        logger.info(
            f"CEFR registry: recovered {recovered} words the classifier left "
            f"UNKNOWN ({len(known)} of {len(unknown_lemmas)} lemmas known)"
        )
    return recovered
