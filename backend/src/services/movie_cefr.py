"""
Movie CEFR level — the single derivation.

A movie's level is a pure function of `movies.difficulty_score`. It used to be
derived three separate ways, and they disagreed on 39% of the catalogue (#103):

  * `movies.difficulty_level`, a six-value enum that `difficulty_scorer` filled
    by bucketing the same score — but mapping two bands onto one label, so A1
    and A2 both became ELEMENTARY and B1 and B2 both became INTERMEDIATE. The
    reel tiles and the saved-list rows read it, so 1,003 B2 films showed as B1
    there and BEGINNER / UPPER_INTERMEDIATE / PROFICIENT were never once used.
  * an inline ladder in `routes/movies.py` behind `/movies/{id}/difficulty`.
  * `CEFR_SCORE_RANGES` behind `/movies/by-cefr`, on different boundaries again.

418 films answered B1, B2 or C1 depending on which screen you were looking at.

The bands below are the ones `/movies/by-cefr` already used. They win because
the home feed is the surface people actually browse, and because the scorer's
own thresholds leave the shelves empty: it clamps most films into 0.35-0.65, so
prod scores span 18-72 and a 65-80 "C1" band holds 31 of 4,406 films where this
one holds 442.

Anything needing a movie's level calls `cefr_from_score`. Nothing stores the
result — a stored copy going stale is what caused this in the first place.
"""
from __future__ import annotations

from typing import Optional

# Easiest → hardest. Callers rendering a ladder should iterate this rather
# than writing the six codes out again.
CEFR_LEVELS: tuple[str, ...] = ("A1", "A2", "B1", "B2", "C1", "C2")

# Inclusive score bounds per level. Contiguous and gap-free across 0-100 —
# `tests/test_movie_cefr.py` pins that, because a gap would drop real films out
# of every level shelf at once while still leaving them in the catalogue.
#
# ── Why the top two bands are narrow (recalibrated 2026-09-03) ──────────────
# These boundaries were drawn as if `difficulty_score` used the full 0-100
# range. It does not. `difficulty_scorer` blends sixteen signals into 0.0-1.0
# and then clamps a film with little advanced vocabulary to 0.65, so the scores
# it actually produces are packed into a narrow hump: measured across all 4,429
# scored films in prod on 2026-09-03, p25=33, p50=39, p75=49, p92=55, and the
# single hardest film in the catalogue scores **72**.
#
# A C2 band of 70-100 therefore described a region almost nothing reaches. It
# held **7 films** — and not the hardest ones: the clamp caps most films at 65,
# so the only route past 70 was the genre multiplier applied afterwards
# (Documentary is 1.12, and 65 x 1.12 = 72 is exactly what Citizenfour and
# Blackfish score). C2 meant "documentary", not "hard vocabulary", and the C2
# shelf on Home was unusable.
#
# The bands below are cut at real quantiles of that distribution instead, so
# every shelf is stocked with the films that genuinely sit hardest:
#
#     A1  0-24    165 films   3.7%
#     A2 25-34  1,193        26.9%
#     B1 35-44  1,488        33.6%
#     B2 45-52    911        20.6%
#     C1 53-57    470        10.6%
#     C2 58-100   202         4.6%   (was 7)
#
# This is a *read-side* change and needs no backfill: nothing stores a level,
# by design (#103) — `cefr_from_score` derives it on every read. That is also
# what makes it cheap to revisit when the scorer's own range changes.
#
# Note the scale is the catalogue's, not an external CEFR authority's: "C2"
# here means "in the hardest ~5% of films we have", which is what a level shelf
# can honestly promise. Widening the scorer's output range is the separate,
# much larger job — it would mean re-running spaCy over every script.
CEFR_SCORE_RANGES: dict[str, tuple[int, int]] = {
    "A1": (0, 24),
    "A2": (25, 34),
    "B1": (35, 44),
    "B2": (45, 52),
    "C1": (53, 57),
    "C2": (58, 100),
}

# Builds shipped before #103 still call `/movies/by-level` with the retired
# `difficultylevel` enum names. That enum collapsed two bands onto one label,
# so there is no faithful inverse; each name maps to the lower of the two bands
# it covered, which is the level those builds were already displaying.
LEGACY_ENUM_TO_CEFR: dict[str, str] = {
    "BEGINNER": "A1",
    "ELEMENTARY": "A2",
    "INTERMEDIATE": "B1",
    "UPPER_INTERMEDIATE": "B2",
    "ADVANCED": "C1",
    "PROFICIENT": "C2",
}


def cefr_from_score(score: Optional[int]) -> Optional[str]:
    """
    The movie's CEFR level, or None when it has never been scored.

    None is a real answer here: 171 of 4,577 prod movies have no script
    processed yet, and the client renders no level pill for them rather than
    guessing A1.
    """
    if score is None:
        return None
    for level in CEFR_LEVELS:
        lo, hi = CEFR_SCORE_RANGES[level]
        if lo <= score <= hi:
            return level
    # `difficulty_scorer` clamps to 0-100 before storing, so this only fires on
    # hand-edited rows. Saturate rather than return None — an out-of-range score
    # is still a scored movie, and None would hide it from every shelf.
    return "C2" if score > 100 else "A1"


def score_range_for_cefr(level: str) -> Optional[tuple[int, int]]:
    """Inclusive `(lo, hi)` score bounds for a CEFR code, or None if unknown."""
    return CEFR_SCORE_RANGES.get((level or "").strip().upper())


def normalize_level(level: str) -> Optional[str]:
    """
    Accept a CEFR code or a legacy `difficultylevel` enum name, return the CEFR
    code. None means the caller sent something we do not recognise.
    """
    key = (level or "").strip().upper()
    if key in CEFR_SCORE_RANGES:
        return key
    return LEGACY_ENUM_TO_CEFR.get(key)
