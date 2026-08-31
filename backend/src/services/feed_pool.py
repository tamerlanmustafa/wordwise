"""
What counts as a card the Explore feed is allowed to show.

Two places need this definition and must never disagree: `_eligible_lemma_candidates`
in routes/srs.py (which serves the cards) and the vocab-coverage report (which
reports how many are left). A metric computed from a slightly different WHERE
clause than the feed's would report depth the feed cannot actually serve, which
is the exact failure mode the metric exists to catch (issue #116).

Level filtering is deliberately NOT part of the fragment: /today asks for the
user's band, /feed asks for whatever the mix names, and the report asks for all
of them. Everything else — real-word shape, admin curation, "has something to
read" — is global and lives here.

`real_word_sql` is the first two of those three, exposed on its own for the
quiz's distractor pool (`distractor_pool.py`), which needs a word to be
printable but not to be teachable. That is a split, not a second definition:
the feed and the coverage report both still read the composed
`feed_eligibility_sql`, so the pair this module exists to keep in agreement
still cannot drift apart.
"""
from __future__ import annotations

from typing import Iterable, Optional, Protocol

from .hidden_words import hidden_word_exclusion_sql

# Levels the Explore mix can address — the whole CEFR range. The mix panel is a
# composition bar over all six, so a user can dial the feed anywhere from A1 to
# C2, including a single level at 100%.
#
# A1 and C2 are the thin pools (measured on prod 2026-08-30: A1 1,756 and C2
# 2,706 eligible lemmas, against C1's 8,590), and `FEED_MIN_LEMMA_LENGTH` below
# is most of why A1 is thin — a lot of A1 vocabulary is under four letters. That
# threshold stays: it keeps tokenizer debris out of the feed, and fattening a
# level by lowering the bar for what counts as a word is not a trade worth
# making. Keeping a page full when a thin bucket runs dry is `_allocate_mix`'s
# job in routes/srs.py, which moves an exhausted level's share onto the levels
# that still have stock and reports the result in `mix_applied`.
FEED_MIX_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]

# Shorter strings are overwhelmingly abbreviations, interjections and
# tokenizer debris rather than words worth teaching.
FEED_MIN_LEMMA_LENGTH = 4


def real_word_sql(alias: str = "l") -> str:
    """WHERE-clause fragment: `alias` is a lemma fit to print at all.

    - looks like a real English word (alphabetic, >= FEED_MIN_LEMMA_LENGTH)
    - isn't curated away in hidden_words (which is also where profanity and the
      over-stripped junk lemmas live, so this is the filter that keeps them off
      a screen)

    Split out of `feed_eligibility_sql` for the quiz's distractor pool, which
    needs everything here and none of the "has an example sentence" test below:
    a distractor is a word on a tile the user reads once, not a card with a
    definition and a sentence under it. Requiring a sentence would shrink the
    pool to the same few thousand lemmas the feed draws from and put the
    repetition straight back.

    `alias` is written by the caller, never user input — it is interpolated.
    """
    return f"""
          {alias}.lemma ~ '^[a-zA-Z]+$'
          AND length({alias}.lemma) >= {FEED_MIN_LEMMA_LENGTH}
          AND {hidden_word_exclusion_sql(f"{alias}.lemma")}
    """


def feed_eligibility_sql(alias: str = "l") -> str:
    """WHERE-clause fragment: `alias` is a lemma the feed may surface.

    `real_word_sql` plus: has at least one global LLM-authored example
    sentence, so the card always has something to show.

    The "has a sentence" test reads `sll.is_global` instead of joining to
    sentence_bank (#120). Joining made the feed query rebuild the global-LLM set
    from scratch every request: 48,537 B-tree descents into a 7.7M-entry index,
    145,783 of its 150,441 buffers. `is_global` is that predicate denormalized
    onto the link (trigger-maintained), so the same test is a single probe into
    a 2 MB partial index.

    `alias` is written by the caller, never user input — it is interpolated.
    """
    return f"""
          {real_word_sql(alias)}
          AND EXISTS (
              SELECT 1
              FROM sentence_lemma_links sll
              WHERE sll.lemma_id = {alias}.id
                AND sll.is_global
          )
    """


class _SupportsQueryRaw(Protocol):
    async def query_raw(self, sql: str, *args): ...


async def feed_pool_by_level(
    db: _SupportsQueryRaw, levels: Optional[Iterable[str]] = None
) -> dict[str, int]:
    """How many lemmas each level can currently offer the feed.

    The per-user exclusion (`user_words`) is deliberately left out: this is the
    global stock every user draws from, and the answer must not depend on who
    happens to be asking.

    Levels with nothing in stock come back as 0 rather than missing, so a level
    that drains to empty is visible as a number instead of an absent key.
    """
    wanted = list(levels) if levels is not None else list(FEED_MIX_LEVELS)
    if not wanted:
        return {}
    # Callers pass CEFR labels from FEED_MIX_LEVELS, never raw user input.
    # Compare against `cefr_level` bare, not `cefr_level::text` — see
    # _eligible_lemma_candidates for why the cast is a trap (#118).
    levels_sql = ",".join(f"'{lvl}'" for lvl in wanted)
    rows = await db.query_raw(
        f"""
        SELECT l.cefr_level::text AS level, count(*)::int AS n
        FROM lemmas l
        WHERE l.cefr_level IN ({levels_sql})
          AND {feed_eligibility_sql("l")}
        GROUP BY 1
        """
    )
    counts = {lvl: 0 for lvl in wanted}
    for row in rows:
        level = str(row["level"]).upper()
        if level in counts:
            counts[level] = int(row["n"])
    return counts
