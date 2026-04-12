"""
Spaced-repetition review endpoints (WordWise Plus).

See docs/MONETIZATION_PLAN.md §3 / §9. Leitner scheduler: box 1..5 with
intervals 1d/3d/7d/14d/30d. "Got it" advances the box, "forgot" drops to
box 1. Every saved word starts at box 1 / due now, so first session pulls
exactly what the user has saved.

Free users get N preview sessions (SRS_FREE_PREVIEW_SESSIONS env, default 3)
before they hit the paywall. Admin preview toggle is client-side — the
server authorizes based on the real subscription_tier / is_admin, which
matches what admins see when they flip to "Free view": the server ALSO
treats them as premium (they are), but the client simulates the paywall UI.
To simulate the actual gating end-to-end, admins can create a comped account
from the grant UI and log in as that user instead.
"""

from __future__ import annotations

import os
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from prisma import Prisma

from ..database import get_db
from ..middleware.auth import get_current_active_user
from ..utils.subscription import is_premium

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/srs", tags=["srs"])

# Leitner intervals in days, indexed by (box - 1). Box 1 → 1 day after a
# correct answer, box 5 → 30 days. A card at box 5 that the user still
# remembers stays at box 5 and gets +30 days.
BOX_INTERVALS_DAYS = [1, 3, 7, 14, 30]
MAX_BOX = len(BOX_INTERVALS_DAYS)

# How many cards to surface per session. Small enough to stay under the
# "5–10 min session" target in the plan.
SESSION_SIZE = int(os.environ.get("SRS_SESSION_SIZE", "10"))

# Free-preview gate. Controls how many review sessions a non-premium user
# can start before the paywall fires. Variant B from the A/B test in §3.
FREE_PREVIEW_SESSIONS = int(os.environ.get("SRS_FREE_PREVIEW_SESSIONS", "3"))


def _next_due(box: int) -> datetime:
    """Next due timestamp for a card now in `box`. Clamped to MAX_BOX."""
    idx = max(0, min(box, MAX_BOX) - 1)
    return datetime.now(timezone.utc) + timedelta(days=BOX_INTERVALS_DAYS[idx])


class ReviewCard(BaseModel):
    user_word_id: int
    word: str
    movie_id: Optional[int]
    movie_title: Optional[str] = None
    srs_box: int
    srs_due_at: datetime
    definition: Optional[str] = None
    example_sentence: Optional[str] = None
    cefr_level: Optional[str] = None


class SessionStartResponse(BaseModel):
    cards: list[ReviewCard]
    total_due: int
    session_size: int
    # Free-preview budget the client uses to show the paywall nudge.
    is_preview: bool
    previews_remaining: int


class TodaysWordResponse(BaseModel):
    word: str
    definition: Optional[str]
    example_sentence: Optional[str]
    movie_title: str
    movie_poster_url: Optional[str]
    cefr_level: Optional[str]
    movie_id: int


class ReviewBody(BaseModel):
    user_word_id: int
    correct: bool  # True = "Got it", False = "Forgot"


class ReviewResponse(BaseModel):
    user_word_id: int
    new_box: int
    next_due_at: datetime


class StatsResponse(BaseModel):
    total_saved: int
    due_now: int
    due_today: int
    by_box: dict[int, int]
    is_premium: bool
    previews_remaining: int
    current_streak: int
    longest_streak: int
    total_reviews: int
    total_correct: int
    retention_pct: int


@router.get("/stats", response_model=StatsResponse)
async def srs_stats(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """Lightweight counts for the HomeScreen review CTA. Cheap queries only."""
    now = datetime.now(timezone.utc)
    end_of_day = now.replace(hour=23, minute=59, second=59, microsecond=0)

    total_saved = await db.userword.count(where={"userId": current_user.id})
    due_now = await db.userword.count(
        where={"userId": current_user.id, "srsDueAt": {"lte": now}}
    )
    due_today = await db.userword.count(
        where={"userId": current_user.id, "srsDueAt": {"lte": end_of_day}}
    )

    by_box: dict[int, int] = {}
    for b in range(1, MAX_BOX + 1):
        by_box[b] = await db.userword.count(
            where={"userId": current_user.id, "srsBox": b}
        )

    premium = is_premium(current_user)
    used = getattr(current_user, "srsFreePreviewsUsed", 0) or 0
    remaining = max(0, FREE_PREVIEW_SESSIONS - used) if not premium else FREE_PREVIEW_SESSIONS

    total_reviews = getattr(current_user, "srsTotalReviews", 0) or 0
    total_correct = getattr(current_user, "srsTotalCorrect", 0) or 0
    retention_pct = round((total_correct / total_reviews) * 100) if total_reviews > 0 else 0

    return StatsResponse(
        total_saved=total_saved,
        due_now=due_now,
        due_today=due_today,
        by_box=by_box,
        is_premium=premium,
        previews_remaining=remaining,
        current_streak=getattr(current_user, "srsCurrentStreak", 0) or 0,
        longest_streak=getattr(current_user, "srsLongestStreak", 0) or 0,
        total_reviews=total_reviews,
        total_correct=total_correct,
        retention_pct=retention_pct,
    )


@router.post("/session/start", response_model=SessionStartResponse)
async def start_session(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """
    Claim a new review session. For free users this consumes one of their
    preview sessions. Premium users call this freely.

    Paywall contract: when a non-premium user is out of previews we return
    HTTP 402 (Payment Required) with a {paywall, previews_used, previews_limit}
    payload that the mobile app translates into the upgrade screen.
    """
    premium = is_premium(current_user)
    used = getattr(current_user, "srsFreePreviewsUsed", 0) or 0

    if not premium and used >= FREE_PREVIEW_SESSIONS:
        raise HTTPException(
            status_code=402,
            detail={
                "paywall": "srs_preview_exhausted",
                "previews_used": used,
                "previews_limit": FREE_PREVIEW_SESSIONS,
                "message": "You've used your free review sessions. "
                           "Start a 7-day trial to keep reviewing.",
            },
        )

    now = datetime.now(timezone.utc)
    due_rows = await db.userword.find_many(
        where={"userId": current_user.id, "srsDueAt": {"lte": now}},
        order=[{"srsDueAt": "asc"}, {"id": "asc"}],
        take=SESSION_SIZE,
    )

    # Hydrate cards with definitions and movie titles
    word_texts = list({r.word for r in due_rows})
    movie_ids = list({r.movieId for r in due_rows if r.movieId})

    def_map: dict[str, tuple] = {}
    if word_texts:
        defs = await db.word.find_many(where={"word": {"in": word_texts}})
        for d in defs:
            if d.word not in def_map and d.definition:
                def_map[d.word] = (d.definition, d.example_sentence, getattr(d, "difficulty_level", None))

    movie_map: dict[int, str] = {}
    if movie_ids:
        movies = await db.movie.find_many(where={"id": {"in": movie_ids}})
        for m in movies:
            movie_map[m.id] = m.title

    # Look up CEFR levels from word classifications
    cefr_map: dict[str, str] = {}
    if word_texts:
        cefr_rows = await db.query_raw(
            """SELECT DISTINCT ON (wc.word) wc.word, wc.cefr_level
               FROM word_classifications wc
               WHERE wc.word = ANY($1::text[])
               ORDER BY wc.word, wc.id DESC""",
            word_texts,
        )
        for r in cefr_rows:
            cefr_map[r["word"]] = r["cefr_level"]

    cards = [
        ReviewCard(
            user_word_id=r.id,
            word=r.word,
            movie_id=r.movieId,
            movie_title=movie_map.get(r.movieId) if r.movieId else None,
            srs_box=r.srsBox,
            srs_due_at=r.srsDueAt,
            definition=def_map.get(r.word, (None,))[0],
            example_sentence=def_map.get(r.word, (None, None))[1] if r.word in def_map else None,
            cefr_level=cefr_map.get(r.word),
        )
        for r in due_rows
    ]

    # Count total due (for the "N words due" header) without paying for
    # another find_many.
    total_due = await db.userword.count(
        where={"userId": current_user.id, "srsDueAt": {"lte": now}}
    )

    # Only consume a preview slot if there was actually work to do. Don't
    # penalize users who tap "review" and find an empty queue.
    if not premium and cards:
        await db.user.update(
            where={"id": current_user.id},
            data={"srsFreePreviewsUsed": used + 1},
        )
        used += 1

    remaining = max(0, FREE_PREVIEW_SESSIONS - used) if not premium else FREE_PREVIEW_SESSIONS

    return SessionStartResponse(
        cards=cards,
        total_due=total_due,
        session_size=SESSION_SIZE,
        is_preview=not premium,
        previews_remaining=remaining,
    )


@router.post("/review", response_model=ReviewResponse)
async def record_review(
    body: ReviewBody,
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """
    Record one card outcome. Correct → advance box, Forgot → reset to box 1.
    No preview budget consumed here — the cost was paid at session start.
    """
    word_row = await db.userword.find_unique(where={"id": body.user_word_id})
    if word_row is None or word_row.userId != current_user.id:
        raise HTTPException(404, detail="card not found")

    if body.correct:
        new_box = min(MAX_BOX, (word_row.srsBox or 1) + 1)
    else:
        new_box = 1

    next_due = _next_due(new_box)
    now = datetime.now(timezone.utc)
    today = now.date()
    await db.userword.update(
        where={"id": word_row.id},
        data={
            "srsBox": new_box,
            "srsDueAt": next_due,
            "srsLastReviewedAt": now,
        },
    )

    # Update aggregate stats on the user row.
    prev_total = getattr(current_user, "srsTotalReviews", 0) or 0
    prev_correct = getattr(current_user, "srsTotalCorrect", 0) or 0
    prev_streak = getattr(current_user, "srsCurrentStreak", 0) or 0
    prev_longest = getattr(current_user, "srsLongestStreak", 0) or 0
    last_date = getattr(current_user, "srsLastSessionDate", None)

    new_streak = prev_streak
    if last_date is None or (today - last_date).days >= 2:
        new_streak = 1
    elif (today - last_date).days == 1:
        new_streak = prev_streak + 1
    # same day → streak unchanged

    new_longest = max(prev_longest, new_streak)

    await db.user.update(
        where={"id": current_user.id},
        data={
            "srsTotalReviews": prev_total + 1,
            "srsTotalCorrect": prev_correct + (1 if body.correct else 0),
            "srsCurrentStreak": new_streak,
            "srsLongestStreak": new_longest,
            "srsLastSessionDate": today,
        },
    )

    return ReviewResponse(
        user_word_id=word_row.id,
        new_box=new_box,
        next_due_at=next_due,
    )


@router.get("/today", response_model=Optional[TodaysWordResponse])
async def todays_word(
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """
    One discovery word per day — NOT from the user's saved deck.
    Deterministic per user+date so repeated calls return the same word.
    See docs/MONETIZATION_PLAN.md §8.
    """
    import hashlib

    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    seed = int(hashlib.md5(f"{current_user.id}:{today_str}".encode()).hexdigest()[:8], 16)

    saved_words = await db.userword.find_many(
        where={"userId": current_user.id},
        distinct=["word"],
    )
    saved_set = {uw.word.lower() for uw in saved_words}

    candidates = await db.query_raw(
        '''
        SELECT w.word, w.definition, w.example_sentence,
               m.id AS movie_id, m.title AS movie_title, m.poster_url
        FROM words w
        JOIN movies m ON w.movie_id = m.id
        WHERE m.tmdb_vote_count >= 500
          AND w.definition IS NOT NULL
          AND w.word ~ '^[a-zA-Z]+$'
          AND length(w.word) >= 4
        ORDER BY m.tmdb_popularity DESC NULLS LAST
        LIMIT 500
        '''
    )

    filtered = [c for c in candidates if c["word"].lower() not in saved_set]
    if not filtered:
        return None

    pick = filtered[seed % len(filtered)]

    return TodaysWordResponse(
        word=pick["word"],
        definition=pick.get("definition"),
        example_sentence=pick.get("example_sentence"),
        movie_title=pick["movie_title"],
        movie_poster_url=pick.get("poster_url"),
        cefr_level=None,
        movie_id=pick["movie_id"],
    )
