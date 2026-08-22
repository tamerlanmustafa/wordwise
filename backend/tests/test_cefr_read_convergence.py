"""
Issue #127: one word, one level — on the read side too.

`word_classifications` holds one row per (script, surface word). That is not
redundant duplication to be normalised away: it is the classifier's per-script
observation log, and backfill_unknown_bucket.py recovered 4,094 lemmas by
voting over exactly those disagreements (#131). The defect was that user-facing
readers served the observations instead of the aggregate in `lemmas`.

Measured on prod 2026-08-22, before this landed:

  * 10,757 lemmas carried conflicting levels across scripts, so the SRS badge
    query — DISTINCT ON (word) ORDER BY id DESC — showed whichever movie was
    ingested last. 7,262 distinct words badged differently here than in
    Explore, which already read `lemmas`.
  * 13,156 of 56,448 words sat in two to four different journey decks at once.
  * The A1 journey deck was keyed by surface form, so 3,293 of its 5,664
    entries had no registry row at all: `hands`, `months`, `passed`,
    `understands`, `buttoning`, `prettiest` taught beside their base forms.

What is asserted here is that the readers now go through cefr_registry, that
the registry's trust rule is applied when they do, and that the journey deck
did not silently change *what kind of thing* it teaches while changing where
the level comes from.

No Postgres and no Prisma engine: the fakes replay a fixed registry.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from src.routes.quiz import _get_journey_words_at_level
from src.services.cefr_registry import (
    _REGISTRY_LOOKUP_SQL,
    registry_levels,
    trusted_registry_sql,
)

_SRC = Path(__file__).resolve().parents[1] / "src"


class _FakeRegistryDB:
    """Replays a `lemmas` table, applying the SQL's own predicates."""

    def __init__(self, registry: dict[str, dict]):
        self.registry = registry
        self.calls: list[tuple[str, tuple]] = []

    async def query_raw(self, sql: str, *args):
        self.calls.append((" ".join(sql.split()), args))
        requested = set(args[0]) if args else set()
        rows = []
        for lemma, row in self.registry.items():
            if lemma not in requested:
                continue
            if row["cefr_level"] == "UNKNOWN":
                continue
            if row["source"] == "fallback" and row["confidence"] < 0.5:
                continue
            rows.append({"lemma": lemma, "frequency_rank": None, **row})
        return rows


def _row(level: str, source: str = "efllex", confidence: float = 1.0) -> dict:
    return {"cefr_level": level, "confidence": confidence, "source": source}


# ---------------------------------------------------------------------------
# registry_levels — the badge lookup
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_badge_level_comes_from_the_registry():
    db = _FakeRegistryDB({"betray": _row("B2"), "journey": _row("A1")})

    levels = await registry_levels(db, ["betray", "journey"])

    assert levels == {"betray": "B2", "journey": "A1"}


@pytest.mark.asyncio
async def test_surface_forms_are_lowercased_to_reach_the_registry():
    """
    `user_words.word` is whatever the user tapped, so it can be capitalised.
    The registry is lowercase-keyed; a case-sensitive probe silently badges
    nothing, which is how the old query lost words it should have placed.
    """
    db = _FakeRegistryDB({"journey": _row("A1")})

    levels = await registry_levels(db, ["Journey", "  ", ""])

    assert levels == {"journey": "A1"}
    assert db.calls[0][1] == (["journey"],)


@pytest.mark.asyncio
async def test_one_query_for_the_whole_deck_and_none_when_empty():
    db = _FakeRegistryDB({"a": _row("A1"), "b": _row("B1")})

    assert await registry_levels(db, ["a", "b", "a"]) == {"a": "A1", "b": "B1"}
    assert len(db.calls) == 1
    assert db.calls[0][1] == (["a", "b"],)

    assert await registry_levels(db, []) == {}
    assert len(db.calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "row",
    [
        # The "could not classify" marker is not a level (#91) — a word in it
        # gets no badge rather than an "UNKNOWN" one.
        _row("UNKNOWN"),
        # populate_lemma_registry's old A2 default: 5,642 of the registry's
        # 8,639 A2 rows in prod, 5,526 of which appear in no script at all.
        _row("A2", source="fallback", confidence=0.0),
    ],
)
async def test_words_the_registry_cannot_really_place_get_no_badge(row):
    db = _FakeRegistryDB({"adumbrate": row})

    assert await registry_levels(db, ["adumbrate"]) == {}


@pytest.mark.asyncio
async def test_deliberate_whitelists_still_badge():
    """Kids whitelist (A2/0.95) and informal slang (B1/0.85) are real calls."""
    db = _FakeRegistryDB({
        "yippee": _row("A2", source="fallback", confidence=0.95),
        "gonna": _row("B1", source="fallback", confidence=0.85),
    })

    assert await registry_levels(db, ["yippee", "gonna"]) == {
        "yippee": "A2", "gonna": "B1",
    }


# ---------------------------------------------------------------------------
# The trust rule has one owner
# ---------------------------------------------------------------------------

def test_trusted_registry_sql_is_the_single_definition():
    """
    The write path (apply_registry_levels), the badge lookup and the journey
    deck must apply the same rule. Two copies of it is how the levels drifted
    in the first place.
    """
    assert trusted_registry_sql("") in _REGISTRY_LOOKUP_SQL
    aliased = trusted_registry_sql("l")
    assert "l.cefr_level <> 'UNKNOWN'" in aliased
    assert "NOT (l.source = 'fallback' AND l.confidence < 0.5)" in aliased
    # No cast on the enum COLUMN in a predicate: `cefr_level::text = ...` is
    # what mis-planned the vocabulary queries in #118.
    assert "cefr_level::text" not in aliased


# ---------------------------------------------------------------------------
# The journey deck
# ---------------------------------------------------------------------------

class _FakeJourneyDB:
    """Records the deck SQL and replays a fixed candidate list."""

    def __init__(self, words: list[str], hidden: list[str] | None = None):
        self.words = words
        self.hidden = hidden or []
        self.deck_sql = ""
        self.deck_args: tuple = ()

    async def query_raw(self, sql: str, *args):
        if "hidden_words" in sql:
            requested = set(args[0])
            return [{"word": w} for w in self.hidden if w in requested]
        self.deck_sql = " ".join(sql.split())
        self.deck_args = args
        return [{"word": w, "best_rank": i} for i, w in enumerate(self.words)]


@pytest.mark.asyncio
async def test_journey_deck_reads_the_registry_not_the_observations():
    db = _FakeJourneyDB(["stakeholder"])

    assert await _get_journey_words_at_level(db, "B1", 0, 10) == ["stakeholder"]
    assert "FROM lemmas" in db.deck_sql
    assert "word_classifications" not in db.deck_sql
    assert trusted_registry_sql("l") in db.deck_sql


@pytest.mark.asyncio
async def test_journey_deck_pages_deterministically():
    """
    frequency_rank is not unique, so OFFSET without a tiebreaker lets two
    tiles skip or repeat a word.
    """
    db = _FakeJourneyDB(["stakeholder"])

    await _get_journey_words_at_level(db, "B1", 20, 10)

    assert "ORDER BY l.frequency_rank ASC NULLS LAST, l.lemma ASC" in db.deck_sql
    assert db.deck_args[1:3] == (20, 10)


@pytest.mark.asyncio
async def test_journey_deck_stays_single_words():
    """
    `lemmas` also holds idioms and phrasal verbs, which word_classifications
    never did, and their frequency_rank puts them at the very front: without
    this predicate prod's A2 tile 0 came back `get in, in time, get on, on
    time` and B1's `on and on, go on, first of all`. 1,776 of 26,266 trusted
    rows, but most of what a learner would have seen.
    """
    db = _FakeJourneyDB(["stakeholder"])

    await _get_journey_words_at_level(db, "B1", 0, 10)

    assert "l.lemma ~ '^[a-zA-Z]+$'" in db.deck_sql


@pytest.mark.asyncio
async def test_ultra_common_a1_words_are_excluded_before_the_page_is_cut():
    """
    Ordering honestly by frequency puts function words first — prod's A1 tile
    0 is `a, and, for, in, of, that, the, to, are, at`. Filtering those after
    the fetch would empty the page and 404 the session, so the stoplist is a
    bound parameter in the WHERE clause. It applies at A1 only, mirroring
    should_keep_word.
    """
    db = _FakeJourneyDB(["about"])

    await _get_journey_words_at_level(db, "A1", 0, 10)
    a1_stoplist = db.deck_args[3]
    assert "the" in a1_stoplist and "and" in a1_stoplist

    await _get_journey_words_at_level(db, "B1", 0, 10)
    assert db.deck_args[3] == []


@pytest.mark.asyncio
async def test_journey_deck_still_drops_hidden_profane_and_international():
    """
    The rest of should_keep_word survives the move to the registry. Mild
    profanity is deliberately kept (`ass` is B2 in prod and does reach that
    deck) — only strong words and slurs go, same as everywhere else.
    """
    db = _FakeJourneyDB(
        ["curated", "fuck", "taxi", "ass", "commission"], hidden=["curated"]
    )

    words = await _get_journey_words_at_level(db, "B2", 0, 10)

    assert words == ["ass", "commission"]


# ---------------------------------------------------------------------------
# No reader drifts back
# ---------------------------------------------------------------------------

# movies.py's `cefr_distribution` is the one deliberate exception. Converging
# it costs 4.67ms -> 45.95ms on /movies/by-cefr (measured on prod), because the
# lemmas join gives up ix_word_classifications_script_cefr — and the shipping
# mobile app never reads the field (apps/mobile/src/services/api.ts takes only
# unique_words). Revisit if a client starts rendering it.
_ALLOWED_READERS = {"movies.py"}


def test_no_route_badges_a_word_from_word_classifications():
    """
    A level read per (script, word) is one script's vote, not the word's
    level. This is the guard that stops the next reader from reintroducing
    the divergence #127 closed.
    """
    offenders = []
    for path in sorted((_SRC / "routes").glob("*.py")):
        if path.name in _ALLOWED_READERS:
            continue
        text = path.read_text()
        for match in re.finditer(r"word_classifications", text):
            window = text[match.start(): match.start() + 400]
            if "cefr_level" in window:
                offenders.append(path.name)
                break

    assert offenders == [], (
        f"{offenders} select cefr_level from word_classifications. That table "
        "stores one row per (script, surface word); use cefr_registry's "
        "registry_levels / trusted_registry_sql so every surface agrees (#127)."
    )


def test_srs_badges_through_the_registry():
    text = (_SRC / "routes" / "srs.py").read_text()

    assert "registry_levels" in text
    # The old pick-the-newest-row query, which is what disagreed.
    assert "DISTINCT ON (wc.word)" not in text
