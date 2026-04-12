"""
Gamification endpoints: achievements, milestones, progress tracking.

Achievements are checked server-side after key events (word save,
review completion, streak update). The client polls /achievements/me
to display the badge screen.
"""

from __future__ import annotations

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


@router.get("/catalog", response_model=list[AchievementDef])
async def list_achievements(db: Prisma = Depends(get_db)):
    rows = await db.query_raw(
        "SELECT key, title, description, icon, category, threshold FROM achievements ORDER BY category, threshold"
    )
    return [AchievementDef(**r) for r in rows]


@router.get("/me", response_model=AchievementsResponse)
async def my_achievements(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    all_defs = await db.query_raw(
        "SELECT key, title, description, icon, category, threshold FROM achievements ORDER BY category, threshold"
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


async def check_and_unlock(
    db: Prisma, user_id: int, checks: dict[str, int]
) -> list[NewlyUnlocked]:
    """
    Check multiple achievement keys against new progress values.
    Call this after events (word save, review, streak update).
    Returns list of newly unlocked achievements.
    """
    newly = []
    for key, progress in checks.items():
        defs = await db.query_raw(
            "SELECT title, icon, threshold FROM achievements WHERE key = $1", key
        )
        if not defs:
            continue
        d = defs[0]
        now = datetime.now(timezone.utc)
        unlocked = progress >= d["threshold"]

        await db.execute_raw(
            """INSERT INTO user_achievements (user_id, achievement_key, progress, unlocked, unlocked_at)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (user_id, achievement_key)
               DO UPDATE SET progress = $3, unlocked = CASE WHEN user_achievements.unlocked THEN true ELSE $4 END,
                             unlocked_at = CASE WHEN user_achievements.unlocked THEN user_achievements.unlocked_at ELSE $5 END""",
            user_id, key, progress, unlocked, now if unlocked else None,
        )

        if unlocked:
            was = await db.query_raw(
                "SELECT unlocked, unlocked_at FROM user_achievements WHERE user_id = $1 AND achievement_key = $2",
                user_id, key,
            )
            if was and was[0].get("unlocked"):
                prev_at = was[0].get("unlocked_at")
                if prev_at and abs((now - prev_at).total_seconds()) < 2:
                    newly.append(NewlyUnlocked(key=key, title=d["title"], icon=d["icon"]))

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
