"""
Reel — per-user list of movies the user has added to their personal queue
for vocab prep. The reel is purely user-curated: there is no suggested
zone in the response. New users are bootstrapped via POST /reel/seed,
which idempotently creates a starter set from SUGGESTED_SEED in the
user's CEFR ±1 band so the first-time reel is never empty.

Title / poster_path / year are denormalized on each row so the reel
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

# CEFR ladder used for ±1 banding when seeding starter movies.
LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]

# How many starter movies to drop into a fresh reel.
SEED_TARGET_COUNT = 6


# ─── Starter seed ──────────────────────────────────────────────────────
# Curated per-CEFR list used ONLY for first-time auto-seeding. Each tile
# is a stable (tmdb_id, title, poster_path, year). Easier levels =
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


def _starter_for_level(level: str) -> list[tuple[int, str, str, int]]:
    """Flat starter list for `level` ± 1, ordered easiest → hardest across
    that band so the seeded reel climbs naturally."""
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
    source: Literal["user", "suggested"] = "user"
    # v0.6: progress overlay. `status` defaults to "unstudied" for tiles
    # with no UserMovieProgress row yet (new reel, movie has no lemma data,
    # or simply not recomputed). `comprehensibility_percent` is rounded
    # for display; the float in the DB is preserved for future tuning.
    status: Literal["unstudied", "studied", "mastered"] = "unstudied"
    comprehensibility_percent: int = 0


class ReelListResponse(BaseModel):
    tiles: List[ReelTile]
    has_more: bool


class AddReelMovieRequest(BaseModel):
    tmdb_id: int
    title: str
    poster_path: Optional[str] = None
    year: Optional[int] = None


class SeedReelResponse(BaseModel):
    seeded: int
    tiles: List[ReelTile]


@router.get("", response_model=ReelListResponse)
async def list_reel(
    cursor: int = Query(0, ge=0),
    limit: int = Query(60, ge=1, le=200),
    db: Prisma = Depends(get_db),
    user=Depends(get_current_active_user),
):
    """User-curated reel, most-recently-added first. Empty for brand-new
    users until POST /reel/seed runs (client calls it on first hydrate
    when the response is empty).

    v0.6: each tile is decorated with `status` + `comprehensibility_percent`
    from UserMovieProgress (joined via TMDB id → internal Movie.id). Tiles
    with no progress row yet stay at the schema defaults (unstudied, 0%).
    """
    user_rows = await db.userreelmovie.find_many(
        where={"userId": user.id},
        order={"addedAt": "desc"},
    )

    # Build the progress lookup keyed by TMDB id (what the reel tiles use)
    # via the Movie table. One query per resolution direction.
    progress_by_tmdb: dict[int, tuple[str, int]] = {}
    if user_rows:
        tmdb_ids = [r.tmdbId for r in user_rows]
        movies = await db.movie.find_many(where={"tmdbId": {"in": tmdb_ids}})
        tmdb_to_movie_id = {m.tmdbId: m.id for m in movies}
        movie_ids = list(tmdb_to_movie_id.values())
        if movie_ids:
            progress_rows = await db.usermovieprogress.find_many(
                where={"userId": user.id, "movieId": {"in": movie_ids}},
            )
            movie_id_to_progress = {p.movieId: p for p in progress_rows}
            for tmdb_id, movie_id in tmdb_to_movie_id.items():
                p = movie_id_to_progress.get(movie_id)
                if p is None:
                    continue
                progress_by_tmdb[tmdb_id] = (
                    p.status if isinstance(p.status, str) else p.status.value,
                    round(p.comprehensibilityPercent),
                )

    tiles = []
    for r in user_rows:
        status, pct = progress_by_tmdb.get(r.tmdbId, ("unstudied", 0))
        tiles.append(ReelTile(
            tmdb_id=r.tmdbId,
            title=r.title,
            poster_path=r.posterPath,
            year=r.year,
            source="user",
            status=status,  # type: ignore[arg-type]
            comprehensibility_percent=pct,
        ))
    end = cursor + limit
    page = tiles[cursor:end]
    has_more = end < len(tiles)
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


@router.post("/seed", response_model=SeedReelResponse)
async def seed_reel(
    db: Prisma = Depends(get_db),
    user=Depends(get_current_active_user),
):
    """Idempotent first-launch bootstrap. If the user already has any
    picks, returns the current list unchanged. Otherwise creates
    SEED_TARGET_COUNT starter rows from SUGGESTED_SEED in the user's
    CEFR ±1 band and returns them.

    Safe to call on every cold start — the count check guards against
    re-seeding for returning users who chose to empty their reel."""
    existing = await db.userreelmovie.find_many(
        where={"userId": user.id},
        order={"addedAt": "desc"},
    )
    if existing:
        return SeedReelResponse(
            seeded=0,
            tiles=[
                ReelTile(
                    tmdb_id=r.tmdbId,
                    title=r.title,
                    poster_path=r.posterPath,
                    year=r.year,
                    source="user",
                )
                for r in existing
            ],
        )

    user_level_raw = user.proficiencyLevel or "A1"
    user_level = (
        user_level_raw.value if hasattr(user_level_raw, "value") else user_level_raw
    ).upper()
    candidates = _starter_for_level(user_level)[:SEED_TARGET_COUNT]

    # Order matters: addedAt is set automatically and rows added later
    # surface higher in the reel (DESC order). We want the curated
    # easiest→hardest band to come out bottom-up, so insert in reverse.
    created_rows = []
    for position, (tmdb_id, title, poster, year) in enumerate(reversed(candidates)):
        try:
            row = await db.userreelmovie.create(
                data={
                    "userId": user.id,
                    "tmdbId": tmdb_id,
                    "position": position,
                    "title": title,
                    "posterPath": poster,
                    "year": year,
                }
            )
            created_rows.append(row)
        except Exception:
            # Skip dupes / constraint violations defensively — seeding
            # should never fail the request.
            continue

    # Re-fetch to return them in canonical DESC order.
    final = await db.userreelmovie.find_many(
        where={"userId": user.id},
        order={"addedAt": "desc"},
    )
    return SeedReelResponse(
        seeded=len(created_rows),
        tiles=[
            ReelTile(
                tmdb_id=r.tmdbId,
                title=r.title,
                poster_path=r.posterPath,
                year=r.year,
                source="user",
            )
            for r in final
        ],
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
