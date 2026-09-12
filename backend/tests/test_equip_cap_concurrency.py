"""Two devices must not arm three freezes against a cap of two.

`equip_freeze` used to check the cap and then arm, as two statements:

    if await count_equipped_freezes(db, user_id) >= MAX_EQUIPPED_FREEZES:
        return False
    spare = await db.userstreakfreeze.find_first(...)   # oldest unarmed
    await db.userstreakfreeze.update(...)

Every `await` is a point where the event loop can run another request, and the
API is one process, so two equips interleave without needing two servers:

    A: count -> 1  (below the cap, proceed)
    B: count -> 1  (below the cap, proceed — A has not committed yet)
    A: find oldest unarmed -> #5, arm it, commit
    B: find oldest unarmed -> #6 (because #5 is armed now), arm it
    => 3 armed

This is a phantom read, and it is why the single-statement trick that fixes
`consume_freeze` does not fix this one: that claims a specific ROW, and a row
lock cannot cover a COUNT over rows. Folding the count in as a subquery reads
better and fixes nothing — under READ COMMITTED the subquery sees the snapshot
from when the statement began, which is exactly the stale read above. The fix
serialises on the parent `users` row instead.

The cap matters because it is a promise the product makes: armed freezes are
the only ones ever spent, and consumption is all-or-nothing, so "two armed" IS
"covered for up to two consecutive days". Three armed silently covers three.

Needs a real database — a fake has no concurrency, which is precisely why the
green unit suite had nothing to say about this. Skips when DATABASE_URL is not
reachable so CI without Postgres stays green rather than lying.
"""
import asyncio
import os
from datetime import datetime, timezone

import pytest

from src.services.streak_service import (
    MAX_EQUIPPED_FREEZES,
    count_equipped_freezes,
    equip_freeze,
    unequip_freeze,
)

pytestmark = pytest.mark.asyncio


def _database_url() -> str | None:
    """The real local database, read from `backend/.env` FIRST.

    Deliberately not `os.environ["DATABASE_URL"]`: `tests/conftest.py` sets
    that to a placeholder that looks local and fails to connect, which would
    turn this file into silent skips — a test that proves nothing while
    reporting green.
    """
    env = os.path.join(os.path.dirname(__file__), "..", ".env")
    try:
        with open(env, encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("DATABASE_URL"):
                    return line.split("=", 1)[1].strip().strip('"')
    except OSError:
        pass
    return os.environ.get("MERCY_RACE_DATABASE_URL")


async def _connect():
    try:
        from prisma import Prisma
    except Exception:
        return None
    url = _database_url()
    if not url or ("localhost" not in url and "127.0.0.1" not in url):
        # Never against anything but a local database: it writes.
        return None
    db = Prisma(datasource={"url": url})
    try:
        await db.connect()
    except Exception:
        return None
    return db


async def _seed(db, *, held: int) -> int:
    stamp = datetime.now(timezone.utc).timestamp()
    user = await db.user.create(data={
        "email": f"equip-race-{stamp}@example.test",
        "username": f"equiprace{int(stamp * 1000)}",
        "oauthProvider": "email",
    })
    for _ in range(held):
        await db.userstreakfreeze.create(data={
            "userId": user.id, "acquiredVia": "debug_grant",
        })
    return user.id


async def _cleanup(db, user_id: int) -> None:
    await db.userstreakfreeze.delete_many(where={"userId": user_id})
    await db.user.delete(where={"id": user_id})


async def test_concurrent_equips_never_exceed_the_cap():
    db = await _connect()
    if db is None:
        pytest.skip("no local database — this test writes and needs real concurrency")

    # Five held, so there is plenty of inventory for a race to over-arm from.
    user_id = await _seed(db, held=5)
    try:
        results = await asyncio.gather(*[
            equip_freeze(db, user_id=user_id) for _ in range(10)
        ])

        armed = await count_equipped_freezes(db, user_id)
        assert armed == MAX_EQUIPPED_FREEZES, f"{armed} armed against a cap of {MAX_EQUIPPED_FREEZES}"
        # And the return values have to agree with the database: exactly as
        # many callers were told "armed" as actually armed one, or the client
        # draws a slot that is not there.
        assert sum(1 for r in results if r) == MAX_EQUIPPED_FREEZES
    finally:
        await _cleanup(db, user_id)
        await db.disconnect()


async def test_concurrent_equips_cannot_over_arm_a_thin_inventory():
    db = await _connect()
    if db is None:
        pytest.skip("no local database — this test writes and needs real concurrency")

    # One held. The cap is not the binding constraint here, the inventory is —
    # and the same interleaving would arm a freeze that does not exist.
    user_id = await _seed(db, held=1)
    try:
        results = await asyncio.gather(*[
            equip_freeze(db, user_id=user_id) for _ in range(8)
        ])
        assert await count_equipped_freezes(db, user_id) == 1
        assert sum(1 for r in results if r) == 1
    finally:
        await _cleanup(db, user_id)
        await db.disconnect()


async def test_arming_and_disarming_at_once_settles_somewhere_legal():
    db = await _connect()
    if db is None:
        pytest.skip("no local database — this test writes and needs real concurrency")

    # A user hammering both buttons. There is no single correct end state —
    # it depends on the order the server happened to process them — but every
    # legal end state is within the cap and within the inventory, and no
    # freeze may be consumed by any of it.
    user_id = await _seed(db, held=3)
    try:
        await equip_freeze(db, user_id=user_id)
        await asyncio.gather(*[
            equip_freeze(db, user_id=user_id) if i % 2 == 0
            else unequip_freeze(db, user_id=user_id)
            for i in range(12)
        ])

        armed = await count_equipped_freezes(db, user_id)
        assert 0 <= armed <= MAX_EQUIPPED_FREEZES

        spent = await db.userstreakfreeze.count(
            where={"userId": user_id, "consumedAt": {"not": None}}
        )
        assert spent == 0, "arming is not spending"

        held = await db.userstreakfreeze.count(
            where={"userId": user_id, "consumedAt": None}
        )
        assert held == 3, "nothing may be created or destroyed by arming"
    finally:
        await _cleanup(db, user_id)
        await db.disconnect()
