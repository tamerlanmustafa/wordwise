"""A freeze is armed by the user, and spent only when it actually works.

Two complaints, answered together.

**It was never the user's decision.** The only path that ever spent a freeze
was the lazy pass at the top of `GET /daily/state` — a read. So a freeze was
consumed by *opening the app*, and the client never showed it: `/daily/state`
has returned `auto_consumed` since the feature shipped and nothing in the
mobile app reads it.

**Freezes were burned even when they could not save the streak.** The consume
took `min(missed_days, held)` with no check that they bridged the gap, so a
ten-day absence cost all eight freezes and the streak reset anyway.

The model is Duolingo's: arm in advance, and an armed freeze covers a miss. The
spend still has to be automatic — the user is by definition not in the app on
the day they miss — but nothing is spent that they did not first choose to put
at risk, and nothing is spent unless it covers the whole gap.
"""
from datetime import date, timedelta

import pytest

from src.services.streak_service import (
    consume_freeze,
    count_equipped_freezes,
    count_held_freezes,
    equip_freeze,
    freezes_to_consume_for_gap,
    unequip_freeze,
)


class FakeFreeze:
    _next = 1

    def __init__(self, acquired_at, equipped_at=None, consumed_at=None):
        self.id = FakeFreeze._next
        FakeFreeze._next += 1
        self.acquiredAt = acquired_at
        self.equippedAt = equipped_at
        self.consumedAt = consumed_at
        self.consumedReason = None
        self.coveredDate = None


class FakeFreezeTable:
    """An in-memory `user_streak_freezes` that honours the filters the service
    actually passes — `consumedAt: None` and `equippedAt: {"not": None}` — so a
    test cannot pass by querying something the real table would not."""

    def __init__(self, rows):
        self.rows = rows

    def _match(self, where):
        out = []
        for r in self.rows:
            if "consumedAt" in where and where["consumedAt"] is None and r.consumedAt is not None:
                continue
            eq = where.get("equippedAt", "any")
            if eq == {"not": None} and r.equippedAt is None:
                continue
            if eq is None and r.equippedAt is not None:
                continue
            out.append(r)
        return out

    async def count(self, where):
        return len(self._match(where))

    async def find_first(self, where, order=None):
        rows = self._match(where)
        if not rows:
            return None
        if order and "equippedAt" in order:
            rows.sort(key=lambda r: r.equippedAt, reverse=order["equippedAt"] == "desc")
        else:
            rows.sort(key=lambda r: r.acquiredAt)
        return rows[0]

    async def update(self, where, data):
        # Generic `setattr`, not a field whitelist. A fake that enumerates the
        # columns it accepts throws the moment production writes a new one —
        # and the test then fails for a reason that has nothing to do with the
        # behaviour it guards.
        for r in self.rows:
            if r.id == where["id"]:
                for k, v in data.items():
                    setattr(r, k, v)
                return r
        return None


class FakeDB:
    """In-memory stand-in. `execute_raw` emulates the two raw statements the
    service now uses — the freeze claim and the anchor compare-and-swap.

    Emulating raw SQL in a fake is a real limitation and worth naming: this can
    verify the POLICY (who is spent, when, and how it is recorded) but it
    cannot verify the SQL or the concurrency guarantee, because a fake has no
    concurrency. `test_mercy_concurrency.py` covers that against real Postgres.
    """

    def __init__(self, rows):
        self.userstreakfreeze = FakeFreezeTable(rows)
        self.user = None
        self.user_row_date = None

    async def execute_raw(self, sql: str, *args):
        if "UPDATE user_streak_freezes" in sql:
            user_id, when, reason, covered = args
            claimable = [
                r for r in self.userstreakfreeze.rows
                if r.consumedAt is None and r.equippedAt is not None
            ]
            if not claimable:
                return 0
            claimable.sort(key=lambda r: r.acquiredAt)
            row = claimable[0]
            row.consumedAt = when
            row.consumedReason = reason
            row.coveredDate = covered
            return 1
        if "UPDATE users" in sql:
            # Compare-and-swap on the anchor: only the caller whose read still
            # matches wins the right to spend.
            _user_id, new_date, expected = args
            if self.user_row_date is not None and self.user_row_date != expected:
                return 0
            self.user_row_date = new_date
            return 1
        raise AssertionError(f"unexpected raw statement: {sql[:60]}")


DAY = date(2026, 5, 1)


def three_held():
    FakeFreeze._next = 1
    return [FakeFreeze(DAY), FakeFreeze(DAY + timedelta(days=1)), FakeFreeze(DAY + timedelta(days=2))]


class TestArming:
    @pytest.mark.asyncio
    async def test_nothing_is_armed_by_default(self):
        # The migration leaves every existing freeze unarmed on purpose:
        # nobody should lose one to a rule they were never shown.
        db = FakeDB(three_held())
        assert await count_held_freezes(db, 1) == 3
        assert await count_equipped_freezes(db, 1) == 0

    @pytest.mark.asyncio
    async def test_equipping_arms_exactly_one(self):
        db = FakeDB(three_held())
        assert await equip_freeze(db, user_id=1) is True
        assert await count_equipped_freezes(db, 1) == 1
        # …and does not change what is held. Arming is not spending.
        assert await count_held_freezes(db, 1) == 3

    @pytest.mark.asyncio
    async def test_equipping_takes_the_oldest_first(self):
        db = FakeDB(three_held())
        await equip_freeze(db, user_id=1)
        armed = [r for r in db.userstreakfreeze.rows if r.equippedAt]
        assert armed[0].acquiredAt == DAY

    @pytest.mark.asyncio
    async def test_unequipping_returns_it_to_the_inventory(self):
        db = FakeDB(three_held())
        await equip_freeze(db, user_id=1)
        assert await unequip_freeze(db, user_id=1) is True
        assert await count_equipped_freezes(db, 1) == 0
        assert await count_held_freezes(db, 1) == 3

    @pytest.mark.asyncio
    async def test_arming_stops_at_the_cap(self):
        # Without a cap the "decision" is not one: consumption is all-or-
        # nothing, so more armed is strictly better and the rational move is
        # always to arm everything. The cap does not make arming a free choice
        # — it bounds how much mercy can be spent automatically, so a long
        # absence cannot quietly drain a hoard.
        from src.services.streak_service import MAX_EQUIPPED_FREEZES

        db = FakeDB(three_held())
        for _ in range(5):
            await equip_freeze(db, user_id=1)
        assert await count_equipped_freezes(db, 1) == MAX_EQUIPPED_FREEZES
        assert MAX_EQUIPPED_FREEZES < 5  # below MAX_FREEZES_HELD, or it is no cap

    @pytest.mark.asyncio
    async def test_at_the_cap_equipping_reports_no_change(self):
        from src.services.streak_service import MAX_EQUIPPED_FREEZES

        db = FakeDB(three_held())
        for _ in range(MAX_EQUIPPED_FREEZES):
            assert await equip_freeze(db, user_id=1) is True
        # Not an error — "nothing changed" is the honest answer, and the UI
        # reads `changed` rather than translating a 400.
        assert await equip_freeze(db, user_id=1) is False

    @pytest.mark.asyncio
    async def test_unequipping_frees_a_slot(self):
        from src.services.streak_service import MAX_EQUIPPED_FREEZES

        db = FakeDB(three_held())
        for _ in range(MAX_EQUIPPED_FREEZES):
            await equip_freeze(db, user_id=1)
        await unequip_freeze(db, user_id=1)
        assert await equip_freeze(db, user_id=1) is True

    @pytest.mark.asyncio
    async def test_equipping_with_an_empty_inventory_is_not_an_error(self):
        # Tapping "equip" with nothing to equip is a reasonable thing to do.
        # "Nothing changed" is the honest answer, not a 400 the UI has to
        # translate into a message.
        db = FakeDB([])
        assert await equip_freeze(db, user_id=1) is False
        assert await unequip_freeze(db, user_id=1) is False


class TestSpending:
    @pytest.mark.asyncio
    async def test_an_unarmed_freeze_is_never_spent(self):
        # The whole point. Three held, none armed, so there is nothing the app
        # is allowed to take.
        db = FakeDB(three_held())
        assert await consume_freeze(db, user_id=1, reason="x") is False
        assert await count_held_freezes(db, 1) == 3

    @pytest.mark.asyncio
    async def test_an_armed_freeze_is_spent(self):
        db = FakeDB(three_held())
        await equip_freeze(db, user_id=1)
        assert await consume_freeze(db, user_id=1, reason="equipped_covered_missed_day") is True
        assert await count_held_freezes(db, 1) == 2
        assert await count_equipped_freezes(db, 1) == 0

    @pytest.mark.asyncio
    async def test_spending_records_why(self):
        db = FakeDB(three_held())
        await equip_freeze(db, user_id=1)
        await consume_freeze(db, user_id=1, reason="equipped_covered_missed_day")
        spent = [r for r in db.userstreakfreeze.rows if r.consumedAt]
        assert spent[0].consumedReason == "equipped_covered_missed_day"


class TestTheGapRule:
    """Restated here against the armed count, which is what mercy now reads."""

    TODAY = date(2026, 5, 19)

    def test_covers_the_whole_gap_or_spends_nothing(self):
        cases = {(1, 2): 0, (2, 2): 1, (3, 2): 2, (3, 1): 0, (5, 2): 0, (10, 8): 0}
        for (gap, armed), expected in cases.items():
            last = self.TODAY - timedelta(days=gap)
            assert freezes_to_consume_for_gap(self.TODAY, last, armed) == expected, (
                f"gap={gap} armed={armed}"
            )

    def test_zero_armed_spends_nothing_however_big_the_gap(self):
        assert freezes_to_consume_for_gap(self.TODAY, date(2026, 5, 1), 0) == 0


class TestTheDateWriteThatUsedToThrow:
    """The spend committed, then the request 500'd before the date moved.

    `auto_apply_mercy` wrote `srsLastSessionDate` as a bare `datetime.date`.
    prisma-client-py 0.11 serialises query arguments itself and has no encoder
    for that type, so the update raised — *after* the loop above it had already
    marked the freeze consumed. The user lost the freeze AND the streak broke
    anyway, which is the exact outcome the freeze was spent to prevent.

    The anchor write is now a compare-and-swap that runs BEFORE any freeze is
    spent, so the ordering that produced that failure no longer exists — but
    the date still has to be a `datetime`, and the whole point of this test is
    that nothing here may hand prisma a bare `date`.
    """

    @pytest.mark.asyncio
    async def test_the_rolled_date_is_written_as_a_datetime(self):
        from datetime import datetime, timezone

        from src.services.streak_service import auto_apply_mercy

        FakeFreeze._next = 1
        db = FakeDB([FakeFreeze(DAY, equipped_at=DAY)])

        class _UserTable:
            async def find_unique(self, where):
                return type("U", (), {
                    "id": 1,
                    "timezone": None,
                    # One day missed: yesterday-but-one.
                    "srsLastSessionDate": datetime(2026, 5, 17, tzinfo=timezone.utc),
                })()

        db.user = _UserTable()

        out = await auto_apply_mercy(
            db, user_id=1, now=datetime(2026, 5, 19, 12, 0, tzinfo=timezone.utc)
        )

        assert out["auto_consumed"] == 1
        # A bare `date` is what raised. `datetime` is what the column takes.
        assert isinstance(db.user_row_date, datetime), (
            f"anchor written as {type(db.user_row_date).__name__}; "
            "prisma-client-py cannot serialise a bare date — use utc_midnight"
        )
        assert db.user_row_date.date() == date(2026, 5, 18)
        # And the freeze records which day it paid for, as a datetime too.
        spent = [r for r in db.userstreakfreeze.rows if r.consumedAt][0]
        assert isinstance(spent.coveredDate, datetime)
        assert spent.coveredDate.date() == date(2026, 5, 18)
