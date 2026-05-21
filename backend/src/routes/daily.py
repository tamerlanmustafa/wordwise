"""
v0.6 daily-habit state endpoint.

`GET /daily/state` is the one-stop hydration call the mobile app makes on
cold start (and on app-foreground) to learn:
  • whether today's SRS review is already done
  • the current streak + longest streak
  • how many freezes are held
  • whether the repair window is active (missed yesterday, no freezes)

Side effects on read (lazy mercy pass — no cron required):
  • Auto-grant a weekly freeze (Sunday rollover, ISO week, cap 2 held)
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
from ..services.streak_service import auto_apply_mercy

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/daily", tags=["daily"])


class DailyStateResponse(BaseModel):
    today_done: bool
    streak: int
    longest_streak: int
    freezes_held: int
    last_session_date: str | None  # YYYY-MM-DD or null
    repair_window_active: bool
    # Side-effects from this read — frontend can show "🛡️ freeze used"
    # or "🎁 free freeze granted" toasts when nonzero / true.
    auto_granted_weekly: bool
    auto_consumed: int
    # v0.6 W10: full inventory of cinema-named milestone slugs. Client
    # diffs against an AsyncStorage last-seen list to fire the unlock
    # modal for newly-added entries.
    unlocked_cosmetics: list[str]


@router.get("/state", response_model=DailyStateResponse)
async def daily_state(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """Hydrate the v0.6 daily-habit UI in one call.

    Runs `auto_apply_mercy` first (grants a weekly freeze if eligible,
    burns held freezes to cover missed days) and then reads the resulting
    User state for the response. Idempotent for repeat calls in the same
    UTC day.
    """
    now = datetime.now(timezone.utc)
    today = now.date()

    mercy = await auto_apply_mercy(db, user_id=current_user.id, now=now)

    # Re-fetch the user post-mercy so streak/longest reflect any changes
    # made by auto-consume (which rolls srsLastSessionDate forward).
    user = await db.user.find_unique(where={"id": current_user.id})
    last_date = user.srsLastSessionDate if user else None
    streak = (user.srsCurrentStreak or 0) if user else 0
    longest = (user.srsLongestStreak or 0) if user else 0

    return DailyStateResponse(
        today_done=last_date == today,
        streak=streak,
        longest_streak=longest,
        freezes_held=mercy["freezes_held"],
        last_session_date=last_date.isoformat() if last_date else None,
        repair_window_active=mercy["repair_window_active"],
        auto_granted_weekly=mercy["auto_granted"],
        auto_consumed=mercy["auto_consumed"],
        unlocked_cosmetics=parse_unlocked(user.unlockedCosmetics) if user else [],
    )
