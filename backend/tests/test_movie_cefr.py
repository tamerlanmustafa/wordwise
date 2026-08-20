"""
Unit tests for src/services/movie_cefr.py — issue #103.

The bug this guards against is not a wrong band, it is a *second* band. A
movie's CEFR level had four derivations (the stored enum, an inline ladder on
the detail endpoint, `CEFR_SCORE_RANGES` on the home feed, and a percentage
rule in the legacy scorer) and they disagreed on 39% of the catalogue, with 418
films answering B1, B2 or C1 depending on which screen you opened.

So the interesting tests here are the structural ones at the bottom: they fail
if anyone re-introduces a threshold ladder somewhere else, or stores a level
column again. The boundary tests are cheap insurance on top.
"""
from __future__ import annotations

import inspect
from pathlib import Path

import pytest

from src.services.movie_cefr import (
    CEFR_LEVELS,
    CEFR_SCORE_RANGES,
    LEGACY_ENUM_TO_CEFR,
    cefr_from_score,
    normalize_level,
    score_range_for_cefr,
)

BACKEND_SRC = Path(__file__).resolve().parents[1] / "src"


class TestBands:
    @pytest.mark.parametrize(
        "score,expected",
        [
            (0, "A1"),
            (24, "A1"),
            (25, "A2"),
            (34, "A2"),
            (35, "B1"),
            (44, "B1"),
            (45, "B2"),
            (54, "B2"),
            (55, "C1"),
            (69, "C1"),
            (70, "C2"),
            (100, "C2"),
        ],
    )
    def test_every_boundary_lands_on_the_intended_side(self, score, expected):
        assert cefr_from_score(score) == expected

    def test_unscored_movies_have_no_level_rather_than_a_guessed_one(self):
        # 171 of 4,577 prod movies have never had a script processed. The
        # client renders no pill for them; defaulting to A1 would advertise
        # them as beginner films.
        assert cefr_from_score(None) is None

    def test_out_of_range_scores_saturate_instead_of_vanishing(self):
        # The scorer clamps to 0-100, so this is hand-edited-row territory.
        # Returning None would drop a scored film off every shelf at once.
        assert cefr_from_score(-5) == "A1"
        assert cefr_from_score(140) == "C2"

    def test_the_bands_are_contiguous_and_cover_0_to_100(self):
        # A gap would make real films unreachable from every level shelf while
        # leaving them in the catalogue — the hardest kind of absence to spot.
        bounds = [CEFR_SCORE_RANGES[lvl] for lvl in CEFR_LEVELS]
        assert bounds[0][0] == 0
        assert bounds[-1][1] == 100
        for (_, prev_hi), (next_lo, _) in zip(bounds, bounds[1:]):
            assert next_lo == prev_hi + 1

    def test_every_level_holds_at_least_one_score(self):
        for lvl in CEFR_LEVELS:
            lo, hi = CEFR_SCORE_RANGES[lvl]
            assert lo <= hi

    def test_levels_are_ordered_easiest_to_hardest(self):
        assert CEFR_LEVELS == ("A1", "A2", "B1", "B2", "C1", "C2")
        scores = [CEFR_SCORE_RANGES[lvl][0] for lvl in CEFR_LEVELS]
        assert scores == sorted(scores)


class TestRoundTrip:
    @pytest.mark.parametrize("level", CEFR_LEVELS)
    def test_a_levels_own_range_maps_back_to_that_level(self, level):
        # The by-level and by-cefr endpoints filter with score_range_for_cefr
        # and the detail endpoint labels with cefr_from_score. If these two
        # ever disagree, a film appears on one shelf wearing another's badge —
        # which is exactly what #103 was.
        lo, hi = score_range_for_cefr(level)
        assert cefr_from_score(lo) == level
        assert cefr_from_score(hi) == level

    def test_unknown_level_has_no_range(self):
        assert score_range_for_cefr("Z9") is None
        assert score_range_for_cefr("") is None


class TestNormalizeLevel:
    def test_accepts_cefr_codes_in_any_case(self):
        assert normalize_level("b2") == "B2"
        assert normalize_level(" A1 ") == "A1"

    def test_accepts_the_retired_enum_names_from_shipped_builds(self):
        # /movies/by-level used to take only these. Installs already on phones
        # still send them, so they must keep resolving.
        assert normalize_level("ELEMENTARY") == "A2"
        assert normalize_level("INTERMEDIATE") == "B1"

    def test_covers_every_value_the_old_enum_had(self):
        assert set(LEGACY_ENUM_TO_CEFR.values()) == set(CEFR_LEVELS)

    def test_rejects_anything_else(self):
        assert normalize_level("EXPERT") is None
        assert normalize_level("") is None

    def test_onboarding_first_film_call_resolves(self):
        # The concrete regression: onboarding passes the learner's CEFR band
        # to /movies/by-level, which validated against the enum and 400'd, so
        # every new user saw an empty "pick your first film" list.
        for level in CEFR_LEVELS:
            assert normalize_level(level) == level


class TestNoSecondDerivation:
    """
    Structural guards. These are the point of the file.
    """

    def test_only_this_module_declares_the_bands(self):
        offenders = []
        for path in BACKEND_SRC.rglob("*.py"):
            if path.name == "movie_cefr.py":
                continue
            if "CEFR_SCORE_RANGES = " in path.read_text(encoding="utf-8"):
                offenders.append(str(path.relative_to(BACKEND_SRC)))
        assert offenders == [], (
            "CEFR_SCORE_RANGES must be declared only in services/movie_cefr.py; "
            f"a second copy is how #103 happened. Found in: {offenders}"
        )

    def test_the_scorer_returns_a_score_and_no_level(self):
        # compute_difficulty_advanced used to return a `difficultylevel` that
        # collapsed A1/A2 and B1/B2 into one label each, and callers stored it
        # next to the score it contradicted.
        from src.services.difficulty_scorer import (
            compute_difficulty,
            compute_difficulty_advanced,
        )

        assert len(inspect.signature(compute_difficulty_advanced).return_annotation.__args__) == 2
        score, dist = compute_difficulty({"A1": 100, "B2": 10})
        assert isinstance(score, int)
        assert isinstance(dist, dict)

    def test_no_route_writes_a_movie_difficulty_level(self):
        offenders = []
        for path in (BACKEND_SRC / "routes").rglob("*.py"):
            if path.name == "books.py":
                continue  # `books` is a different, empty table — see #103 notes
            if "'difficultyLevel'" in path.read_text(encoding="utf-8"):
                offenders.append(str(path.relative_to(BACKEND_SRC)))
        assert offenders == [], (
            "movies.difficulty_level is gone (#103); the level is derived from "
            f"difficulty_score on read. Writers found in: {offenders}"
        )

    def test_no_sql_selects_the_dropped_column(self):
        offenders = []
        for path in BACKEND_SRC.rglob("*.py"):
            if path.name == "movie_cefr.py":
                continue  # documents the retired column by name, on purpose
            for line in path.read_text(encoding="utf-8").splitlines():
                stripped = line.strip()
                # Prose explaining the change is fine; a SELECT is not.
                if stripped.startswith(("#", "*", "--")):
                    continue
                if "m.difficulty_level" in line or "movies.difficulty_level" in line:
                    offenders.append(f"{path.relative_to(BACKEND_SRC)}: {stripped}")
        assert offenders == [], (
            "movies.difficulty_level no longer exists; selecting it is a "
            f"runtime SQL error no typecheck sees. Found: {offenders}"
        )
