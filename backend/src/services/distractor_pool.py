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

THE FILM RUNG (#167)

The cost model has a hole a Screening Mode scene test falls straight through.
`build_pool` starts from the most *frequent* registry lemmas and keeps the
cached ones, so on a language nobody has warmed it comes back nearly empty —
prod on 2026-09-01 held 18,317 cached lemma translations for TR and 48 for ES,
21 DE, 6 RU, 1 PT — and a scene test then builds every grid from the three to
five words it is testing. That is the shell game above, with a deck too small
to even fill a grid. The one place a cold language *does* hold paid-for
translations is the film the reader is in: every card they revealed and every
word an earlier scene tested has been translated once already. `build_film_pool`
reads those back, so the ladder is wide pool → film → deck, and the film step
costs one indexed read and, again, no API call.

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
from .quiz_service import normalize_choice
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
        translated = translation_by_lemma.get(str(row["lemma"]))
        if translated:
            _add_to_bucket(pool, row["pos"], row["cefr_level"], translated)
    return pool


# The film's vocabulary that has already been translated into the user's
# language, with the registry's (pos, level) for bucketing. Two sources, both
# paid for by the deck the reader is looking at:
#
#   * `translation_cache` — the deck's standalone word translations and every
#     word an earlier scene test asked (its `batch_translate` writes here);
#   * `word_sentence_examples.word_translation` — the gloss the deck aligned to
#     a card's example sentence, which never touches translation_cache.
#
# `lemmas` is joined on the bare lemma column (its unique index; every lemma,
# classification and cache key in prod is already lower-case). A translation
# identical to its source is a passthrough the provider could not translate
# (the deck shows those as "same as English") and would be an English tile in
# a grid of Spanish ones, so it is dropped. `real_word_sql` is the same
# curation the wide pool applies: alphabetic, long enough, not hidden.
#
# Restricted to the parts of speech the DECK spans, at any level. Run against
# prod without that restriction the rung returned `that`, `this`, `with`,
# `your` — a film's most frequent words are its function words, and no learner
# mistakes "with" for the translation of a B2 verb, so those options give the
# answer away as surely as a mismatched grammar does. Rung 1 never meets this
# because it only ever queries the deck's own buckets. Level is deliberately
# left open: `pool_for` already treats a same-part-of-speech word from a
# neighbouring level as a fair distractor, and a cold film has too few
# translations to also demand an exact CEFR match.
#
# Per-bucket `row_number()`, then `ORDER BY rn` — the #116 trap, which the
# first version of this query walked straight into. Frequency rank correlates
# hard with CEFR, so one global `ORDER BY frequency_rank LIMIT n` hands every
# slot to the easiest bucket and returns nothing for the hard one. Ordering by
# rn takes each bucket's best candidate before any bucket's second.
#
# `DISTINCT ON` keeps one translation per lemma: the cache's plain word
# translation in preference to the sentence-aligned gloss, because a distractor
# is read on its own tile with no sentence to be aligned to.
_FILM_POOL_SQL = f"""
    WITH film AS (
        SELECT DISTINCT wc.lemma
        FROM movie_scripts ms
        JOIN word_classifications wc ON wc.script_id = ms.id
        WHERE ms.movie_id = $1
    ),
    paid AS (
        SELECT f.lemma AS lemma, tc.translated AS translated, 1 AS src
        FROM film f
        JOIN translation_cache tc
          ON tc.source_text = f.lemma AND tc.target_lang = $2
        UNION ALL
        SELECT LOWER(BTRIM(wse.lemma)), wse.word_translation, 2
        FROM word_sentence_examples wse
        WHERE wse.movie_id = $1
          AND wse.target_lang = $2
          AND wse.word_translation IS NOT NULL
    ),
    best AS (
        SELECT DISTINCT ON (lemma) lemma, translated
        FROM paid
        ORDER BY lemma, src
    ),
    ranked AS (
        SELECT
            l.lemma            AS lemma,
            l.pos              AS pos,
            l.cefr_level::text AS cefr_level,
            b.translated       AS translated,
            row_number() OVER (
                PARTITION BY l.cefr_level, l.pos
                ORDER BY l.frequency_rank ASC NULLS LAST, l.id
            ) AS rn
        FROM best b
        JOIN lemmas l ON l.lemma = b.lemma
        WHERE l.pos = ANY($3::text[])
          AND NOT (l.lemma = ANY($4::text[]))
          AND LOWER(BTRIM(b.translated)) <> l.lemma
          AND {real_word_sql("l")}
    )
    SELECT lemma, pos, cefr_level, translated
    FROM ranked
    WHERE rn <= {CANDIDATES_PER_BUCKET}
    ORDER BY rn, lemma
    LIMIT {MAX_CANDIDATES}
"""


async def build_film_pool(
    db: _SupportsQueryRaw,
    *,
    target_lang: str,
    movie_id: Optional[int],
    buckets: Iterable[BucketKey],
    exclude_lemmas: Iterable[str],
) -> dict[BucketKey, list[str]]:
    """The film rung: cached translations of the film's other words.

    `movie_id` is the film the scene belongs to and `exclude_lemmas` the words
    the scene is testing — a tested word must never be another question's
    wrong answer, which is the acceptance criterion this rung exists for.
    Only the parts of speech in `buckets` are candidates (their levels are
    not: see `_FILM_POOL_SQL`), so a deck of verbs is never offered the film's
    prepositions. A deck whose words the registry cannot place at all yields
    no rung, exactly as it yields no wide pool.

    Same contract as `build_pool`: `{(pos, level): [translation, ...]}` with
    empty buckets omitted so `pool_for`'s ladder works unchanged, one
    translation per lemma, never raises (a failure costs variety, not the
    session), and **no translation API call** — anything the film has not
    already paid to translate is simply not a candidate. One indexed read.
    """
    lang = (target_lang or "").upper()
    tags = sorted({pos for pos, _level in buckets if pos})
    if movie_id is None or not lang or lang == "EN" or not tags:
        return {}

    excluded = sorted({w.lower() for w in exclude_lemmas if w})
    try:
        rows = await db.query_raw(_FILM_POOL_SQL, movie_id, lang, tags, excluded)
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("[distractor_pool] film pool query failed: %s", e)
        return {}

    pool: dict[BucketKey, list[str]] = {}
    seen: set[str] = set()
    for row in rows:
        lemma = str(row["lemma"])
        translated = row.get("translated")
        # One option per lemma: the gloss and the cache may both hold it, and
        # two tiles for one word would be two "right" answers in disguise.
        if lemma in seen or not translated:
            continue
        seen.add(lemma)
        _add_to_bucket(pool, row["pos"], row["cefr_level"], str(translated))
    return pool


def is_thin(
    pool: dict[BucketKey, list[str]],
    n_cards: int,
    *,
    per_card: int = 3,
) -> bool:
    """Whether `pool` is too small to give every card its own wrong answers.

    A session of N cards wants `per_card × N` distinct options — fewer and
    `avoid` starts recycling before the last card. Measured on the total, not
    per bucket, because `pool_for` widens to the whole pool before it gives
    up, so the total is what a starved card actually sees. This is the gate
    on the film rung: a warm language never pays for a read it would not use,
    a cold one always does.
    """
    return sum(len(v) for v in pool.values()) < per_card * max(0, n_cards)


def merge_pools(
    wide: dict[BucketKey, list[str]],
    film: dict[BucketKey, list[str]],
) -> tuple[dict[BucketKey, list[str]], int]:
    """`wide` widened with everything in `film` it doesn't already hold.

    Returns the merged pool and how many options the film rung actually
    contributed, which is the only number worth logging: a film pool of 40
    that adds 0 means the wide pool already had them.

    Merged rather than used as a separate fallback because `pool_for`'s
    ladder is what decides how far a card widens, and a card whose exact
    (pos, level) bucket exists in `wide` would never reach a second dict —
    which is exactly the starved card the film rung is for. Wide entries
    keep their position at the front of each bucket, so the better-matched
    registry candidates are still what a card sees first.

    Dedupe is on `normalize_choice`, the same key the choice builder uses
    for `avoid`, and it spans the whole pool rather than each bucket: one
    grid can draw from several buckets through the ladder, so a translation
    that appears in two buckets could still land twice in one grid.
    """
    if not film:
        return wide, 0
    merged = {key: list(vals) for key, vals in wide.items()}
    seen = {normalize_choice(t) for vals in merged.values() for t in vals}
    added = 0
    for key, translations in film.items():
        for t in translations:
            fold = normalize_choice(t)
            if fold in seen:
                continue
            seen.add(fold)
            merged.setdefault(key, []).append(t)
            added += 1
    return merged, added


def _add_to_bucket(
    pool: dict[BucketKey, list[str]], pos, level, translated: str
) -> None:
    pool.setdefault((_norm_pos(pos), _norm_level(level)), []).append(translated)


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
