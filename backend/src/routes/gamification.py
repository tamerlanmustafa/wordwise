"""
Gamification endpoints: achievements, milestones, progress tracking.

Achievements are checked server-side after key events (word save,
review completion, streak update). The client polls /achievements/me
to display the badge screen.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from prisma import Prisma

from ..database import get_db
from ..middleware.auth import get_current_active_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/achievements", tags=["gamification"])


class AchievementDef(BaseModel):
    key: str
    title: str
    description: Optional[str]
    icon: Optional[str]
    category: str
    threshold: int


class UserAchievement(BaseModel):
    key: str
    title: str
    description: Optional[str]
    icon: Optional[str]
    category: str
    threshold: int
    progress: int
    unlocked: bool
    unlocked_at: Optional[str] = None


class AchievementsResponse(BaseModel):
    achievements: list[UserAchievement]
    total_unlocked: int
    total_available: int


class NewlyUnlocked(BaseModel):
    key: str
    title: str
    icon: Optional[str]


@router.get("/me", response_model=AchievementsResponse)
async def my_achievements(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    # Same memoized reference data `check_and_unlock` uses. Ordering moves to
    # Python because 18 static rows do not need a round trip to be sorted, and
    # the badge screen calls /check and /me back to back.
    defs_by_key = await _load_achievement_defs(db)
    all_defs = sorted(
        defs_by_key.values(), key=lambda d: (d["category"] or "", d["threshold"] or 0)
    )
    user_progress = await db.query_raw(
        "SELECT achievement_key, progress, unlocked, unlocked_at FROM user_achievements WHERE user_id = $1",
        current_user.id,
    )
    progress_map = {r["achievement_key"]: r for r in user_progress}

    achievements = []
    unlocked_count = 0
    for d in all_defs:
        p = progress_map.get(d["key"], {})
        unlocked = p.get("unlocked", False)
        if unlocked:
            unlocked_count += 1
        achievements.append(UserAchievement(
            key=d["key"],
            title=d["title"],
            description=d["description"],
            icon=d["icon"],
            category=d["category"],
            threshold=d["threshold"],
            progress=p.get("progress", 0),
            unlocked=unlocked,
            unlocked_at=str(p["unlocked_at"]) if p.get("unlocked_at") else None,
        ))

    return AchievementsResponse(
        achievements=achievements,
        total_unlocked=unlocked_count,
        total_available=len(all_defs),
    )


#: Achievement definitions are static reference data — 18 rows that only change
#: when someone ships a migration — so they are read once per process rather
#: than once per key per call (issue #135). `reset_achievement_defs_cache()`
#: exists for tests and for a future admin-side edit; nothing in a request path
#: invalidates it.
_DEFS_CACHE: Optional[dict[str, dict]] = None

_DEFS_SQL = (
    "SELECT key, title, description, icon, category, threshold FROM achievements"
)


def reset_achievement_defs_cache() -> None:
    """Drop the memoized achievement definitions (tests, admin edits)."""
    global _DEFS_CACHE
    _DEFS_CACHE = None


async def _load_achievement_defs(db: Prisma) -> dict[str, dict]:
    global _DEFS_CACHE
    if _DEFS_CACHE is None:
        rows = await db.query_raw(_DEFS_SQL)
        _DEFS_CACHE = {r["key"]: dict(r) for r in rows}
    return _DEFS_CACHE


#: One statement for the whole check. JSONB_TO_RECORDSET turns the payload into
#: rows so ~18 upserts travel as a single round trip, same shape as the lemma
#: backfill (#145). The DO UPDATE deliberately never clears an existing unlock:
#: progress can go down (a word is deleted), an earned badge cannot.
_UPSERT_SQL = """
    INSERT INTO user_achievements (user_id, achievement_key, progress, unlocked, unlocked_at)
    SELECT $1, r.key, r.progress, r.unlocked,
           CASE WHEN r.unlocked THEN $3::timestamptz ELSE NULL END
    FROM JSONB_TO_RECORDSET($2::jsonb) AS r(key text, progress int, unlocked boolean)
    ON CONFLICT (user_id, achievement_key)
    DO UPDATE SET progress = EXCLUDED.progress,
                  unlocked = user_achievements.unlocked OR EXCLUDED.unlocked,
                  unlocked_at = CASE
                      WHEN user_achievements.unlocked THEN user_achievements.unlocked_at
                      ELSE EXCLUDED.unlocked_at
                  END
"""


def _plan_unlocks(
    defs: dict[str, dict],
    already_unlocked: set[str],
    checks: dict[str, int],
) -> tuple[list[dict], list[NewlyUnlocked]]:
    """Split the requested progress values into (rows to write, newly unlocked).

    "Newly" is decided against the state read a moment ago, not against how
    recently `unlocked_at` was stamped. The old code re-read each row after
    writing it and called it new if the timestamp was within two seconds of
    now, which reported the same badge twice whenever two checks overlapped.
    """
    rows: list[dict] = []
    newly: list[NewlyUnlocked] = []

    for key, progress in checks.items():
        d = defs.get(key)
        if d is None:
            continue
        unlocked = progress >= d["threshold"]
        rows.append({"key": key, "progress": progress, "unlocked": unlocked})
        if unlocked and key not in already_unlocked:
            newly.append(NewlyUnlocked(key=key, title=d["title"], icon=d["icon"]))

    return rows, newly


async def check_and_unlock(
    db: Prisma, user_id: int, checks: dict[str, int]
) -> list[NewlyUnlocked]:
    """
    Check multiple achievement keys against new progress values.
    Call this after events (word save, review, streak update).
    Returns list of newly unlocked achievements.

    Two round trips (three on the first call in a process): read what the user
    has already unlocked, then write every key in one statement. It used to be
    a SELECT + an INSERT + a re-read SELECT *per key* — up to 54 serialized
    round trips for the 18 keys `/achievements/check` sends.
    """
    defs = await _load_achievement_defs(db)

    keys = [k for k in checks if k in defs]
    if not keys:
        return []

    existing = await db.query_raw(
        "SELECT achievement_key FROM user_achievements "
        "WHERE user_id = $1 AND unlocked AND achievement_key = ANY($2::text[])",
        user_id, keys,
    )
    already_unlocked = {r["achievement_key"] for r in existing}

    rows, newly = _plan_unlocks(defs, already_unlocked, checks)
    if rows:
        await db.execute_raw(
            _UPSERT_SQL, user_id, json.dumps(rows), datetime.now(timezone.utc)
        )

    return newly


@router.post("/check", response_model=list[NewlyUnlocked])
async def trigger_check(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """
    Manually trigger an achievement check for the current user.
    Computes progress from actual data.
    """
    total_saved = await db.userword.count(where={"userId": current_user.id})
    total_reviews = getattr(current_user, "srsTotalReviews", 0) or 0
    total_correct = getattr(current_user, "srsTotalCorrect", 0) or 0
    current_streak = getattr(current_user, "srsCurrentStreak", 0) or 0
    longest_streak = getattr(current_user, "srsLongestStreak", 0) or 0

    distinct_movies = await db.query_raw(
        "SELECT COUNT(DISTINCT movie_id) as cnt FROM user_words WHERE user_id = $1 AND movie_id IS NOT NULL",
        current_user.id,
    )
    movie_count = distinct_movies[0]["cnt"] if distinct_movies else 0

    mastered = await db.userword.count(
        where={"userId": current_user.id, "srsBox": 5}
    )

    retention_pct = round((total_correct / total_reviews) * 100) if total_reviews > 0 else 0

    checks = {
        "first_save": total_saved,
        "word_collector_10": total_saved,
        "word_collector_50": total_saved,
        "word_collector_100": total_saved,
        "word_collector_500": total_saved,
        "first_review": total_reviews,
        "review_10": total_reviews,
        "review_50": total_reviews,
        "streak_3": longest_streak,
        "streak_7": longest_streak,
        "streak_30": longest_streak,
        "streak_100": longest_streak,
        "movies_5": movie_count,
        "movies_20": movie_count,
        "mastered_10": mastered,
        "mastered_50": mastered,
        "retention_90": 1 if retention_pct >= 90 and total_reviews >= 20 else 0,
    }

    return await check_and_unlock(db, current_user.id, checks)
