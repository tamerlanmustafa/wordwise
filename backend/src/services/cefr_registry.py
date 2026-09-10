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
with nothing tying the copies together.

#127 makes this module the single owner of "what level is this word", on the
read side as well. The per-script rows are NOT redundant copies to be
normalised away: they are the classifier's per-script observations, and
backfill_unknown_bucket.py recovered 4,094 lemmas by voting over exactly those
disagreements (`angry` B1 in 1,259 scripts vs UNKNOWN in 3). What was wrong is
that read paths served the observations instead of the aggregate — prod on
2026-08-22 had 10,757 lemmas carrying conflicting levels across scripts, so
the saved-words badge (which took whichever copy was inserted last) disagreed
with the registry for 7,262 distinct words, and 13,156 words sat in two to
four different journey decks at once. `registry_levels` and
`trusted_registry_sql` are what those readers call instead.

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
from typing import Dict, Iterable, List, Optional, Protocol

from src.services.cefr_classifier import (
    CEFRLevel,
    ClassificationSource,
    WordClassification,
)

logger = logging.getLogger(__name__)

def trusted_registry_sql(alias: str = "l") -> str:
    """WHERE-clause fragment: this `lemmas` row is a real classification.

    Two kinds of row must never be served as a level. UNKNOWN is the "could
    not classify" marker (#91), not a grade. And source='fallback' with no
    confidence is populate_lemma_registry's old A2 default for lemmas the
    classifier never placed — the #91 bucket wearing a different label. In
    prod that second class is 5,642 of the registry's 8,639 A2 rows, and
    5,526 of them appear in no script at all, so a reader that skips this
    test invents an A2 deck two thirds made of words nothing ever graded.

    The deliberate whitelists share source='fallback' but carry real
    confidence (kids 0.95, informal slang 0.85), so the split is on
    confidence, exactly as the #91 backfill did it.

    Compares literals against the enum column rather than casting the column
    to text — a `cefr_level::text` predicate is what mis-planned the
    vocabulary queries in #118.

    `alias` is written by the caller, never user input — it is interpolated.
    Pass "" for an unaliased single-table query.
    """
    p = f"{alias}." if alias else ""
    return (
        f"{p}cefr_level <> 'UNKNOWN' "
        f"AND NOT ({p}source = 'fallback' AND {p}confidence < 0.5)"
    )


#: The rarest a word may be and still be taught at each level.
#:
#: Levels track difficulty well at the centre — prod medians on 2026-09-10 run
#: A1 263, A2 933, B1 1,122, B2 4,073, C1 28,183, C2 204,173 — and fall apart in
#: the rare tail, where every level collects words nothing should teach:
#:
#:   A1  outgo parasail houseware murderess signalman carbuncle souk forceps
#:   A2  wahoo ratatouille blithe swoosh settee rend yippee archeologist
#:   B2  quarrelsome clearness helpfulness uneaten untalented dehumanize arnica
#:   C2  bastinado mizzenmast googolplex poteen stridulation modiste nuncle
#:
#: Those arrive from at least four unrelated causes — over-stripped lemmas
#: (`scissor`, `trouser`, `sunglass`), British spellings (`odour`,
#: `amphitheatre`), dictionary derivations nobody teaches (`untalented`,
#: `clearness`), and Zipf-ladder guesses. Fixing each at its source is the real
#: work (see the lemma-purity track); this is the output-side guard that also
#: catches the causes not yet diagnosed.
#:
#: Cost measured against the live decks: A1 2.7%, A2 6.7%, B1 3.3%, B2 1.7%,
#: C1 0.7%, C2 22.5%. C2 is the outlier because rarity is most of what defines
#: C2 — its ceiling is set far looser for that reason, and everything past it
#: was still junk at 400k, 600k and 800k when sampled.
TEACHABLE_FREQUENCY_CEILING: Dict[str, int] = {
    "A1": 10_000,
    "A2": 25_000,
    "B1": 40_000,
    "B2": 60_000,
    "C1": 150_000,
    "C2": 400_000,
}


def plausible_frequency_sql(alias: str = "l") -> str:
    """WHERE-clause fragment: this row is not too rare for the level it claims.

    A level and a frequency are two independent signals about the same word.
    Where they agree the grade is probably right; where a word graded A1 turns
    out to be the 457,088th most common word in English, one of them is wrong
    and the word is not worth a card either way.

    A NULL rank passes. "We have no frequency for this word" is the absence of
    evidence, and turning that into a teaching decision is the mistake that put
    684 dictionary-scrape words into the B2 deck (the Zipf=0 branch). Only 3
    servable rows in prod are NULL anyway.

    The CASE compares literals against the enum column rather than casting the
    column to text — a `cefr_level::text` predicate is what mis-planned the
    vocabulary queries in #118. `frequency_rank` carries `ix_lemmas_frequency_rank`.

    Deliberately NOT folded into `trusted_registry_sql`: that fragment also
    backs `registry_levels`, which is how an already-saved word gets the level
    on its badge. A word being too obscure to teach is not the same as it
    having no level, and a user who saved `bastinado` should still see what it
    was graded.

    `alias` is written by the caller, never user input, and is interpolated.
    Pass "" for an unaliased single-table query.
    """
    p = f"{alias}." if alias else ""
    whens = " ".join(
        f"WHEN '{level}' THEN {ceiling}"
        for level, ceiling in TEACHABLE_FREQUENCY_CEILING.items()
    )
    # UNKNOWN has no ceiling of its own; `trusted_registry_sql` is what keeps it
    # off a screen, and this fragment must not quietly become a second filter
    # for it.
    return (
        f"({p}frequency_rank IS NULL OR {p}frequency_rank <= "
        f"CASE {p}cefr_level {whens} ELSE {p}frequency_rank END)"
    )


# `lemma` is unique, so the ANY(...) drives an index scan; the level and source
# predicates only filter what it returns. The output casts are free: they shape
# the returned row, not the plan.
_REGISTRY_LOOKUP_SQL = (
    "SELECT lemma, cefr_level::text AS cefr_level, pos, confidence, "
    "source::text AS source, frequency_rank "
    "FROM lemmas "
    "WHERE lemma = ANY($1::text[]) "
    "AND " + trusted_registry_sql("")
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


async def registry_levels(
    db: _SupportsQueryRaw, words: Iterable[str]
) -> Dict[str, str]:
    """lemma -> CEFR level, for readers that need to badge a word (#127).

    One query for the whole batch, keyed by lowercase lemma. Words the
    registry cannot place are simply absent, so a caller does `.get(lemma)`
    and renders no badge rather than an "UNKNOWN" one.

    Readers must use this instead of `word_classifications`, which stores one
    row per (script, word) — the surface form's level in *that* script. Taking
    any single row from there is taking one script's vote: `DISTINCT ON (word)
    ... ORDER BY id DESC` picks whichever movie was ingested last, which is why
    7,262 words badged differently here than in Explore before this landed.
    """
    wanted = sorted({w.lower() for w in words if w and w.strip()})
    if not wanted:
        return {}
    rows = await db.query_raw(_REGISTRY_LOOKUP_SQL, wanted)
    return {row["lemma"]: row["cefr_level"] for row in rows}


async def registry_pos(
    db: _SupportsQueryRaw, words: Iterable[str]
) -> Dict[str, str]:
    """lemma -> raw UPOS tag (NOUN / VERB / ADJ / …), for callers that need to
    match words by grammatical type.

    Deliberately the RAW tag, not the learner label from `utils.pos_labels`.
    The friendly labels collapse PROPN onto "noun" and AUX onto "verb" because
    those distinctions do not help a reader; a matcher that wants a noun's
    wrong answers to also be nouns needs the distinction back, or a place name
    ends up as an option under a common noun.

    Same one-query, lemma-keyed, absent-if-unknown contract as
    `registry_levels`. ~14% of the registry has a NULL pos, and those rows are
    simply omitted.
    """
    wanted = sorted({w.lower() for w in words if w and w.strip()})
    if not wanted:
        return {}
    rows = await db.query_raw(_REGISTRY_LOOKUP_SQL, wanted)
    return {
        row["lemma"]: str(row["pos"]).upper()
        for row in rows
        if row.get("pos")
    }


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
