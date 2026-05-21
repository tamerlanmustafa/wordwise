"""
v0.6 streak mercy infrastructure.

Two layers:
  • Pure helpers (no DB): the decisions about when to grant a weekly
    freeze, how many missed-day freezes to consume, and whether to offer
    a repair window. Easily unit-tested.
  • Async DB-touching wrappers: read the user's freeze inventory, apply
    the decisions, and update `users` + `user_streak_freezes` atomically.

Free users: 1 freeze auto-granted on the first /daily/state read each
ISO week (Sunday rollover, UTC), capped at MAX_FREEZES_HELD held. Premium
users get the same baseline plus a higher cadence in a future iteration.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Optional

from prisma import Prisma

# Cap on simultaneously-held freezes. Goes well past the "one freeze per
# week" baseline to allow IAP top-ups, but small enough that we don't
# accumulate a hoard that defeats the mercy intent.
MAX_FREEZES_HELD: int = 5


# ── Pure helpers ────────────────────────────────────────────────────────────

def should_auto_grant_weekly(
    today: date,
    held_count: int,
    last_weekly_grant: Optional[date],
    *,
    max_held: int = MAX_FREEZES_HELD,
) -> bool:
    """Decide whether to grant a free weekly freeze right now.

    Rule: the first /daily/state read each ISO calendar week earns one
    freeze, unless the user already holds the cap. Idempotent for repeat
    reads in the same week (last_weekly_grant carries the marker).
    """
    if held_count >= max_held:
        return False
    if last_weekly_grant is None:
        return True
    return today.isocalendar()[:2] != last_weekly_grant.isocalendar()[:2]


def freezes_to_consume_for_gap(
    today: date,
    last_session_date: Optional[date],
    held_count: int,
) -> int:
    """How many freezes the auto-consume should burn right now.

    A freeze covers exactly one missed UTC day. With `(today - last) = k`,
    the user has missed `k - 1` days (no missed days when k <= 1). Burn
    up to `held_count` of those to bridge the gap.
    """
    if last_session_date is None or held_count <= 0:
        return 0
    delta = (today - last_session_date).days
    missed_days = max(0, delta - 1)
    return min(missed_days, held_count)


def repair_window_active(
    today: date,
    last_session_date: Optional[date],
    held_count: int,
) -> bool:
    """True iff the user is in the narrow repair window.

    Eligible: missed exactly one day, held no freezes when that day
    rolled over (so auto-consume couldn't save them). The frontend uses
    this to offer the "save your streak" modal.
    """
    if last_session_date is None or held_count > 0:
        return False
    return (today - last_session_date).days == 2


# ── DB-touching wrappers ────────────────────────────────────────────────────

async def count_held_freezes(db: Prisma, user_id: int) -> int:
    return await db.userstreakfreeze.count(
        where={"userId": user_id, "consumedAt": None}
    )


async def find_last_weekly_grant(db: Prisma, user_id: int) -> Optional[date]:
    """Most-recent auto_weekly grant date for this user, or None."""
    row = await db.userstreakfreeze.find_first(
        where={"userId": user_id, "acquiredVia": "auto_weekly"},
        order={"acquiredAt": "desc"},
    )
    return row.acquiredAt.date() if row else None


async def grant_freeze(
    db: Prisma,
    *,
    user_id: int,
    via: str,
    now: Optional[datetime] = None,
) -> None:
    """Credit one freeze to the user. Caller is responsible for cap checks."""
    when = now if now is not None else datetime.now(timezone.utc)
    await db.userstreakfreeze.create(data={
        "userId": user_id,
        "acquiredAt": when,
        "acquiredVia": via,
    })


async def consume_freeze(
    db: Prisma,
    *,
    user_id: int,
    reason: str,
    now: Optional[datetime] = None,
) -> bool:
    """Consume the oldest-held freeze. Returns True on success, False
    when the user has none to consume."""
    held = await db.userstreakfreeze.find_first(
        where={"userId": user_id, "consumedAt": None},
        order={"acquiredAt": "asc"},
    )
    if held is None:
        return False
    when = now if now is not None else datetime.now(timezone.utc)
    await db.userstreakfreeze.update(
        where={"id": held.id},
        data={"consumedAt": when, "consumedReason": reason},
    )
    return True


async def auto_apply_mercy(
    db: Prisma,
    *,
    user_id: int,
    now: Optional[datetime] = None,
) -> dict:
    """Run the lazy mercy pass at the top of /daily/state.

    1. Grant a weekly freeze if eligible.
    2. Auto-consume held freezes to cover any missed UTC days, updating
       `srsLastSessionDate` to roll forward by one day per freeze burned.

    Returns a snapshot the caller can serialize into /daily/state's
    response: `{ freezes_held, last_session_date, repair_window_active,
    auto_granted, auto_consumed }`.
    """
    when = now if now is not None else datetime.now(timezone.utc)
    today = when.date()

    held = await count_held_freezes(db, user_id)
    last_weekly = await find_last_weekly_grant(db, user_id)
    auto_granted = False
    if should_auto_grant_weekly(today, held, last_weekly):
        await grant_freeze(db, user_id=user_id, via="auto_weekly", now=when)
        held += 1
        auto_granted = True

    user = await db.user.find_unique(where={"id": user_id})
    if user is None:
        return {
            "freezes_held": held,
            "last_session_date": None,
            "repair_window_active": False,
            "auto_granted": auto_granted,
            "auto_consumed": 0,
        }

    last_date = user.srsLastSessionDate
    burn = freezes_to_consume_for_gap(today, last_date, held)
    consumed = 0
    for _ in range(burn):
        ok = await consume_freeze(
            db, user_id=user_id, reason="auto_consume_missed_day", now=when
        )
        if not ok:
            break
        # Roll the last-session-date forward by one to simulate "user
        # was active yesterday-ish." Keeps streak math monotonic.
        last_date = (last_date or today) + timedelta(days=1)
        consumed += 1
    if consumed > 0:
        await db.user.update(
            where={"id": user_id},
            data={"srsLastSessionDate": last_date},
        )
        held -= consumed

    return {
        "freezes_held": held,
        "last_session_date": last_date,
        "repair_window_active": repair_window_active(today, last_date, held),
        "auto_granted": auto_granted,
        "auto_consumed": consumed,
    }
