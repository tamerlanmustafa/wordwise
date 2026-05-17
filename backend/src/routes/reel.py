"""
Reel — per-user ordered list of tiles for the Journey Reel screen. The
list is the concatenation of two zones (bottom → top):

  1. User picks — most-recently-added first, source='user'.
  2. Suggested  — curated per-CEFR seed, filtered to the user's
                  proficiency_level ± 1 level, source='suggested'.

The reel must never be empty, so the suggested zone backs every user
regardless of whether they've added any picks. The user picks zone is
optional. Title / poster_path / year are denormalized so the reel
renders without per-row TMDB roundtrips.
"""
from __future__ import annotations

from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from prisma import Prisma
from pydantic import BaseModel

from ..database import get_db
from ..middleware.auth import get_current_active_user

router = APIRouter(prefix="/reel", tags=["reel"])

# CEFR ladder used for ±1 banding.
LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]


# ─── Suggested seed ────────────────────────────────────────────────────
# Curated per-CEFR list. Each tile is a stable (tmdb_id, title,
# poster_path, year) so the client never has to enrich. Easier levels =
# animation / family; harder levels = drama / arthouse.
SUGGESTED_SEED: dict[str, list[tuple[int, str, str, int]]] = {
    "A1": [
        (12,     "Finding Nemo",                "/eHuGQ10FUzK1mdOY69wF5pGgEf5.jpg", 2003),
        (862,    "Toy Story",                   "/uXDfjJbdP4ijW5hWSBrPrlKpxab.jpg", 1995),
        (8587,   "The Lion King",               "/sKCr78MXSLixwmZ8DyJLrpMsd15.jpg", 1994),
        (10193,  "Toy Story 3",                 "/AbbXspMOwdvwWZgVN0nabZq03Ec.jpg", 2010),
        (150540, "Inside Out",                  "/2H1TmgdfNtsKlU9jKdeNyYL5y8T.jpg", 2015),
        (354912, "Coco",                        "/gGEsBPAijhVUFoiNpgZXqRVWJt2.jpg", 2017),
        (109445, "Frozen",                      "/kgwjIb2JDHRhNk13lmSxiClFjVk.jpg", 2013),
        (10681,  "WALL·E",                      "/hbhFnRzzg6ZDmm8YAmxBnQpQIPh.jpg", 2008),
    ],
    "A2": [
        (808,    "Shrek",                       "/iB64vpL3dIObOtMZgX3RqdVdQDc.jpg", 2001),
        (9487,   "A Bug's Life",                "/aSP8VrqezRSP9TQPRGmIM3M0Pwn.jpg", 1998),
        (62,     "2001: A Space Odyssey",       "/ve72VxNqjGM69Uky4WTo2bK6rfq.jpg", 1968),
        (585,    "Monsters, Inc.",              "/wMpJBOR4JLeBKjiQvqWLm1u3M0z.jpg", 2001),
        (807,    "Se7en",                       "/6yoghtyTpznpBik8EngEmJskVUO.jpg", 1995),
        (38757,  "Tangled",                     "/ym7Kt7TaXmIvbhz0qmaqIeYzc8b.jpg", 2010),
        (920,    "Cars",                        "/2Touu3IK6Z2vbgVqI0BezsmtjE5.jpg", 2006),
        (10193,  "How to Train Your Dragon",    "/ygGmAO60t8GyqUo9xYeYxSZAR3b.jpg", 2010),
    ],
    "B1": [
        (13,     "Forrest Gump",                "/arw2vcBveWOVZr6pxd9XTd1TdQa.jpg", 1994),
        (105,    "Back to the Future",          "/fNOH9f1aA7XRTzl1sAOx9iF553Q.jpg", 1985),
        (38,     "Eternal Sunshine of the Spotless Mind", "/5MwkWH9tYHv3mV9OdYzMtokyGfZ.jpg", 2004),
        (497,    "The Green Mile",              "/velWPhVMQeQKcxggNEU8YmIo52R.jpg", 1999),
        (278,    "The Shawshank Redemption",    "/9cqNxx0GxF0bflZmeSMuL5tnGzr.jpg", 1994),
        (637,    "Life Is Beautiful",           "/74hLDKjD5aGYOotO6esUVaeISa2.jpg", 1997),
        (671,    "Harry Potter and the Philosopher's Stone", "/wuMc08IPKEatf9rnMNXvIDxqP4W.jpg", 2001),
        (122,    "The Lord of the Rings: The Return of the King", "/rCzpDGLbOoPwLjy3OAm5NUPOTrC.jpg", 2003),
    ],
    "B2": [
        (27205,  "Inception",                   "/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg", 2010),
        (155,    "The Dark Knight",             "/qJ2tW6WMUDux911r6m7haRef0WH.jpg", 2008),
        (603,    "The Matrix",                  "/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg", 1999),
        (550,    "Fight Club",                  "/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg", 1999),
        (496243, "Parasite",                    "/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg", 2019),
        (157336, "Interstellar",                "/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg", 2014),
        (1124,   "The Prestige",                "/bdN3gXuIZYaJP7ftKK2sU0nPtEA.jpg", 2006),
        (335984, "Blade Runner 2049",           "/gajva2L0rPYkEWjzgFlBXCAVBE5.jpg", 2017),
    ],
    "C1": [
        (680,    "Pulp Fiction",                "/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg", 1994),
        (769,    "Goodfellas",                  "/aKuFiU82s5ISJpGZp7YkIr3kCUd.jpg", 1990),
        (238,    "The Godfather",               "/3bhkrj58Vtu7enYsRolD1fZdja1.jpg", 1972),
        (240,    "The Godfather Part II",       "/hek3koDUyRQk7FIhPXsa6mT2Zc3.jpg", 1974),
        (424,    "Schindler's List",            "/sF1U4EUQS8YHUYjNl3pMGNIQyr0.jpg", 1993),
        (1422,   "The Departed",                "/nT97ifVT2J1yMQmeq20Qblg61T.jpg", 2006),
        (311,    "Once Upon a Time in America", "/wsNo9JpVI5h36PUI4lUaTwIyM3X.jpg", 1984),
        (78,     "Blade Runner",                "/63N9uy8nd9j7Eog2axPQ8lbr3Wj.jpg", 1982),
    ],
    "C2": [
        (7345,   "There Will Be Blood",         "/fa0RDkAlCec0STeMNAhPaF89q4r.jpg", 2007),
        (74643,  "The Master",                  "/8MAFi8WyB1U2XK7Z1NhFsZ4WiQB.jpg", 2012),
        (389,    "12 Angry Men",                "/ow3wq89wM8qd5X7hWKxiRfsFf9C.jpg", 1957),
        (598,    "City of God",                 "/k7eYdcfDjVdGY7K3PnTrUUiQGoq.jpg", 2002),
        (4982,   "No Country for Old Men",      "/bj1v6YKF8yHqA489VFfnQvOJpnc.jpg", 2007),
        (567,    "Rear Window",                 "/qitnZcLP7C9DLRuPpmvZ7GiEjJN.jpg", 1954),
        (348,    "Alien",                       "/vfrQk5IPloGg1v9Rzbh2Eg3VGyM.jpg", 1979),
        (510,    "One Flew Over the Cuckoo's Nest", "/3jcbDmRFiQ83drXNOvRDeKHxS0C.jpg", 1975),
    ],
}


def _suggested_for_level(level: str) -> list[tuple[int, str, str, int]]:
    """Return a flat list of suggested tiles for `level` ± 1, ordered
    easiest → hardest across that band so the user climbs naturally."""
    try:
        i = LEVELS.index(level)
    except ValueError:
        i = 0
    band = LEVELS[max(0, i - 1): min(len(LEVELS), i + 2)]
    out: list[tuple[int, str, str, int]] = []
    for lv in band:
        out.extend(SUGGESTED_SEED.get(lv, []))
    return out


class ReelTile(BaseModel):
    tmdb_id: int
    title: str
    poster_path: Optional[str] = None
    year: Optional[int] = None
    source: Literal["user", "suggested"]


class ReelListResponse(BaseModel):
    tiles: List[ReelTile]
    has_more: bool


class AddReelMovieRequest(BaseModel):
    tmdb_id: int
    title: str
    poster_path: Optional[str] = None
    year: Optional[int] = None


@router.get("", response_model=ReelListResponse)
async def list_reel(
    cursor: int = Query(0, ge=0),
    limit: int = Query(60, ge=1, le=200),
    db: Prisma = Depends(get_db),
    user=Depends(get_current_active_user),
):
    """
    Combined reel feed: user picks (most-recent first) → suggested. The
    user can never see an empty reel because the suggested zone always
    seeds at least one ±1-CEFR band of curated titles.

    `cursor`/`limit` accept slice params for future pagination; today the
    whole slice is materialized in-memory and sliced before return.
    """
    user_rows = await db.userreelmovie.find_many(
        where={"userId": user.id},
        order={"addedAt": "desc"},
    )
    user_tiles = [
        ReelTile(
            tmdb_id=r.tmdbId,
            title=r.title,
            poster_path=r.posterPath,
            year=r.year,
            source="user",
        )
        for r in user_rows
    ]

    # Exclude any suggested entries the user has already added so the
    # zigzag doesn't show the same poster twice.
    added_ids = {r.tmdbId for r in user_rows}
    user_level_raw = user.proficiencyLevel or "A1"
    user_level = (
        user_level_raw.value if hasattr(user_level_raw, "value") else user_level_raw
    ).upper()
    band = LEVELS[max(0, LEVELS.index(user_level) - 1):
                  min(len(LEVELS), LEVELS.index(user_level) + 2)]

    # Candidate seeds in the user's CEFR ±1 band, deduped against
    # the user's existing picks.
    candidates = [
        (tmdb_id, title, poster, year)
        for (tmdb_id, title, poster, year) in _suggested_for_level(user_level)
        if tmdb_id not in added_ids
    ]

    # Re-rank candidates by "new-lemma yield" for this user — i.e.
    # count of distinct movie-lemma rows in the user's CEFR ±1 band
    # that the user has NOT already added to user_words. Movies with
    # no mapping data score 0 and fall to the bottom; among ties, we
    # preserve the curated band-order so the climb still feels
    # easier → harder. The query runs once for the whole candidate
    # batch via ANY($1::int[]).
    candidate_ids = [c[0] for c in candidates]
    yield_by_tmdb: dict[int, int] = {}
    if candidate_ids:
        rows = await db.query_raw(
            """
            SELECT m.tmdb_id AS tmdb_id, COUNT(DISTINCT mlm.lemma_id) AS yield
            FROM movie_lemma_mappings mlm
            JOIN movies m ON m.id = mlm.movie_id
            JOIN lemmas l ON l.id = mlm.lemma_id
            WHERE m.tmdb_id = ANY($1::int[])
              AND l.cefr_level::text = ANY($2::text[])
              AND NOT EXISTS (
                  SELECT 1 FROM user_words uw
                  WHERE uw.user_id = $3
                    AND LOWER(uw.word) = LOWER(l.lemma)
              )
              AND NOT EXISTS (
                  SELECT 1 FROM hidden_words hw
                  WHERE LOWER(hw.word) = LOWER(l.lemma)
              )
            GROUP BY m.tmdb_id
            """,
            candidate_ids, band, user.id,
        )
        yield_by_tmdb = {int(r["tmdb_id"]): int(r["yield"]) for r in rows}

    # Stable sort: yield DESC, then preserve original curated order.
    ranked = sorted(
        enumerate(candidates),
        key=lambda pair: (-yield_by_tmdb.get(pair[1][0], 0), pair[0]),
    )

    suggested_tiles = [
        ReelTile(
            tmdb_id=tmdb_id,
            title=title,
            poster_path=poster,
            year=year,
            source="suggested",
        )
        for _, (tmdb_id, title, poster, year) in ranked
    ]

    combined = user_tiles + suggested_tiles
    end = cursor + limit
    page = combined[cursor:end]
    has_more = end < len(combined)
    return ReelListResponse(tiles=page, has_more=has_more)


@router.post("", response_model=ReelTile)
async def add_to_reel(
    body: AddReelMovieRequest,
    db: Prisma = Depends(get_db),
    user=Depends(get_current_active_user),
):
    existing = await db.userreelmovie.find_unique(
        where={"userId_tmdbId": {"userId": user.id, "tmdbId": body.tmdb_id}}
    )
    if existing:
        return ReelTile(
            tmdb_id=existing.tmdbId,
            title=existing.title,
            poster_path=existing.posterPath,
            year=existing.year,
            source="user",
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
    return ReelTile(
        tmdb_id=created.tmdbId,
        title=created.title,
        poster_path=created.posterPath,
        year=created.year,
        source="user",
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
