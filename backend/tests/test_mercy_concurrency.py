"""Two devices must not pay twice for one missed day.

`auto_apply_mercy` runs inside `GET /daily/state`, which the Practice tab fires
on mount and on every hidden→visible transition. Two devices — or one app
double-mounting — reach it at the same moment, read the same gap, and both
decide to burn it.

Measured before the fix, five concurrent calls against 3 armed freezes and ONE
missed day:

    before:  3 armed,  last_session_date = 2026-09-09
    after :  1 armed,  last_session_date = 2026-09-10
    consumed rows: 2            <- one was owed

Two guards, and both are wanted:

  * `consume_freeze` claims a row in ONE statement
    (`UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)`), so two
    callers cannot mark the same freeze;
  * `auto_apply_mercy` compare-and-swaps `srs_last_session_date` from the value
    it read BEFORE spending anything, so only one caller earns the right to
    spend at all. Atomic claims alone would not fix this — both callers
    computed `burn` from the same stale read and would claim *different* rows,
    spending 2N between them.

This file needs a real database: a fake has no concurrency, which is precisely
why the bug lived through a green unit suite. It skips when DATABASE_URL is not
reachable, so CI without Postgres stays green rather than lying.
"""
import asyncio
import os
from datetime import date, datetime, timedelta, timezone

import pytest

from src.services.streak_service import auto_apply_mercy

pytestmark = pytest.mark.asyncio


def _database_url() -> str | None:
    """The real local database, read from `backend/.env` FIRST.

    Deliberately not `os.environ["DATABASE_URL"]`: `tests/conftest.py` sets
    that to a placeholder (`postgresql://test:test@localhost:5432/test_db`) so
    the unit suite never touches a real database. That placeholder *looks*
    local and fails to connect — which silently turned this file into three
    skips, i.e. a test that proves nothing while reporting green. The file on
    disk is the only honest source here.
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
    """A connected Prisma client, or None when there is no database here."""
    try:
        from prisma import Prisma
    except Exception:
        return None
    url = _database_url()
    if not url or ("localhost" not in url and "127.0.0.1" not in url):
        # Never run this against anything but a local database: it writes.
        return None
    db = Prisma(datasource={"url": url})
    try:
        await db.connect()
    except Exception:
        return None
    return db


async def _seed(db, *, armed: int, missed_days: int) -> int:
    """A throwaway user with `armed` armed freezes and a gap of `missed_days`."""
    user = await db.user.create(data={
        "email": f"mercy-race-{datetime.now(timezone.utc).timestamp()}@example.test",
        "username": f"mercyrace{int(datetime.now(timezone.utc).timestamp() * 1000)}",
        "oauthProvider": "email",
        "srsCurrentStreak": 40,
        "srsLastSessionDate": datetime.combine(
            date.today() - timedelta(days=missed_days + 1), datetime.min.time(),
            tzinfo=timezone.utc,
        ),
    })
    for _ in range(armed):
        await db.userstreakfreeze.create(data={
            "userId": user.id,
            "acquiredVia": "debug_grant",
            "equippedAt": datetime.now(timezone.utc),
        })
    return user.id


async def _cleanup(db, user_id: int) -> None:
    await db.userstreakfreeze.delete_many(where={"userId": user_id})
    await db.user.delete(where={"id": user_id})


async def test_concurrent_mercy_spends_exactly_what_is_owed():
    db = await _connect()
    if db is None:
        pytest.skip("no local database — this test writes and needs real concurrency")

    user_id = await _seed(db, armed=3, missed_days=1)
    try:
        # Ten at once. The old code spent 2 of 3 with only five.
        await asyncio.gather(*[
            auto_apply_mercy(db, user_id=user_id) for _ in range(10)
        ])

        spent = await db.userstreakfreeze.count(
            where={"userId": user_id, "consumedAt": {"not": None}}
        )
        assert spent == 1, f"{spent} freezes spent for one missed day"

        held = await db.userstreakfreeze.count(
            where={"userId": user_id, "consumedAt": None}
        )
        assert held == 2
    finally:
        await _cleanup(db, user_id)
        await db.disconnect()


async def test_concurrent_mercy_rolls_the_anchor_exactly_once():
    db = await _connect()
    if db is None:
        pytest.skip("no local database — this test writes and needs real concurrency")

    user_id = await _seed(db, armed=3, missed_days=1)
    try:
        before = await db.user.find_unique(where={"id": user_id})
        start = before.srsLastSessionDate.date()

        await asyncio.gather(*[
            auto_apply_mercy(db, user_id=user_id) for _ in range(10)
        ])

        after = await db.user.find_unique(where={"id": user_id})
        # Exactly one day, however many callers ran. Rolling twice would make
        # the server believe the user practised on a day they did not.
        assert (after.srsLastSessionDate.date() - start).days == 1
    finally:
        await _cleanup(db, user_id)
        await db.disconnect()


async def test_a_gap_too_big_to_cover_spends_nothing_under_concurrency():
    db = await _connect()
    if db is None:
        pytest.skip("no local database — this test writes and needs real concurrency")

    # Five days missed, two armed: cannot be covered, so nothing may be spent
    # — and concurrency must not turn "spend nothing" into "spend some".
    user_id = await _seed(db, armed=2, missed_days=5)
    try:
        await asyncio.gather(*[
            auto_apply_mercy(db, user_id=user_id) for _ in range(10)
        ])
        spent = await db.userstreakfreeze.count(
            where={"userId": user_id, "consumedAt": {"not": None}}
        )
        assert spent == 0
    finally:
        await _cleanup(db, user_id)
        await db.disconnect()
