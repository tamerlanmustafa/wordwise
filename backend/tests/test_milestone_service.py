"""Unit tests for milestone_service.py — pure milestone math.

`apply_milestone_unlocks` is DB-touching and covered by the P5 smoke test.
"""
from __future__ import annotations

from src.services.milestone_service import (
    MILESTONES,
    all_unlocks_for_streak,
    crossed_milestones,
    display_name_for,
    parse_unlocked,
)


class TestMilestoneTable:
    def test_ascending_thresholds(self):
        ds = [d for (d, _, _) in MILESTONES]
        assert ds == sorted(ds)

    def test_slugs_unique(self):
        slugs = [s for (_, s, _) in MILESTONES]
        assert len(slugs) == len(set(slugs))

    def test_canonical_names(self):
        # Pin the cinema names — they're part of the product copy.
        names_by_slug = {s: name for (_, s, name) in MILESTONES}
        assert names_by_slug["opening_weekend"] == "Opening Weekend"
        assert names_by_slug["box_office"] == "Box Office"
        assert names_by_slug["cult_classic"] == "Cult Classic"
        assert names_by_slug["criterion_collection"] == "Criterion Collection"


class TestCrossedMilestones:
    def test_no_change_returns_empty(self):
        assert crossed_milestones(prev_streak=5, new_streak=5) == []

    def test_descending_returns_empty(self):
        # Defensive: streaks shouldn't go backwards, but if they do we
        # don't fire phantom unlocks.
        assert crossed_milestones(prev_streak=10, new_streak=3) == []

    def test_crossing_first_threshold(self):
        # 6 → 7 hits Opening Weekend.
        assert crossed_milestones(6, 7) == ["opening_weekend"]

    def test_just_below_doesnt_cross(self):
        assert crossed_milestones(5, 6) == []

    def test_crossing_multiple_at_once(self):
        # 0 → 31 (rare but possible during a repair backfill) catches
        # both opening_weekend AND box_office.
        assert crossed_milestones(0, 31) == ["opening_weekend", "box_office"]

    def test_crossing_all(self):
        assert crossed_milestones(0, 400) == [
            "opening_weekend", "box_office", "cult_classic", "criterion_collection"
        ]

    def test_crossing_within_a_band(self):
        # 7 → 29 stays inside the opening_weekend band, doesn't cross
        # box_office.
        assert crossed_milestones(7, 29) == []


class TestAllUnlocksForStreak:
    def test_zero_streak_unlocks_nothing(self):
        assert all_unlocks_for_streak(0) == []

    def test_below_first_threshold(self):
        assert all_unlocks_for_streak(6) == []

    def test_at_first_threshold(self):
        assert all_unlocks_for_streak(7) == ["opening_weekend"]

    def test_at_third_threshold(self):
        assert all_unlocks_for_streak(150) == [
            "opening_weekend", "box_office", "cult_classic"
        ]

    def test_above_all_thresholds(self):
        assert all_unlocks_for_streak(9999) == [
            "opening_weekend", "box_office", "cult_classic", "criterion_collection"
        ]


class TestDisplayNameFor:
    def test_known_slug(self):
        assert display_name_for("box_office") == "Box Office"

    def test_unknown_slug_returns_none(self):
        assert display_name_for("nonexistent") is None


class TestParseUnlocked:
    def test_none_yields_empty(self):
        assert parse_unlocked(None) == []

    def test_list_passes_through(self):
        assert parse_unlocked(["a", "b"]) == ["a", "b"]

    def test_filters_non_strings(self):
        assert parse_unlocked(["a", 5, None, "b"]) == ["a", "b"]

    def test_json_string_is_parsed(self):
        assert parse_unlocked('["x", "y"]') == ["x", "y"]

    def test_bad_json_yields_empty(self):
        assert parse_unlocked("not-json") == []

    def test_garbage_type_yields_empty(self):
        assert parse_unlocked(42) == []
        assert parse_unlocked({"a": 1}) == []
