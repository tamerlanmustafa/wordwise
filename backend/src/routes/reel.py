"""
Reel — per-user ordered list of TMDB movies displayed as tile covers on
the Journey Reel screen. Order is purely add-order; the position column
is assigned server-side as max(position)+1 on insert.

Title / poster_path / year are denormalized so the reel renders without
a TMDB roundtrip per row.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from prisma import Prisma
from pydantic import BaseModel

from ..database import get_db
from ..middleware.auth import get_current_active_user

router = APIRouter(prefix="/reel", tags=["reel"])


class ReelMovieItem(BaseModel):
    tmdb_id: int
    position: int
    title: str
    poster_path: Optional[str] = None
    year: Optional[int] = None


class AddReelMovieRequest(BaseModel):
    tmdb_id: int
    title: str
    poster_path: Optional[str] = None
    year: Optional[int] = None


@router.get("", response_model=List[ReelMovieItem])
async def list_reel(
    db: Prisma = Depends(get_db),
    user=Depends(get_current_active_user),
):
    rows = await db.userreelmovie.find_many(
        where={"userId": user.id},
        order={"position": "asc"},
    )
    return [
        ReelMovieItem(
            tmdb_id=r.tmdbId,
            position=r.position,
            title=r.title,
            poster_path=r.posterPath,
            year=r.year,
        )
        for r in rows
    ]


@router.post("", response_model=ReelMovieItem)
async def add_to_reel(
    body: AddReelMovieRequest,
    db: Prisma = Depends(get_db),
    user=Depends(get_current_active_user),
):
    existing = await db.userreelmovie.find_unique(
        where={"userId_tmdbId": {"userId": user.id, "tmdbId": body.tmdb_id}}
    )
    if existing:
        return ReelMovieItem(
            tmdb_id=existing.tmdbId,
            position=existing.position,
            title=existing.title,
            poster_path=existing.posterPath,
            year=existing.year,
        )

    last = await db.userreelmovie.find_first(
        where={"userId": user.id},
        order={"position": "desc"},
    )
    next_position = (last.position + 1) if last else 0

    created = await db.userreelmovie.create(
        data={
            "userId": user.id,
            "tmdbId": body.tmdb_id,
            "position": next_position,
            "title": body.title,
            "posterPath": body.poster_path,
            "year": body.year,
        }
    )
    return ReelMovieItem(
        tmdb_id=created.tmdbId,
        position=created.position,
        title=created.title,
        poster_path=created.posterPath,
        year=created.year,
    )


@router.delete("/{tmdb_id}", status_code=204)
async def remove_from_reel(
    tmdb_id: int,
    db: Prisma = Depends(get_db),
    user=Depends(get_current_active_user),
):
    deleted = await db.userreelmovie.delete(
        where={"userId_tmdbId": {"userId": user.id, "tmdbId": tmdb_id}}
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Not in reel")

    # Re-pack positions so they remain contiguous starting at 0.
    remaining = await db.userreelmovie.find_many(
        where={"userId": user.id},
        order={"position": "asc"},
    )
    for new_pos, row in enumerate(remaining):
        if row.position != new_pos:
            await db.userreelmovie.update(
                where={"userId_tmdbId": {"userId": user.id, "tmdbId": row.tmdbId}},
                data={"position": new_pos},
            )
    return None
