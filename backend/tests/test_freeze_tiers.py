"""Free arms one, Plus arms two — and nobody loses what they already had.

The freeze economy was identical for both tiers, which made it pointless as a
premium surface and, more importantly, made the mechanic say nothing. These
tests pin the split and, mostly, pin the things that must NOT differ.

## The shape of the decision

Exactly one knob moves: how many freezes an account may have ARMED. Because
consumption is all-or-nothing and only armed freezes are ever spent, that
number IS the product promise — one armed covers a one-day absence, two covers
two consecutive days.

The accrual rate deliberately does not move. The weekly grant and the chest
roll are earned by practising, and slowing them for free users would punish the
exact behaviour the feature exists to encourage. `test_the_odds_do_not_differ`
and `test_the_weekly_cadence_does_not_differ` exist to make that a decision
someone has to consciously reverse rather than something that erodes.
"""
import random

import pytest

from src.services.chest_service import CHEST_WEIGHTS, pick_chest_reward
from src.services.streak_service import (
    FREE_MAX_EQUIPPED,
    FREE_MAX_HELD,
    MAX_EQUIPPED_FREEZES,
    MAX_FREEZES_HELD,
    max_equipped_for,
    max_held_for,
    should_auto_grant_weekly,
)


class FakeUser:
    def __init__(self, tier="free", expires=None):
        self.id = 1
        self.subscriptionTier = tier
        self.subscriptionExpiresAt = expires


FREE = FakeUser("free")
PLUS = FakeUser("premium")


class TestTheSplit:
    def test_free_arms_one_and_plus_arms_two(self):
        assert max_equipped_for(FREE) == 1
        assert max_equipped_for(PLUS) == 2

    def test_free_banks_two_and_plus_banks_five(self):
        assert max_held_for(FREE) == 2
        assert max_held_for(PLUS) == 5

    def test_you_can_never_arm_more_than_you_can_hold(self):
        # A cap that lets an account arm freezes it cannot own would be a UI
        # drawing slots that can never fill.
        for user in (FREE, PLUS):
            assert max_equipped_for(user) <= max_held_for(user)

    def test_the_module_constants_are_the_widest_any_tier_goes(self):
        # Everything that does not know the caller's tier defaults to these,
        # so they have to be the permissive end. A default that was secretly
        # the FREE cap would quietly under-serve premium users, which is the
        # bug nobody reports.
        assert MAX_EQUIPPED_FREEZES >= FREE_MAX_EQUIPPED
        assert MAX_FREEZES_HELD >= FREE_MAX_HELD
        assert max_equipped_for(PLUS) == MAX_EQUIPPED_FREEZES
        assert max_held_for(PLUS) == MAX_FREEZES_HELD

    def test_an_unknown_or_missing_tier_is_treated_as_free(self):
        # `is_premium` is the single source of truth for this and already
        # handles admin/comped/trial. What matters here is that a user object
        # missing the field entirely does not crash the Practice tab.
        class Bare:
            id = 7

        assert max_equipped_for(Bare()) == FREE_MAX_EQUIPPED
        assert max_held_for(Bare()) == FREE_MAX_HELD


class TestWhatMustNotDiffer:
    def test_the_odds_do_not_differ(self):
        # The real invariant, not a word-search over the docstring: with room
        # to store the reward, the SAME seed yields the SAME reward whatever
        # the account's cap is. The cap can only ever act as a reroll
        # threshold; it must never reweight the table.
        for seed in range(300):
            free = pick_chest_reward(
                freezes_held=0, max_held=FREE_MAX_HELD, rng=random.Random(seed)
            )
            plus = pick_chest_reward(
                freezes_held=0, max_held=MAX_FREEZES_HELD, rng=random.Random(seed)
            )
            assert free.kind == plus.kind, f"seed {seed} diverged"

    def test_a_freeze_is_still_one_roll_in_five_for_everyone(self):
        # The weights table has no tier dimension at all. Stated as a number
        # so that changing it is a deliberate edit to a failing test rather
        # than a quiet retune.
        assert dict((kind, w) for w, kind in CHEST_WEIGHTS)["freeze"] == 20

    def test_the_weekly_cadence_does_not_differ(self):
        # Same function, same answer; only the cap it is measured against
        # changes. A free user practising every day still earns one a week.
        for cap in (FREE_MAX_HELD, MAX_FREEZES_HELD):
            assert should_auto_grant_weekly(
                __import__("datetime").date(2026, 9, 11),
                held_count=0,
                last_weekly_grant=None,
                max_held=cap,
            ) is True


class TestTheCapIsAGrantGateNotAConfiscation:
    def test_a_free_user_over_the_new_cap_simply_stops_earning(self):
        # Every free user is over it today — the caps used to be uniform at 5.
        # The cap must stop new grants and never imply removing what is held:
        # taking back something a user earned, on a release they did not ask
        # for, is not a cap, it is a clawback.
        import datetime

        assert should_auto_grant_weekly(
            datetime.date(2026, 9, 11),
            held_count=5,
            last_weekly_grant=None,
            max_held=FREE_MAX_HELD,
        ) is False

    def test_the_chest_rerolls_rather_than_wasting_the_reveal(self):
        # At the cap, a freeze roll becomes XP instead. The user still gets
        # something; nothing is silently dropped.
        seen = set()
        for seed in range(200):
            reward = pick_chest_reward(
                freezes_held=FREE_MAX_HELD,
                max_held=FREE_MAX_HELD,
                rng=random.Random(seed),
            )
            seen.add(reward.kind)
        assert "freeze" not in seen
        assert "xp_small" in seen

    def test_below_the_cap_a_free_user_can_still_win_one(self):
        seen = set()
        for seed in range(200):
            reward = pick_chest_reward(
                freezes_held=0, max_held=FREE_MAX_HELD, rng=random.Random(seed)
            )
            seen.add(reward.kind)
        assert "freeze" in seen


class TestTheOneTimeAutoArm:
    """The backfill that un-breaks every account created before arming."""

    @pytest.mark.asyncio
    async def test_it_arms_up_to_the_tier_cap_and_stamps_the_marker(self):
        from src.services.streak_service import autoarm_freezes_once

        armed_ids = []

        class Freeze:
            def __init__(self, i):
                self.id = i
                self.consumedAt = None
                self.equippedAt = None
                self.acquiredAt = i

        rows = [Freeze(i) for i in range(1, 6)]

        class Table:
            async def count(self, where):
                if where.get("equippedAt") == {"not": None}:
                    return sum(1 for r in rows if r.equippedAt is not None)
                return sum(1 for r in rows if r.consumedAt is None)

            async def find_first(self, where, order=None):
                spare = [r for r in rows if r.equippedAt is None]
                return spare[0] if spare else None

            async def update(self, where, data):
                for r in rows:
                    if r.id == where["id"]:
                        r.equippedAt = data["equippedAt"]
                        armed_ids.append(r.id)

        class DB:
            def __init__(self):
                self.userstreakfreeze = Table()
                self.stamped = 0

            def tx(self):
                outer = self

                class _Tx:
                    async def __aenter__(self):
                        return outer

                    async def __aexit__(self, *exc):
                        return False

                return _Tx()

            async def query_raw(self, sql, *args):
                return [{"id": args[0]}]

            async def execute_raw(self, sql, *args):
                assert "freeze_autoarm_at IS NULL" in sql, sql
                self.stamped += 1
                return 1

        db = DB()
        armed = await autoarm_freezes_once(db, user=FREE)
        assert armed == FREE_MAX_EQUIPPED, "a free account arms one"
        assert db.stamped == 1, "the marker is claimed exactly once"
        assert armed_ids == [1], "oldest first"

    @pytest.mark.asyncio
    async def test_an_account_already_stamped_is_left_alone(self):
        # The whole reason for a stored marker: a user who deliberately stood
        # every freeze down must not be re-armed on their next launch.
        from src.services.streak_service import autoarm_freezes_once

        class Stamped(FakeUser):
            freezeAutoarmAt = "2026-09-12T00:00:00Z"

        class DB:
            async def execute_raw(self, sql, *args):
                raise AssertionError("must not touch the database")

        assert await autoarm_freezes_once(DB(), user=Stamped()) == 0

    @pytest.mark.asyncio
    async def test_losing_the_claim_race_arms_nothing(self):
        # Two devices open the tab together. The one that does not win the
        # compare-and-swap must do nothing at all, or both arm up to the cap.
        from src.services.streak_service import autoarm_freezes_once

        class DB:
            async def execute_raw(self, sql, *args):
                return 0  # somebody else claimed it first

        assert await autoarm_freezes_once(DB(), user=FREE) == 0
