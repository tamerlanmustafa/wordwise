"""
Tests for the per-level rarity ceiling (`plausible_frequency_sql`).

A CEFR level and a frequency rank are two independent signals about the same
word. Levels track difficulty well at the centre — prod medians on 2026-09-10
ran A1 263, A2 933, B1 1,122, B2 4,073, C1 28,183, C2 204,173 — and fall apart
in the rare tail, where every level collects words nothing should teach:

    A1  outgo parasail houseware murderess signalman carbuncle souk forceps
    A2  wahoo ratatouille blithe swoosh settee rend yippee archeologist
    B2  quarrelsome clearness helpfulness uneaten untalented dehumanize arnica
    C2  bastinado mizzenmast googolplex poteen stridulation modiste nuncle

Those come from at least four unrelated causes — over-stripped lemmas
(`scissor`, `trouser`), British spellings (`odour`), dictionary derivations
(`untalented`), and Zipf-ladder guesses — which is the argument for a guard on
the output rather than a fifth fix on the input.

1. The ceiling is applied per level, symmetrically, with no text cast (#118).
2. A missing rank passes; absence of evidence is not evidence.
3. It stays out of `trusted_registry_sql`, so a saved word keeps its badge.
4. All three surfaces that teach from the registry apply it — the feed and
   distractor pool via `real_word_sql`, and both halves of a journey session
   by reading `lemmas` directly. Three routes to one rule is where drift
   starts, so each is pinned.

Source-level assertions because the pytest suite has no database.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from src.services.cefr_registry import (
    TEACHABLE_FREQUENCY_CEILING,
    plausible_frequency_sql,
    trusted_registry_sql,
)
from src.services.feed_pool import real_word_sql

SRC = Path(__file__).resolve().parents[1] / "src"

LEVELS = ("A1", "A2", "B1", "B2", "C1", "C2")


# ---------------------------------------------------------------------------
# 1. Shape of the fragment
# ---------------------------------------------------------------------------

def test_every_level_has_a_ceiling():
    assert tuple(TEACHABLE_FREQUENCY_CEILING) == LEVELS


def test_ceilings_rise_with_the_level():
    """A harder level must tolerate rarer words, or the guard inverts."""
    ceilings = [TEACHABLE_FREQUENCY_CEILING[level] for level in LEVELS]
    assert ceilings == sorted(ceilings)
    assert len(set(ceilings)) == len(ceilings)


@pytest.mark.parametrize("level", LEVELS)
def test_each_level_maps_to_its_own_ceiling(level):
    frag = plausible_frequency_sql("l")
    assert f"WHEN '{level}' THEN {TEACHABLE_FREQUENCY_CEILING[level]}" in frag


def test_the_ceilings_come_from_the_constant_not_a_second_copy():
    """Editing the dict must be enough — no literal may be hardcoded twice."""
    frag = plausible_frequency_sql("l")
    numbers = {int(n) for n in re.findall(r"THEN (\d+)", frag)}
    assert numbers == set(TEACHABLE_FREQUENCY_CEILING.values())


def test_does_not_cast_the_enum_column_to_text():
    """#118: a `cefr_level::text` predicate cannot use the index."""
    assert "cefr_level::text" not in plausible_frequency_sql("l")


def test_alias_is_honoured():
    frag = plausible_frequency_sql("cand")
    assert "cand.frequency_rank" in frag
    assert "cand.cefr_level" in frag
    assert "l.frequency_rank" not in frag


def test_unaliased_form_is_valid():
    frag = plausible_frequency_sql("")
    assert "frequency_rank" in frag
    assert "." not in frag.replace("...", "")


# ---------------------------------------------------------------------------
# 2. A missing rank passes
# ---------------------------------------------------------------------------

def test_a_null_rank_is_not_filtered_out():
    """The Zipf=0 lesson: no data is not a reason to make a teaching call."""
    assert "frequency_rank IS NULL OR" in plausible_frequency_sql("l")


def test_a_level_with_no_ceiling_is_left_alone():
    """UNKNOWN is trusted_registry_sql's job; this must not double as a second
    filter for it, or the two guards become impossible to reason about."""
    frag = plausible_frequency_sql("l")
    assert "ELSE l.frequency_rank END" in frag
    assert "'UNKNOWN'" not in frag


# ---------------------------------------------------------------------------
# 3. It must not leak into the display path
# ---------------------------------------------------------------------------

def test_trusted_registry_sql_does_not_carry_the_ceiling():
    """`trusted_registry_sql` also backs `registry_levels`, which is how an
    already-saved word gets the level on its badge. Too obscure to teach is
    not the same as having no level: a user who saved `bastinado` should still
    see what it was graded."""
    frag = trusted_registry_sql("l")
    assert "frequency_rank" not in frag


# ---------------------------------------------------------------------------
# 4. Both teaching decks apply it
# ---------------------------------------------------------------------------

def test_the_feed_and_distractor_pool_apply_it():
    assert "frequency_rank" in real_word_sql("l")


def test_the_journey_deck_applies_it():
    """`_get_journey_words_at_level` reads the registry directly rather than
    through `real_word_sql`, so it is the one place the pair can drift. It
    matters more there than in the feed: that deck is ordered easiest-first
    and paged by OFFSET, so the rare tail is not scattered through the pool —
    it is all waiting together at the last tiles."""
    source = (SRC / "routes" / "quiz.py").read_text(encoding="utf-8")
    assert "plausible_frequency_sql" in source

    journey = source[source.index("async def _get_journey_words_at_level"):]
    journey = journey[: journey.index("\nasync def ", 1)]
    assert 'plausible_frequency_sql("l")' in journey, (
        "the journey deck stopped applying the rarity ceiling"
    )


def test_both_halves_of_a_journey_session_apply_it():
    """`_movie_specific_words` is the other half of a journey session and also
    reads `lemmas` directly. A rule that held on one half and not the other is
    exactly the drift `feed_pool.real_word_sql` exists to prevent — ordering by
    `frequency_in_movie` does not save it, because a film with few mapped
    lemmas reaches the tail on the first tile."""
    source = (SRC / "routes" / "quiz.py").read_text(encoding="utf-8")
    movie = source[source.index("async def _movie_specific_words"):]
    movie = movie[: movie.index("\n@router", 1)]
    assert 'plausible_frequency_sql("l")' in movie, (
        "the movie half of a journey session stopped applying the ceiling"
    )
