"""
Social / leaderboard endpoints.

Weekly and all-time leaderboards based on words learned, streak,
and review count. Privacy-conscious: only username is exposed,
and users can opt out.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from prisma import Prisma

from ..database import get_db
from ..middleware.auth import get_current_active_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/social", tags=["social"])


class LeaderboardEntry(BaseModel):
    rank: int
    username: str
    score: int
    is_you: bool = False


class LeaderboardResponse(BaseModel):
    board: str
    entries: list[LeaderboardEntry]
    your_rank: Optional[int] = None
    your_score: Optional[int] = None


@router.get("/leaderboard/words", response_model=LeaderboardResponse)
async def leaderboard_words(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    rows = await db.query_raw(
        """SELECT u.id, u.username, COUNT(uw.id) as score
           FROM users u
           JOIN user_words uw ON u.id = uw.user_id
           WHERE u.is_active = true
           GROUP BY u.id, u.username
           ORDER BY score DESC
           LIMIT 50"""
    )

    entries = []
    your_rank = None
    your_score = None
    for i, r in enumerate(rows):
        rank = i + 1
        is_you = r["id"] == current_user.id
        if is_you:
            your_rank = rank
            your_score = r["score"]
        entries.append(LeaderboardEntry(
            rank=rank, username=r["username"], score=r["score"], is_you=is_you
        ))

    if your_rank is None:
        own = await db.userword.count(where={"userId": current_user.id})
        your_score = own
        your_rank_rows = await db.query_raw(
            """SELECT COUNT(*) + 1 as rank FROM (
                SELECT user_id, COUNT(*) as cnt FROM user_words
                GROUP BY user_id HAVING COUNT(*) > $1
            ) sub""",
            own,
        )
        your_rank = your_rank_rows[0]["rank"] if your_rank_rows else None

    return LeaderboardResponse(
        board="words_saved",
        entries=entries,
        your_rank=your_rank,
        your_score=your_score,
    )


@router.get("/leaderboard/streak", response_model=LeaderboardResponse)
async def leaderboard_streak(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    rows = await db.query_raw(
        """SELECT id, username, COALESCE(srs_longest_streak, 0) as score
           FROM users
           WHERE is_active = true AND srs_longest_streak > 0
           ORDER BY score DESC
           LIMIT 50"""
    )

    entries = []
    your_rank = None
    your_score = getattr(current_user, "srsLongestStreak", 0) or 0
    for i, r in enumerate(rows):
        rank = i + 1
        is_you = r["id"] == current_user.id
        if is_you:
            your_rank = rank
        entries.append(LeaderboardEntry(
            rank=rank, username=r["username"], score=r["score"], is_you=is_you
        ))

    return LeaderboardResponse(
        board="longest_streak",
        entries=entries,
        your_rank=your_rank,
        your_score=your_score,
    )


@router.get("/leaderboard/reviews", response_model=LeaderboardResponse)
async def leaderboard_reviews(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    rows = await db.query_raw(
        """SELECT id, username, COALESCE(srs_total_reviews, 0) as score
           FROM users
           WHERE is_active = true AND srs_total_reviews > 0
           ORDER BY score DESC
           LIMIT 50"""
    )

    entries = []
    your_rank = None
    your_score = getattr(current_user, "srsTotalReviews", 0) or 0
    for i, r in enumerate(rows):
        rank = i + 1
        is_you = r["id"] == current_user.id
        if is_you:
            your_rank = rank
        entries.append(LeaderboardEntry(
            rank=rank, username=r["username"], score=r["score"], is_you=is_you
        ))

    return LeaderboardResponse(
        board="total_reviews",
        entries=entries,
        your_rank=your_rank,
        your_score=your_score,
    )


@router.get("/profile/{user_id}")
async def public_profile(
    user_id: int,
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    user = await db.user.find_unique(where={"id": user_id})
    if not user:
        from fastapi import HTTPException
        raise HTTPException(404, "User not found")

    total_saved = await db.userword.count(where={"userId": user_id})
    achievements = await db.query_raw(
        """SELECT ua.achievement_key, a.title, a.icon, ua.unlocked_at
           FROM user_achievements ua
           JOIN achievements a ON ua.achievement_key = a.key
           WHERE ua.user_id = $1 AND ua.unlocked = true
           ORDER BY ua.unlocked_at DESC""",
        user_id,
    )

    return {
        "user_id": user.id,
        "username": user.username,
        "profile_picture_url": user.profilePictureUrl,
        "words_saved": total_saved,
        "current_streak": getattr(user, "srsCurrentStreak", 0) or 0,
        "longest_streak": getattr(user, "srsLongestStreak", 0) or 0,
        "total_reviews": getattr(user, "srsTotalReviews", 0) or 0,
        "achievements": [
            {"key": a["achievement_key"], "title": a["title"], "icon": a["icon"],
             "unlocked_at": str(a["unlocked_at"]) if a["unlocked_at"] else None}
            for a in achievements
        ],
    }
