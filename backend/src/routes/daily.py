"""
v0.6 daily-habit state endpoint.

`GET /daily/state` is the one-stop hydration call the mobile app makes on
cold start (and on app-foreground) to learn:
  • whether today's SRS review is already done
  • the current streak + longest streak
  • how many freezes are held
  • whether the repair window is active (missed yesterday, no freezes)

Side effects on read (lazy mercy pass — no cron required):
  • The weekly freeze grant MOVED to POST /srs/session/complete — mercy
    is earned by practising, not by opening the app. The cap is
    MAX_FREEZES_HELD (5), not the 2 this line claimed for months.
  • Auto-consume held freezes for each missed UTC day, rolling
    `srsLastSessionDate` forward so the streak math stays monotonic

The user's existing `srsCurrentStreak` / `srsLastSessionDate` columns are
the source of truth. We don't introduce a separate "today done" field —
it's derived: `last_session_date == today_utc`.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from prisma import Prisma
from pydantic import BaseModel

from ..database import get_db
from ..middleware.auth import get_current_active_user
from ..services.milestone_service import parse_unlocked
from ..services.streak_service import (
    MAX_FREEZES_HELD,
    auto_apply_mercy,
    autoarm_freezes_once,
    build_week,
    count_equipped_freezes,
    count_held_freezes,
    equip_freeze,
    max_equipped_for,
    max_held_for,
    unequip_freeze,
)
from ..utils.dates import as_date, local_today

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/daily", tags=["daily"])


class WeekDay(BaseModel):
    """One square in the Practice header's week strip."""

    date: str  # YYYY-MM-DD, in the user's own calendar
    #: done | frozen | missed | future. `frozen` is kept distinct from `done`
    #: on purpose: a covered day drawn as a gap reports the freeze as having
    #: failed, which is the opposite of what happened.
    state: str
    is_today: bool


class DailyStateResponse(BaseModel):
    today_done: bool
    streak: int
    longest_streak: int
    freezes_held: int
    # How many of those are ARMED. Held-but-unarmed freezes are inventory; only
    # an armed one is ever spent to cover a missed day, which is what makes the
    # spend the user's decision rather than the app's. Defaulted so a client
    # that predates the field keeps parsing.
    freezes_equipped: int = 0
    last_session_date: str | None  # YYYY-MM-DD or null
    repair_window_active: bool
    # Side-effect from this read: how many armed freezes were just spent to
    # cover missed days. The client shows it — a freeze consumed invisibly is
    # the complaint this whole model exists to answer.
    #
    # `auto_granted_weekly` is retained and now always False: the weekly grant
    # moved to session completion, so it is earned by practising rather than by
    # opening the app. Kept in the shape so installed clients keep parsing.
    auto_granted_weekly: bool
    auto_consumed: int
    # v0.6 W10: full inventory of cinema-named milestone slugs. Client
    # diffs against an AsyncStorage last-seen list to fire the unlock
    # modal for newly-added entries.
    unlocked_cosmetics: list[str]
    # v0.7.2: which Practice-tab tile the user picked today (or null
    # when they haven't started today's session yet). The streak chip /
    # tile-state derivation reads this so the right tile renders as
    # "done today".
    last_session_kind: str | None = None
    #: The user's current Monday–Sunday. Defaulted to empty so a client that
    #: predates the strip keeps parsing this response unchanged.
    week: list[WeekDay] = []
    #: This account's caps, so the client stops hardcoding them.
    #:
    #: They are tier-dependent now, and a number the phone believes but the
    #: server does not is the one bug this whole surface cannot tolerate: a
    #: client drawing two slots for a one-slot account offers a control that is
    #: refused every time it is tapped. Defaulted to the free values so a client
    #: that predates the fields understates rather than overstates.
    max_freezes_equipped: int = 1
    max_freezes_held: int = 2
    #: Freezes armed by the ONE-TIME backfill on this request. Non-zero exactly
    #: once per account, ever. The client toasts it: freezes that silently
    #: became inert and then silently came back are two invisible events, and
    #: the user is owed the second one.
    auto_armed: int = 0


@router.get("/state", response_model=DailyStateResponse)
async def daily_state(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """Hydrate the v0.6 daily-habit UI in one call.

    Runs `auto_apply_mercy` first (grants a weekly freeze if eligible,
    burns held freezes to cover missed days) and then reads the resulting
    User state for the response. Idempotent for repeat calls on the same
    local day.

    "Today" is the caller's own calendar day — see `utils/dates.local_today`.
    It used to be the server's UTC day, which meant a user at UTC+13 asking
    this at 10am local was answered about yesterday.
    """
    now = datetime.now(timezone.utc)
    today = local_today(current_user, now=now)

    # One time per account, before mercy runs.
    #
    # Order is the whole point. A user whose freezes were left inert by the
    # arming migration, who then missed yesterday, is opening the app right now
    # BECAUSE of that gap. Arming first lets the freezes they already earned
    # cover it; arming after mercy would recover them one request too late, on
    # the far side of the broken streak they came back to save.
    auto_armed = await autoarm_freezes_once(db, user=current_user)

    mercy = await auto_apply_mercy(db, user_id=current_user.id, now=now)

    # Re-fetch the user post-mercy so streak/longest reflect any changes
    # made by auto-consume (which rolls srsLastSessionDate forward).
    user = await db.user.find_unique(where={"id": current_user.id})
    # Normalised, because `srsLastSessionDate` is `@db.Date` and prisma hands
    # those back as `datetime`. Comparing one to `today` below is False on the
    # exact day it should be True, so `today_done` was False for a user who
    # had finished a lesson an hour earlier — and it is the flag the daily-habit
    # UI reads to decide whether today is already satisfied. See utils/dates.
    last_date = as_date(user.srsLastSessionDate) if user else None
    streak = (user.srsCurrentStreak or 0) if user else 0
    longest = (user.srsLongestStreak or 0) if user else 0

    # v0.7.2 — the `last_session_kind` column persists across UTC days
    # since we don't actively clear it on rollover. Treat it as the
    # "today's pick" only when the user actually started a session today.
    last_kind: str | None = None
    if user is not None:
        started = getattr(user, "srsLastSessionStartedAt", None)
        if started is not None and local_today(current_user, now=started) == today:
            last_kind = getattr(user, "srsLastSessionKind", None)

    return DailyStateResponse(
        today_done=last_date == today,
        streak=streak,
        longest_streak=longest,
        freezes_held=mercy["freezes_held"],
        freezes_equipped=mercy["freezes_equipped"],
        last_session_date=last_date.isoformat() if last_date else None,
        repair_window_active=mercy["repair_window_active"],
        auto_granted_weekly=mercy["auto_granted"],
        auto_consumed=mercy["auto_consumed"],
        unlocked_cosmetics=parse_unlocked(user.unlockedCosmetics) if user else [],
        last_session_kind=last_kind,
        week=[WeekDay(**d) for d in await build_week(db, user_id=current_user.id, today=today)],
        max_freezes_equipped=max_equipped_for(current_user),
        max_freezes_held=max_held_for(current_user),
        auto_armed=auto_armed,
    )


class FreezeStateResponse(BaseModel):
    """What the user holds and what is armed, after an equip/unequip."""

    freezes_held: int
    freezes_equipped: int
    #: False when there was nothing to arm (or nothing armed to disarm). Not an
    #: error: tapping "equip" with an empty inventory is a reasonable thing to
    #: do and the honest answer is "nothing changed", not a 400 the UI has to
    #: translate into a message.
    changed: bool
    #: Echoed on every mutation, not just on /state. A tier can change between
    #: the two calls — a subscription starting is exactly the moment someone
    #: opens this sheet — and the response that changes the counts is the
    #: cheapest place to correct the number of slots drawn beside them.
    max_freezes_equipped: int = 1
    max_freezes_held: int = 2


@router.post("/freeze/equip", response_model=FreezeStateResponse)
async def equip_a_freeze(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """Arm one held freeze, so it can cover a missed day.

    The arming IS the decision. A freeze can only be spent while the user is
    not in the app — that is what a missed day means — so the choice has to be
    made in advance. Before this, every held freeze was implicitly armed and
    the app spent them without asking or reporting.
    """
    changed = await equip_freeze(
        db, user_id=current_user.id, max_equipped=max_equipped_for(current_user)
    )
    return FreezeStateResponse(
        freezes_held=await count_held_freezes(db, current_user.id),
        freezes_equipped=await count_equipped_freezes(db, current_user.id),
        changed=changed,
        max_freezes_equipped=max_equipped_for(current_user),
        max_freezes_held=max_held_for(current_user),
    )


@router.post("/freeze/unequip", response_model=FreezeStateResponse)
async def unequip_a_freeze(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """Disarm the most recently armed freeze. It stays in the inventory."""
    changed = await unequip_freeze(db, user_id=current_user.id)
    return FreezeStateResponse(
        freezes_held=await count_held_freezes(db, current_user.id),
        freezes_equipped=await count_equipped_freezes(db, current_user.id),
        changed=changed,
        max_freezes_equipped=max_equipped_for(current_user),
        max_freezes_held=max_held_for(current_user),
    )
