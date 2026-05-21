"""
Unit tests for pure helpers inside src/routes/srs.py.

The route handlers themselves require a Postgres + Prisma harness and are
covered by the P1 smoke test; here we pin down the pure CEFR-band logic
that drives the fresh-lemma padding in /srs/session/start.
"""
from __future__ import annotations

from src.routes.srs import _band_levels_around


class TestBandLevelsAround:
    def test_middle_level_gets_full_band(self):
        assert _band_levels_around("B1") == ["A2", "B1", "B2"]

    def test_lowest_level_clamps_left(self):
        # A1 has no level below it — band is two-wide.
        assert _band_levels_around("A1") == ["A1", "A2"]

    def test_highest_level_clamps_right(self):
        # C2 has no level above it — band is two-wide.
        assert _band_levels_around("C2") == ["C1", "C2"]

    def test_unknown_level_falls_back_to_b1(self):
        # Garbage in shouldn't crash — fall back to the most common band.
        assert _band_levels_around("Z9") == ["A2", "B1", "B2"]

    def test_a2_band(self):
        assert _band_levels_around("A2") == ["A1", "A2", "B1"]

    def test_c1_band(self):
        assert _band_levels_around("C1") == ["B2", "C1", "C2"]
