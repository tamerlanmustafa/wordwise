"""
Wrong answers for the translation MCQ, drawn from outside the deck.

WHY THIS EXISTS

`build_translation_choices` originally built a card's three wrong answers from
the *other nine cards in the same deck*. That is free — those translations are
already paid for — but it makes a ten-card session read like a shell game:

  * the same ~10 words are the options on every question, so by card five the
    user is answering by elimination rather than by knowing the word;
  * a word that was a distractor on card 1 is the correct answer on card 7,
    which teaches the deck rather than the vocabulary;
  * nothing matches part of speech, so a verb's options are three nouns and the
    grammar of the tile gives the answer away.

This module supplies a wider pool so none of that is necessary. Two indexed
reads per session and **no translation API calls at all**: candidates come from
the `lemmas` registry, and their translations come from whatever
`translation_cache` already holds for the user's language. Anything not already
cached is simply not a candidate. That is the whole cost model — a cold
language yields a thin pool and `build_translation_choices` falls back to the
old deck-only behaviour, which is exactly what it does today.

WHAT MAKES A GOOD DISTRACTOR

Same part of speech and same CEFR level as the correct answer. Both come from
the card's own lemma, so a B2 verb is surrounded by B2 verbs. Buckets are keyed
`(pos, level)` and looked up through a fallback ladder (§`pool_for`) so a thin
bucket borrows from a wider one instead of starving the card.
"""
from __future__ import annotations

import logging
from typing import Iterable, Optional, Protocol

from .feed_pool import real_word_sql
from .translation_service import normalize_cache_text

logger = logging.getLogger(__name__)

# How many candidate lemmas to pull per (level, pos) bucket. A ten-card deck
# needs 30 distractors in the worst case and they must not repeat across the
# session, so the pool has to be an order of magnitude bigger than the deck to
# be worth the query. Most candidates are dropped for want of a cached
# translation, which is the real reason this is generous rather than tight.
CANDIDATES_PER_BUCKET = 120

# Total row budget across all buckets, so a deck spanning many parts of speech
# can't turn into an unbounded scan. Ten cards span at most a handful of
# (pos, level) pairs in practice.
MAX_CANDIDATES = 600

# Bucket key: (pos, level). `pos` is the raw UPOS tag from `lemmas.pos`
# (NOUN / VERB / ADJ / …), NOT the learner-facing label from pos_labels —
# matching is a grammar test, not something the user reads, and collapsing
# PROPN onto NOUN the way the friendly labels do would let a place name sit
# under a common noun's question.
BucketKey = tuple[Optional[str], Optional[str]]


class _SupportsQueryRaw(Protocol):
    async def query_raw(self, sql: str, *args): ...


class _SupportsCacheRead(Protocol):
    @property
    def translationcache(self): ...


async def build_pool(
    db,
    *,
    target_lang: str,
    buckets: Iterable[BucketKey],
    exclude_lemmas: Iterable[str],
) -> dict[BucketKey, list[str]]:
    """Cached translations for words that look like the deck's words.

    `buckets` are the (pos, cefr_level) pairs the deck actually spans — pass
    the cards' own values so we never fetch a bucket nothing will ask for.
    `exclude_lemmas` is the deck itself: a card's answer must never be another
    card's wrong answer.

    Returns `{(pos, level): [translation, ...]}`. Buckets that came back empty
    are omitted rather than mapped to `[]`, so `pool_for`'s ladder can tell
    "nothing cached here" from "never asked".

    Never raises: a failure here costs choice variety, not the session, so it
    is logged and returns `{}` (the caller then behaves exactly as it did
    before this module existed).
    """
    wanted = [
        (pos, level)
        for pos, level in dict.fromkeys(buckets)
        if pos and level
    ]
    if not wanted or not target_lang or target_lang.upper() == "EN":
        return {}

    try:
        rows = await _candidate_lemmas(db, wanted, exclude_lemmas)
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("[distractor_pool] candidate query failed: %s", e)
        return {}
    if not rows:
        return {}

    # One cache read for every candidate at once. Keys go through the same
    # normalizer the write path uses — a pool keyed even slightly differently
    # would miss every row and silently warm nothing.
    by_key: dict[str, str] = {}
    for row in rows:
        by_key.setdefault(normalize_cache_text(str(row["lemma"])), str(row["lemma"]))

    try:
        cached = await db.translationcache.find_many(
            where={
                "targetLang": target_lang.upper(),
                "sourceText": {"in": sorted(by_key)},
            }
        )
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("[distractor_pool] cache read failed: %s", e)
        return {}

    translation_by_lemma = {
        by_key[r.sourceText]: r.translated
        for r in cached
        if r.sourceText in by_key and r.translated
    }
    if not translation_by_lemma:
        return {}

    pool: dict[BucketKey, list[str]] = {}
    for row in rows:
        lemma = str(row["lemma"])
        translated = translation_by_lemma.get(lemma)
        if not translated:
            continue
        key = (_norm_pos(row["pos"]), _norm_level(row["cefr_level"]))
        pool.setdefault(key, []).append(translated)
    return pool


async def _candidate_lemmas(
    db: _SupportsQueryRaw,
    buckets: list[BucketKey],
    exclude_lemmas: Iterable[str],
) -> list[dict]:
    """Registry lemmas for each (pos, level) bucket, most frequent first.

    The per-bucket cap is applied with `row_number() OVER (PARTITION BY ...)`,
    the same shape `_eligible_lemma_candidates` uses and for the same reason:
    frequency rank correlates hard with CEFR level, so one global
    `ORDER BY frequency_rank LIMIT n` hands every slot to the easiest bucket
    and returns nothing at all for the hard one (#116).

    `cefr_level` and `pos` are compared BARE, never `::text`. Casting a column
    turns it into an expression the planner has no statistics for and strips
    the index of its Index Cond (#118).
    """
    levels = sorted({level for _pos, level in buckets if level})
    tags = sorted({pos for pos, _level in buckets if pos})
    if not levels or not tags:
        return []

    # Both lists are derived from enum/registry values the deck already carries,
    # never from raw request input, so inlining the levels is safe — and the
    # bare-column comparison above depends on it. `pos` is parameterised
    # because it is a plain varchar with no enum to vouch for its shape.
    levels_sql = ",".join(f"'{lvl}'" for lvl in levels)
    per_bucket = max(1, min(CANDIDATES_PER_BUCKET, MAX_CANDIDATES // len(buckets)))

    excluded = sorted({w.lower() for w in exclude_lemmas if w})
    return await db.query_raw(
        f"""
        SELECT lemma, pos, cefr_level
        FROM (
            SELECT
                l.lemma            AS lemma,
                l.pos              AS pos,
                l.cefr_level::text AS cefr_level,
                row_number() OVER (
                    PARTITION BY l.cefr_level, l.pos
                    ORDER BY l.frequency_rank ASC NULLS LAST, l.id
                ) AS rn
            FROM lemmas l
            WHERE l.cefr_level IN ({levels_sql})
              AND l.pos = ANY($1::text[])
              AND NOT (LOWER(l.lemma) = ANY($2::text[]))
              AND {real_word_sql("l")}
        ) ranked
        WHERE rn <= {per_bucket}
        """,
        tags, excluded,
    )


def pool_for(
    pool: dict[BucketKey, list[str]],
    pos: Optional[str],
    level: Optional[str],
) -> list[str]:
    """Candidates for one card, widening until something is available.

    The ladder is deliberate. An exact (pos, level) match is the best
    distractor; a same-part-of-speech word from a neighbouring level is still a
    fair one; a same-level word of any type is weaker but keeps the card
    answerable; everything is the last stop before falling back to the deck.
    Widening beats starving — a card with no pool reverts to the repetitive
    deck distractors, which is the thing this module exists to avoid.
    """
    if not pool:
        return []
    key = (_norm_pos(pos), _norm_level(level))
    exact = pool.get(key)
    if exact:
        return exact

    same_pos = [t for (p, _lvl), ts in pool.items() if p == key[0] for t in ts]
    if same_pos:
        return same_pos

    same_level = [t for (_p, lvl), ts in pool.items() if lvl == key[1] for t in ts]
    if same_level:
        return same_level

    return [t for ts in pool.values() for t in ts]


def _norm_pos(raw) -> Optional[str]:
    text = (str(raw) if raw is not None else "").strip().upper()
    return text or None


def _norm_level(raw) -> Optional[str]:
    text = (str(raw) if raw is not None else "").strip().upper()
    return text or None
