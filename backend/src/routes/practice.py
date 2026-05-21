"""
v0.7 Practice tab — units & lesson nodes endpoint.

Mobile calls `GET /practice/units` on Practice-tab open. The endpoint
returns up to N "units" (one per reel movie) with 5 lesson nodes each.
Logic + lesson-state derivation lives in
`backend/src/services/practice_service.py` so the math is unit-testable
without a DB harness.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query
from prisma import Prisma
from pydantic import BaseModel

from ..database import get_db
from ..middleware.auth import get_current_active_user
from ..services.practice_service import build_units_for_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/practice", tags=["practice"])


class LessonPayload(BaseModel):
    id: str
    kind: str   # 'recall' | 'mcq' | 'listen' | 'chest' | 'star'
    label: str
    state: str  # 'done' | 'active' | 'locked'
    words: list[str] | None = None


class UnitPayload(BaseModel):
    unit_id: str
    movie_id: int
    tmdb_id: int | None
    title: str
    poster_path: str | None
    cefr_level: str | None
    tagline: str | None
    done: int
    total: int
    lessons: list[LessonPayload]


class UnitsResponse(BaseModel):
    units: list[UnitPayload]
    total: int


@router.get("/units", response_model=UnitsResponse)
async def list_units(
    limit: int = Query(20, ge=1, le=50),
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """Build the user's Practice path.

    One unit per reel movie, ordered most-recently-added first (same as
    the reel itself). 5 fixed lesson nodes per unit — see
    practice_service.derive_lesson_states for the slot/state mapping.
    Returns an empty list when the user hasn't added any movies yet;
    the client renders an empty-state CTA in that case.
    """
    units = await build_units_for_user(db, user_id=current_user.id, limit=limit)
    return UnitsResponse(
        units=[UnitPayload(**u.as_dict()) for u in units],
        total=len(units),
    )
