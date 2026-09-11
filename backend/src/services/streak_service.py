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

from ..utils.dates import as_date, local_today, utc_midnight

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
    """How many armed freezes to burn right now — all of them, or none.

    A freeze covers exactly one missed day. With `(today - last) = k` the user
    has missed `k - 1` days (none when k <= 1).

    ## All or nothing, and why that is the whole fix

    This used to return `min(missed_days, held_count)` — "burn what we have",
    asserted on purpose by a test of that name. It is wrong in the one case
    that matters, because a freeze that does not bridge the *entire* gap saves
    nothing: `compute_new_streak` resets on any remaining gap of two or more
    days, so the partial burn buys a shorter gap and an identical outcome.
    Simulated against these functions before the change:

        gap  held  burned  streak after
         3     2      2      kept
         3     1      1      LOST      <- freeze spent for nothing
         5     2      2      LOST      <- two spent for nothing
        10     8      8      LOST      <- eight spent for nothing

    A user who was away ten days came back to no freezes and a streak of 1.
    Doing nothing would have left them the freezes. So: spend only when the
    spend achieves the thing the resource exists for, and otherwise spend
    nothing and let the streak break honestly.

    `held_count` is the count of **armed** freezes (see `count_equipped_freezes`).
    Held-but-unarmed ones are inventory, not insurance, and are never spent.
    """
    if last_session_date is None or held_count <= 0:
        return 0
    delta = (today - last_session_date).days
    missed_days = max(0, delta - 1)
    if missed_days == 0:
        return 0
    # The whole gap, or nothing at all.
    if missed_days > held_count:
        return 0
    return missed_days


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
    """Everything in the inventory, armed or not — what the UI counts."""
    return await db.userstreakfreeze.count(
        where={"userId": user_id, "consumedAt": None}
    )


async def count_equipped_freezes(db: Prisma, user_id: int) -> int:
    """What is actually standing between the user and a broken streak.

    Held-but-unarmed freezes are inventory; only an armed one is ever spent.
    That distinction is the whole of "the user decides": the decision is made
    in advance, when they arm it, rather than by the app on a day they are not
    even in the app to see.
    """
    return await db.userstreakfreeze.count(
        where={"userId": user_id, "consumedAt": None, "equippedAt": {"not": None}}
    )


async def equip_freeze(db: Prisma, *, user_id: int, now: Optional[datetime] = None) -> bool:
    """Arm the oldest unarmed freeze. False when there is nothing to arm.

    Oldest-first for the same reason `consume_freeze` is: freezes are
    fungible, and spending the one that has been sitting longest keeps the
    inventory from developing a permanently-stuck tail.
    """
    spare = await db.userstreakfreeze.find_first(
        where={"userId": user_id, "consumedAt": None, "equippedAt": None},
        order={"acquiredAt": "asc"},
    )
    if spare is None:
        return False
    when = now if now is not None else datetime.now(timezone.utc)
    await db.userstreakfreeze.update(
        where={"id": spare.id}, data={"equippedAt": when}
    )
    return True


async def unequip_freeze(db: Prisma, *, user_id: int) -> bool:
    """Disarm the most recently armed freeze. False when none is armed.

    Newest-first, the mirror of `equip_freeze`: disarming should undo the most
    recent arming rather than reach past it.
    """
    armed = await db.userstreakfreeze.find_first(
        where={"userId": user_id, "consumedAt": None, "equippedAt": {"not": None}},
        order={"equippedAt": "desc"},
    )
    if armed is None:
        return False
    await db.userstreakfreeze.update(
        where={"id": armed.id}, data={"equippedAt": None}
    )
    return True


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
    covered_date: Optional[date] = None,
) -> bool:
    """Consume the oldest ARMED freeze. False when none is armed.

    Armed only. An unarmed freeze is inventory the user has not chosen to put
    at risk, and spending it is precisely the thing this model exists to stop.
    """
    held = await db.userstreakfreeze.find_first(
        where={"userId": user_id, "consumedAt": None, "equippedAt": {"not": None}},
        order={"acquiredAt": "asc"},
    )
    if held is None:
        return False
    when = now if now is not None else datetime.now(timezone.utc)
    data: dict = {"consumedAt": when, "consumedReason": reason}
    if covered_date is not None:
        # `utc_midnight`, not the bare date — `@db.Date` and prisma-client-py
        # 0.11 has no encoder for `datetime.date`. Same trap as the rolled
        # session date above it.
        data["coveredDate"] = utc_midnight(covered_date)
    await db.userstreakfreeze.update(where={"id": held.id}, data=data)
    return True


async def auto_apply_mercy(
    db: Prisma,
    *,
    user_id: int,
    now: Optional[datetime] = None,
) -> dict:
    """Spend armed freezes to cover a gap, if they can cover all of it.

    Run lazily from `GET /daily/state`, because the user is by definition not
    in the app on the day they miss — something has to notice on their return.
    What changed is *what* it is allowed to notice:

      * only **armed** freezes are ever spent (see `count_equipped_freezes`);
        held-but-unarmed ones are inventory the user never put at risk;
      * they are spent **only if they cover the whole gap**. A partial burn
        bought a shorter gap and an identical broken streak — see
        `freezes_to_consume_for_gap`;
      * the **weekly grant no longer happens here**. It moved to
        `POST /srs/session/complete`, so mercy is earned by practising rather
        than by opening the app, and this read stops writing on a path the user
        did not ask for anything on.

    Returns the snapshot `/daily/state` serialises:
    `{ freezes_held, freezes_equipped, last_session_date, repair_window_active,
    auto_granted, auto_consumed }`. `auto_granted` is retained and always
    False so the response shape does not change under installed clients.
    """
    when = now if now is not None else datetime.now(timezone.utc)

    # The user is fetched FIRST so every date below is the user's own calendar
    # day. It used to be `when.date()` — the server's UTC day — which decided
    # how many days the gap arithmetic thought had been missed. See
    # utils/dates.local_today.
    user = await db.user.find_unique(where={"id": user_id})
    today = local_today(user, now=when) if user is not None else when.date()

    held = await count_held_freezes(db, user_id)
    equipped = await count_equipped_freezes(db, user_id)

    if user is None:
        return {
            "freezes_held": held,
            "freezes_equipped": equipped,
            "last_session_date": None,
            "repair_window_active": False,
            "auto_granted": False,
            "auto_consumed": 0,
        }

    # Prisma Python surfaces `@db.Date` as a `datetime`, but the gap
    # math below subtracts `today: date - last_date`. Normalize to
    # `date` at the boundary so the operands match.
    last_date_raw = user.srsLastSessionDate
    last_date: Optional[date] = (
        last_date_raw.date() if isinstance(last_date_raw, datetime) else last_date_raw
    )
    # Armed count, not held: an unarmed freeze cannot save anything, so
    # including it here would decide to burn freezes that do not exist for
    # this purpose and then fail to find them.
    burn = freezes_to_consume_for_gap(today, last_date, equipped)
    consumed = 0
    for _ in range(burn):
        # The day this particular freeze pays for: the one right after the
        # last day the user was active, which the loop then rolls forward. It
        # is recorded rather than inferred because `consumedAt` is when the
        # mercy pass *noticed* — a Tuesday covered by a freeze spent on
        # Thursday — and the week strip has to tell a frozen day from a missed
        # one.
        covers = (last_date or today) + timedelta(days=1)
        ok = await consume_freeze(
            db,
            user_id=user_id,
            reason="equipped_covered_missed_day",
            now=when,
            covered_date=covers,
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
            # `utc_midnight`, not the bare date. `srsLastSessionDate` is
            # `@db.Date`, and prisma-client-py 0.11 serialises query arguments
            # itself with no encoder for `datetime.date` — it raises
            # `TypeError: Type <class 'datetime.date'> not serializable`.
            #
            # This has always been wrong here, and it fails in the worst
            # possible order: the freeze rows are already updated by the loop
            # above, so the spend COMMITS and then the request 500s before the
            # date is rolled — the user loses the freeze and the streak breaks
            # anyway, which is precisely what the freeze was spent to prevent.
            # It stayed hidden because it only fires on the days a freeze is
            # actually consumed. Same defect, same column family, as the chest
            # date that meant the daily chest had never once been handed out —
            # see utils/dates.
            data={"srsLastSessionDate": utc_midnight(last_date)},
        )
        held -= consumed
        equipped -= consumed

    return {
        "freezes_held": held,
        "freezes_equipped": equipped,
        "last_session_date": last_date,
        "repair_window_active": repair_window_active(today, last_date, equipped),
        # Retained, always False: the grant moved to session completion. Kept
        # in the shape so an installed client reading it keeps parsing.
        "auto_granted": False,
        "auto_consumed": consumed,
    }


async def grant_weekly_if_due(
    db: Prisma,
    *,
    user_id: int,
    today: date,
    now: Optional[datetime] = None,
) -> bool:
    """Earn the weekly freeze by practising. Called from session completion.

    It used to live inside `GET /daily/state`, which made freezes accrue by
    *opening the app* — and, because the grant keyed on the ISO week of a read,
    opening on a Sunday and again on the Monday paid two freezes in two days
    for no practice at all. Mercy for a habit should be earned by the habit.
    """
    held = await count_held_freezes(db, user_id)
    last_weekly = await find_last_weekly_grant(db, user_id)
    if not should_auto_grant_weekly(today, held, last_weekly):
        return False
    await grant_freeze(db, user_id=user_id, via="auto_weekly", now=now)
    return True


# ── The week strip ──────────────────────────────────────────────────────────

#: What a single day in the strip can be. `done` and `frozen` both keep the
#: streak alive; the distinction matters because a frozen day drawn as a gap
#: reports the freeze as having failed, which is the opposite of what happened.
WEEK_DAY_STATES = ("done", "frozen", "missed", "future")


def week_bounds(today: date) -> tuple[date, date]:
    """The user's current Monday–Sunday, in their own calendar.

    Monday-first because `date.weekday()` is, and because the alternative is a
    per-locale first-day-of-week rule that the strip does not need: what the
    user reads off it is "how did this week go", and any seven consecutive days
    ending at or after today answers that. Worth revisiting only if the copy
    ever names the days.
    """
    monday = today - timedelta(days=today.weekday())
    return monday, monday + timedelta(days=6)


async def build_week(
    db: Prisma,
    *,
    user_id: int,
    today: date,
) -> list[dict]:
    """Seven days of the user's current week, for the Practice header.

    Two queries, both index-covered, both bounded to seven days:

      * completed `practice_sessions` by `local_date`
        (`ix_practice_sessions_user_day`, partial on `completed_at IS NOT NULL`)
      * spent freezes by `covered_date` (`ix_user_streak_freezes_covered`)

    Deliberately derived rather than stored. A denormalised "week" column would
    be a second copy of the same fact and would need invalidating on every
    completion, every freeze spend and every timezone change; seven rows off
    two indexes is cheaper than the bug that eventually follows from that.

    A day can be both practised and frozen only if something has gone wrong
    upstream — a freeze covering a day the user was active. `done` wins,
    because that is the fact the user experienced.
    """
    start, end = week_bounds(today)

    done_rows = await db.practicesession.find_many(
        where={
            "userId": user_id,
            "completedAt": {"not": None},
            "localDate": {"gte": utc_midnight(start), "lte": utc_midnight(end)},
        },
    )
    done = {as_date(r.localDate) for r in done_rows if r.localDate is not None}

    frozen_rows = await db.userstreakfreeze.find_many(
        where={
            "userId": user_id,
            "coveredDate": {"gte": utc_midnight(start), "lte": utc_midnight(end)},
        },
    )
    frozen = {as_date(r.coveredDate) for r in frozen_rows if r.coveredDate is not None}

    week: list[dict] = []
    for i in range(7):
        day = start + timedelta(days=i)
        if day in done:
            state = "done"
        elif day in frozen:
            state = "frozen"
        elif day > today:
            state = "future"
        else:
            state = "missed"
        week.append({"date": day.isoformat(), "state": state, "is_today": day == today})
    return week
