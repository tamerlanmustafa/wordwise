"""
Unit tests for chest_service.py — the pure picker (`pick_chest_reward`).

The async `apply_chest_reward` and `award_session_chest` are
DB-touching and covered by the P3 smoke test.
"""
from __future__ import annotations

import random

from src.services.chest_service import (
    CHEST_WEIGHTS,
    COSMETIC_POOL,
    XP_LARGE_AMOUNT,
    XP_SMALL_AMOUNT,
    pick_chest_reward,
)
from src.services.streak_service import MAX_FREEZES_HELD


class TestPickChestReward:
    def test_returns_a_known_kind(self):
        # Sample many picks — every one should be a known kind.
        valid_kinds = {"xp_small", "xp_large", "freeze", "cosmetic"}
        for seed in range(50):
            r = random.Random(seed)
            reward = pick_chest_reward(freezes_held=0, rng=r)
            assert reward.kind in valid_kinds

    def test_deterministic_with_seeded_rng(self):
        a = pick_chest_reward(freezes_held=0, rng=random.Random(42))
        b = pick_chest_reward(freezes_held=0, rng=random.Random(42))
        assert a.as_dict() == b.as_dict()

    def test_freeze_at_cap_rerolls_to_xp_small(self):
        # Seed a roll that would otherwise yield 'freeze'. Find one first.
        freeze_seed = None
        for seed in range(500):
            r = random.Random(seed)
            if pick_chest_reward(freezes_held=0, rng=r).kind == "freeze":
                freeze_seed = seed
                break
        assert freeze_seed is not None, "Couldn't find a freeze-yielding seed"
        # At cap, same seed should yield xp_small instead.
        r2 = random.Random(freeze_seed)
        reward = pick_chest_reward(freezes_held=MAX_FREEZES_HELD, rng=r2)
        assert reward.kind == "xp_small"
        assert reward.payload["xp"] == XP_SMALL_AMOUNT

    def test_xp_small_payload(self):
        # First seed that yields xp_small.
        for seed in range(100):
            r = random.Random(seed)
            reward = pick_chest_reward(freezes_held=0, rng=r)
            if reward.kind == "xp_small":
                assert reward.label == f"+{XP_SMALL_AMOUNT} XP"
                assert reward.payload == {"xp": XP_SMALL_AMOUNT}
                return
        raise AssertionError("No xp_small seed found in 100 tries")

    def test_xp_large_payload(self):
        for seed in range(500):
            r = random.Random(seed)
            reward = pick_chest_reward(freezes_held=0, rng=r)
            if reward.kind == "xp_large":
                assert reward.label == f"+{XP_LARGE_AMOUNT} XP"
                assert reward.payload == {"xp": XP_LARGE_AMOUNT}
                return
        raise AssertionError("No xp_large seed found in 500 tries")

    def test_cosmetic_payload_uses_pool(self):
        for seed in range(500):
            r = random.Random(seed)
            reward = pick_chest_reward(freezes_held=0, rng=r)
            if reward.kind == "cosmetic":
                assert reward.label in COSMETIC_POOL
                assert reward.payload["cosmetic_name"] in COSMETIC_POOL
                return
        raise AssertionError("No cosmetic seed found in 500 tries")

    def test_distribution_roughly_matches_weights(self):
        # Sanity-check the weights with a large sample. Allow generous
        # bands so this isn't a flake — the point is "small ≫ large",
        # not exact percentages.
        counts = {"xp_small": 0, "xp_large": 0, "freeze": 0, "cosmetic": 0}
        N = 10_000
        r = random.Random(123)
        for _ in range(N):
            counts[pick_chest_reward(freezes_held=0, rng=r).kind] += 1
        # xp_small (weight 50) should be the most common.
        assert counts["xp_small"] == max(counts.values())
        # Each kind should be present.
        for kind in counts:
            assert counts[kind] > 0

    def test_weights_sum_to_one_hundred(self):
        # Not strictly required by the picker, but the table is meant to
        # read as "percent" — drift here is usually a bug.
        assert sum(w for w, _ in CHEST_WEIGHTS) == 100
