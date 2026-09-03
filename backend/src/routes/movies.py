import json
import logging
import time
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Response, status, Query
from prisma import Prisma
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from ..database import get_db
from ..schemas.movie import MovieCreate, MovieResponse, MovieListResponse
from ..middleware.auth import (
    get_admin_user,
    get_current_active_user,
    get_current_user_optional,
)
from ..services.backdrop_ink import unpack_rgb
from ..services.hidden_words import get_hidden_word_set
from ..services.internationalism_filter import is_internationalism_entry
from ..services.lemma_guard import display_form
from ..services.movie_cefr import (
    CEFR_SCORE_RANGES,
    cefr_from_score,
    normalize_level,
    score_range_for_cefr,
)
from ..services.profanity_filter import is_profane_entry
from ..services.script_idioms import get_script_idioms
from ..utils.http_cache import public_cache
from ..utils.nlp_executor import NLPOverloaded
from ..utils.rate_limit import rate_limit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/movies", tags=["movies"])

# /vocabulary/preview takes no auth (it is the logged-out teaser). Since #106
# the idiom list is stored per script, so only the *first* request for a movie
# parses — ~12s of CPU on the single NLP worker thread and ~600 MB of transient
# spaCy Doc. #117 stopped that blocking the event loop, but nothing stopped one
# caller from walking the catalogue and queueing a parse per movie.
#
# Two defences, because they fail differently:
#  - a per-caller throttle, which only bites when the caller can be identified
#    (reliable for logged-in users, not for anonymous ones behind the edge
#    proxy — see rate_limit._client_ip);
#  - a cap on the NLP queue itself, which needs no notion of who is calling.
# At ~12s a parse, four queued already means the last one waits ~48s; past
# that, shedding beats queueing.
_vocab_preview_throttle = rate_limit(5, 60.0, scope="movie-vocab-preview")
MAX_PENDING_PREVIEW_PARSES = 4

# Cache-Control for the reads below that are the same for every caller (#123).
# The catalogue only changes when an ingestion or backfill worker rewrites a
# row, so a repeat request should not have to reach this single-process API at
# all. There is no purge hook, so freshness is bounded by the TTL: a backfill
# is fully visible one TTL after it lands.
#
# Deliberately NOT applied to /by-cefr. It reads the same catalogue but
# subtracts the caller's watched and not-interested movies, so `public` would
# let a shared cache hand one learner's filtered feed to the next learner.
_MOVIE_DETAIL_CACHE = public_cache(3600)
# Listings gain rows when ingestion runs, so they age faster than a single row.
_MOVIE_LIST_CACHE = public_cache(900)
# The expensive one — see the throttle above. Recomputing it means re-reading
# every word classification for the script, so it is the biggest win here.
_VOCAB_PREVIEW_CACHE = public_cache(3600)


@router.get("/", response_model=MovieListResponse)
async def list_movies(
    response: Response,
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=100),
    difficulty: Optional[str] = Query(None, description="CEFR level: A1..C2"),
    db: Prisma = Depends(get_db)
):
    """List all movies with pagination and optional filtering"""
    where_clause: Dict[str, Any] = {}

    # #103: the level is a band of `difficulty_score`, not a stored column, so
    # filtering is a range rather than an equality. Legacy enum names still
    # resolve for builds that predate the change.
    if difficulty:
        key = normalize_level(difficulty)
        if key is None:
            raise HTTPException(status_code=400, detail=f"Invalid level: {difficulty}")
        lo, hi = CEFR_SCORE_RANGES[key]
        where_clause["difficultyScore"] = {"gte": lo, "lte": hi}

    total = await db.movie.count(where=where_clause)
    movies = await db.movie.find_many(
        where=where_clause,
        skip=skip,
        take=limit
    )

    response.headers["Cache-Control"] = _MOVIE_LIST_CACHE
    return {
        "movies": movies,
        "total": total,
        "page": skip // limit + 1,
        "page_size": limit
    }


@router.get("/by-level")
async def list_movies_by_level(
    response: Response,
    level: str = Query(..., description="CEFR level: A1, A2, B1, B2, C1, C2"),
    limit: int = Query(50, ge=1, le=200),
    db: Prisma = Depends(get_db),
):
    """
    List processed movies at a CEFR level. Returns tmdb_id when available so
    the mobile client can lazily fetch poster/overview from TMDB.

    Before #103 this only accepted the retired `difficultylevel` enum names,
    which meant onboarding's "pick your first film" step — the one caller that
    passes the learner's CEFR band — got a 400 and showed an empty list to
    every new user. Legacy enum names still resolve, for installs already out
    in the wild.
    """
    target = normalize_level(level)
    if target is None:
        raise HTTPException(status_code=400, detail=f"Invalid level: {level}")

    lo, hi = CEFR_SCORE_RANGES[target]
    rows = await db.query_raw(
        """
        SELECT m.id               AS movie_id,
               m.title            AS title,
               m.year             AS year,
               m.poster_url       AS poster_url,
               m.description      AS description,
               m.difficulty_score AS difficulty_score,
               m.tmdb_id          AS tmdb_id
        FROM movies m
        WHERE m.difficulty_score >= $1
          AND m.difficulty_score <= $2
        ORDER BY m.difficulty_score ASC, m.id ASC
        LIMIT $3
        """,
        lo,
        hi,
        limit,
    )

    response.headers["Cache-Control"] = _MOVIE_LIST_CACHE
    return {
        "level": target,
        "movies": [
            {
                "movie_id": r["movie_id"],
                "tmdb_id": r["tmdb_id"],
                "title": r["title"],
                "year": r["year"],
                "poster_url": r["poster_url"],
                "description": r["description"],
                "difficulty_score": r["difficulty_score"],
            }
            for r in rows
        ],
        "total": len(rows),
    }


# Maps the client-facing `sort` value to a real DB column. Keeping this a
# whitelist (rather than interpolating the raw query param) is what makes it
# safe to f-string the column into the ORDER BY clause below.
#
# `recommended` is deliberately NOT in here. It is not a column, and adding a
# fake entry to make the lookup succeed is how a whitelist stops being one.
CEFR_SORT_COLUMNS = {
    "rating": "m.tmdb_vote_average",
    "popularity": "m.tmdb_vote_count",
    "level": "m.difficulty_score",
}

# ── Recommended: a rotating shelf ───────────────────────────────────────────
# The three column sorts are near-static per level. Rating and popularity
# barely move, and `level` only spreads a 10-point band, so the top of a B1
# shelf was the same six films every day and a newly-classified one sat behind
# pagination nobody scrolls to.
#
# `recommended` orders by md5(movie id + seed) instead: a permutation of the
# level's candidate set that is *deterministic for a given seed* — which is
# what makes OFFSET pagination coherent over it — and different for the next
# one. The seed is a wall-clock bucket, so the shelf turns over on its own
# without any per-user state, a cron, or a stored ordering to invalidate.
RECOMMENDED_ROTATION_SECONDS = 6 * 3600

# Quality is a **sort key, not a filter**.
#
# A pure shuffle over a level surfaces the long tail, so the shelf needs some
# notion of "show the good ones first". The obvious way is a WHERE clause —
# and it was the first cut of this: `vote_count >= 200 AND vote_average >= 6.0`,
# plus a COUNT query per request to decide whether the level was deep enough
# to survive it. That is a whole extra round trip spent to answer a question
# that only matters because the predicate can empty a shelf.
#
# Tiering removes the question. Nothing is excluded, so Recommended can never
# return fewer films than Top rated at the same level; the well-known, well-
# liked films simply sort first, and a thin level (C2 has **6 films** in prod,
# 2026-09-03) just shows its lower tiers sooner. One query, no floor to tune,
# no way for it to go blank.
#
# It is also what "mix the trending ones in" means here: tier 0 is high vote
# count *and* high rating — films people actually watched and liked — and they
# lead every draw. The shuffle then decides *which* of them you get this
# window, so the shelf's character stays constant while its titles rotate.
# Measured on prod 2026-09-03 (top 100 by popularity per level): A1 50/100 in
# tier 0, A2 79, B1 77, B2 76, C1 64 — deep enough everywhere that the first
# page is drawn from tier 0 alone and genuinely reshuffles each window.
_RECOMMENDED_TIER_SQL = """CASE
                WHEN COALESCE(m.tmdb_vote_count, 0) >= 1000
                     AND COALESCE(m.tmdb_vote_average, 0) >= 7.0 THEN 0
                WHEN COALESCE(m.tmdb_vote_count, 0) >= 300
                     AND COALESCE(m.tmdb_vote_average, 0) >= 6.5 THEN 1
                WHEN COALESCE(m.tmdb_vote_count, 0) >= 100
                     AND COALESCE(m.tmdb_vote_average, 0) >= 6.0 THEN 2
                ELSE 3
              END"""


def current_seed() -> int:
    """The rotation window we are in. Integer division of the epoch, so every
    caller in the same six hours derives the same value with no shared state.
    """
    return int(time.time()) // RECOMMENDED_ROTATION_SECONDS


def next_rotation_at(seed: int) -> str:
    """When `seed`'s window ends, ISO-8601 UTC. The client turns this into
    "new set in 4h"; it is not a cache directive.
    """
    return datetime.fromtimestamp(
        (seed + 1) * RECOMMENDED_ROTATION_SECONDS, tz=timezone.utc
    ).isoformat()


def _exclude_seen_sql(p: str) -> str:
    """SQL fragment for /by-cefr that removes the caller's watched / hidden
    movies. `p` is the positional placeholder holding the user id (e.g. "$6").
    When that value is NULL (anonymous caller) the clause is a no-op, so the
    same query text serves both signed-in and anonymous requests. `m` is the
    `movies` alias in the surrounding query.
    """
    return f"""
              AND ({p}::int IS NULL OR (
                        NOT EXISTS (SELECT 1 FROM user_watched_movies uwm
                                    WHERE uwm.user_id = {p} AND uwm.tmdb_id = m.tmdb_id)
                    AND NOT EXISTS (SELECT 1 FROM user_hidden_movies uhm
                                    WHERE uhm.user_id = {p} AND uhm.tmdb_id = m.tmdb_id)
              ))
    """


# `movies.genre` holds a JSON array serialized into a VarChar, e.g.
# '["Animation", "Comedy", "Family"]'. A film carries several genres, so the
# test has to be *contains*, never equality — `genre = 'Animation'` would match
# only the handful of single-genre films.
#
# Measured on prod 2026-08-23: 379 of 4,585 films match, and every one matches
# via a real "Animation" array element — no genre name in the catalogue has
# "animation" as a substring, so this ILIKE has no false positives today.
_ANIMATION_MATCH = "m.genre ILIKE '%Animation%'"


def _animation_filter_sql(animated: Optional[bool]) -> str:
    """SQL fragment narrowing /by-cefr to animation (True) or live action
    (False). `None` means "no filter" and returns an empty string, so the
    default feed is byte-identical to what it was before this filter existed.

    The 171 films with **no genre** are excluded from *both* sides. They are
    not known to be animated and not known to be live action, and silently
    handing them to one side would be a guess. `m.genre IS NOT NULL` is
    strictly redundant — `NOT (NULL ILIKE ...)` is NULL and would drop them
    anyway — but it is written out so the choice is visible at the call site
    rather than buried in three-valued-logic. In practice it changes nothing on
    this endpoint: all 171 also have a NULL `difficulty_score` (prod,
    2026-08-23), so the level predicate already drops them one line above.

    The genre literal is a constant; `animated` only selects which of two
    fixed fragments is returned, so nothing caller-controlled reaches the SQL.
    """
    if animated is None:
        return ""
    if animated:
        return f"\n              AND {_ANIMATION_MATCH}"
    return (
        "\n              AND m.genre IS NOT NULL"
        f"\n              AND NOT ({_ANIMATION_MATCH})"
    )


# The projection + the predicates every /by-cefr variant shares. Filters are
# appended as fragments (see `_animation_filter_sql`, `_exclude_seen_sql`)
# rather than by copying the whole statement per combination: `genre` and
# `animated` are independent, so branching would mean four near-identical
# 45-line queries drifting apart.
_BY_CEFR_SELECT = """
            SELECT m.id                AS movie_id,
                   m.title             AS title,
                   m.year              AS year,
                   m.poster_url        AS poster_url,
                   m.description       AS description,
                   m.backdrop_corner_rgb AS backdrop_corner_rgb,
                   m.difficulty_score  AS difficulty_score,
                   m.tmdb_id           AS tmdb_id,
                   m.tmdb_vote_average AS vote_average,
                   m.tmdb_vote_count   AS vote_count,
                   (
                     SELECT COUNT(DISTINCT wc.lemma)
                     FROM movie_scripts ms
                     JOIN word_classifications wc ON wc.script_id = ms.id
                     WHERE ms.movie_id = m.id
                   )                   AS unique_words,
                   (
                     SELECT jsonb_object_agg(level, cnt)
                     FROM (
                       SELECT wc.cefr_level::text AS level,
                              COUNT(*) AS cnt
                       FROM movie_scripts ms
                       JOIN word_classifications wc ON wc.script_id = ms.id
                       WHERE ms.movie_id = m.id
                       GROUP BY wc.cefr_level
                     ) sub
                   )                   AS cefr_distribution
            FROM movies m
            WHERE m.difficulty_score >= $1
              AND m.difficulty_score <= $2
              AND COALESCE(m.tmdb_vote_count, 0) >= 50"""


@router.get("/by-cefr")
async def list_movies_by_cefr(
    level: str = Query(..., description="CEFR level: A1, A2, B1, B2, C1, C2"),
    genre: Optional[str] = Query(None, description="Genre name to filter by (e.g. Drama, Comedy)"),
    animated: Optional[bool] = Query(
        None,
        description=(
            "Animation filter: true = animated films only, false = live action "
            "only, omitted = both (the default feed). Films with no genre "
            "recorded are excluded from both filtered views."
        ),
    ),
    limit: int = Query(15, ge=1, le=100),
    offset: int = Query(0, ge=0, description="Pagination offset for infinite scroll"),
    sort: str = Query(
        "recommended",
        description="Sort key: recommended | rating | popularity | level",
    ),
    order: str = Query("desc", description="Sort direction: asc | desc"),
    seed: Optional[int] = Query(
        None,
        description=(
            "Which recommendation draw to page through (sort=recommended only). "
            "Omit on the first page — the response carries the seed that was "
            "used — then send it back on every subsequent page. Ignored by the "
            "column sorts."
        ),
    ),
    db: Prisma = Depends(get_db),
    current_user=Depends(get_current_user_optional),
):
    """List movies whose difficulty score falls within a CEFR level range, optionally filtered by genre.

    Paginated for infinite scroll: pass `offset` to fetch the next page. The
    response includes `has_more` so the client knows whether to keep loading.
    Filtering happens here rather than in the client because the feed is
    paginated: narrowing a fetched page in JS would return short pages and miss
    every match past the page boundary.

    Optional auth: when a valid token is supplied, movies the user has marked
    "watched" or "not interested" (swipe actions on the home feed) are excluded
    server-side so they never resurface and pagination stays consistent.
    Anonymous callers get the unfiltered feed. That exclusion applies to
    `sort=recommended` too, so a rotation never re-serves a film the user
    already swiped away.
    """
    key = normalize_level(level)
    if key is None:
        raise HTTPException(status_code=400, detail=f"Invalid CEFR level: {level}")

    sort_key = sort.lower()
    recommended = sort_key == "recommended"
    sort_col = CEFR_SORT_COLUMNS.get(sort_key)
    if sort_col is None and not recommended:
        raise HTTPException(status_code=400, detail=f"Invalid sort: {sort}")
    direction = "ASC" if order.lower() == "asc" else "DESC"
    # Over-fetch by one row to detect whether another page exists, then trim.
    fetch_limit = limit + 1

    lo, hi = score_range_for_cefr(key)

    # Personalized exclusion: drop the caller's watched / not-interested
    # movies. `user_id` is None for anonymous callers, and the clause is a
    # no-op in that case ($p::int IS NULL), so the same SQL serves both.
    user_id = current_user.id if current_user else None

    # Positional placeholders are numbered as the params list grows, so an
    # optional filter can be dropped in without renumbering everything after
    # it — which is what made the old two-branch copy hard to extend.
    params: List[Any] = [lo, hi]
    filters = ""

    if genre:
        params.append(genre)
        filters += (
            "\n              AND m.genre IS NOT NULL"
            f"\n              AND m.genre ILIKE '%' || ${len(params)} || '%'"
        )

    filters += _animation_filter_sql(animated)

    active_seed: Optional[int] = None

    if recommended:
        # A caller paging through an existing draw sends its seed back; a first
        # page does not, and gets the current window. Deriving it per request
        # is what makes the rotation free of any stored state.
        active_seed = seed if seed is not None else current_seed()
        # Bound as text, not as an int, so the parameter's type is unambiguous
        # to the query engine — it is only ever concatenated into a hash input.
        params.append(str(active_seed))
        # Quality tier first, then the shuffle within it. Hashing (id, seed) is
        # a permutation: fixed for a given seed, so the three pages a user
        # scrolls are slices of ONE ordering, and unrelated to the next seed's.
        # The seed is a bound parameter, never interpolated — it arrives
        # straight off the query string.
        order_by = (
            f"ORDER BY {_RECOMMENDED_TIER_SQL} ASC,"
            f"\n              md5(m.id::text || '-' || ${len(params)}::text) ASC,"
            "\n              m.id ASC"
        )
    else:
        # `m.id ASC` is a stable tiebreaker — without it, rows with equal sort
        # values can shuffle between pages and cause OFFSET pagination to skip
        # or duplicate movies.
        order_by = f"ORDER BY {sort_col} {direction} NULLS LAST, m.id ASC"

    params.append(fetch_limit)
    limit_ph = f"${len(params)}"
    params.append(offset)
    offset_ph = f"${len(params)}"
    params.append(user_id)
    user_ph = f"${len(params)}"

    rows = await db.query_raw(
        _BY_CEFR_SELECT
        + filters
        + _exclude_seen_sql(user_ph)
        + order_by
        + f"\n            LIMIT {limit_ph} OFFSET {offset_ph}\n",
        *params,
    )

    has_more = len(rows) > limit
    rows = rows[:limit]

    return {
        "level": key,
        # Null on the column sorts: they are not draws and have nothing to
        # page consistently through or to expire.
        "seed": active_seed,
        "next_rotation_at": next_rotation_at(active_seed) if recommended else None,
        "movies": [
            {
                "movie_id": r["movie_id"],
                "tmdb_id": r["tmdb_id"],
                "title": r["title"],
                "year": r["year"],
                "poster_url": r["poster_url"],
                "description": r["description"],
                # #115: the colour under the card's add glyph, as [r, g, b].
                # Stored packed (see services/backdrop_ink.py); null for a movie
                # with no usable backdrop, which the card already renders as
                # gold + halo. Only this feed carries it — /by-level is
                # onboarding's "pick your first film" list and draws no card.
                "backdrop_corner_rgb": unpack_rgb(r.get("backdrop_corner_rgb")),
                "difficulty_score": r["difficulty_score"],
                "vote_average": r["vote_average"],
                "vote_count": r["vote_count"],
                "unique_words": r.get("unique_words"),
                "cefr_distribution": (
                    json.loads(r["cefr_distribution"])
                    if isinstance(r.get("cefr_distribution"), str)
                    else r.get("cefr_distribution")
                ),
            }
            for r in rows
        ],
        "total": len(rows),
        "offset": offset,
        "has_more": has_more,
    }


@router.get("/ready-to-watch")
async def ready_to_watch(
    limit: int = Query(5, ge=1, le=20),
    floor_pct: int = Query(40, ge=0, le=100),
    current_user=Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """v0.6: "movies you can probably understand now" — the discovery
    surface that ties learned vocab back to movie recommendations.

    Ranks movies the user does NOT already have in their reel by
    `UserMovieProgress.comprehensibility_percent` desc, excluding
    already-mastered titles. Floors at `floor_pct` so we don't surface
    rows with near-empty matches.

    Returns a thin payload — the client looks up posters/year via the
    existing reel-add flow when the user taps "Add to reel".

    NOTE: must be declared BEFORE `/{movie_id}` to avoid FastAPI
    treating "ready-to-watch" as an int path parameter (→ 422).
    """
    rows = await db.query_raw(
        """
        SELECT
          m.id           AS movie_id,
          m.tmdb_id      AS tmdb_id,
          m.title        AS title,
          m.poster_url   AS poster_url,
          m.year         AS year,
          ump.comprehensibility_percent AS pct,
          ump.status::text              AS status
        FROM user_movie_progress ump
        JOIN movies m ON m.id = ump.movie_id
        WHERE ump.user_id = $1
          AND ump.status::text <> 'mastered'
          AND ump.comprehensibility_percent >= $2
          AND m.tmdb_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM user_reel_movies urm
              WHERE urm.user_id = $1
                AND urm.tmdb_id = m.tmdb_id
          )
        ORDER BY ump.comprehensibility_percent DESC
        LIMIT $3
        """,
        current_user.id, float(floor_pct), limit,
    )

    return {
        "movies": [
            {
                "movie_id": r["movie_id"],
                "tmdb_id": r["tmdb_id"],
                "title": r["title"],
                "poster_url": r["poster_url"],
                "year": r["year"],
                "comprehensibility_percent": round(r["pct"]),
                "status": r["status"],
            }
            for r in rows
        ],
        "floor_pct": floor_pct,
        "total": len(rows),
    }


# ─── Home-feed swipe actions: Watched list + Not-interested ───────────────
# Swipe right on a home-feed card = "I've seen it" → the Watched list.
# Swipe left = "not interested" → hidden. Both are excluded from /by-cefr so
# they never resurface. Declared BEFORE `/{movie_id}` so "watched"/"hidden"
# aren't parsed as an int movie id (same reason as /ready-to-watch above).
class WatchedMovieRequest(BaseModel):
    tmdb_id: int
    title: str
    poster_path: Optional[str] = None
    year: Optional[int] = None


class WatchedMovie(BaseModel):
    tmdb_id: int
    title: str
    poster_path: Optional[str] = None
    year: Optional[int] = None


class WatchedListResponse(BaseModel):
    movies: List[WatchedMovie]


class HideMovieRequest(BaseModel):
    tmdb_id: int


class HiddenIdsResponse(BaseModel):
    tmdb_ids: List[int]


@router.get("/watched", response_model=WatchedListResponse)
async def list_watched(
    db: Prisma = Depends(get_db),
    user=Depends(get_current_active_user),
):
    """The user's Watched list, most-recently-marked first. Title/poster/year
    are denormalized on the row so this renders without TMDB roundtrips."""
    rows = await db.userwatchedmovie.find_many(
        where={"userId": user.id},
        order={"watchedAt": "desc"},
    )
    return WatchedListResponse(
        movies=[
            WatchedMovie(
                tmdb_id=r.tmdbId,
                title=r.title,
                poster_path=r.posterPath,
                year=r.year,
            )
            for r in rows
        ]
    )


@router.post("/watched", response_model=WatchedMovie)
async def mark_watched(
    body: WatchedMovieRequest,
    db: Prisma = Depends(get_db),
    user=Depends(get_current_active_user),
):
    """Mark a movie as watched (swipe right). Idempotent upsert; also clears
    any prior "not interested" row so a movie is never in both sets."""
    await db.userhiddenmovie.delete_many(
        where={"userId": user.id, "tmdbId": body.tmdb_id}
    )
    row = await db.userwatchedmovie.upsert(
        where={"userId_tmdbId": {"userId": user.id, "tmdbId": body.tmdb_id}},
        data={
            "create": {
                "userId": user.id,
                "tmdbId": body.tmdb_id,
                "title": body.title,
                "posterPath": body.poster_path,
                "year": body.year,
            },
            "update": {
                "title": body.title,
                "posterPath": body.poster_path,
                "year": body.year,
            },
        },
    )
    return WatchedMovie(
        tmdb_id=row.tmdbId,
        title=row.title,
        poster_path=row.posterPath,
        year=row.year,
    )


@router.delete("/watched/{tmdb_id}", status_code=204)
async def unmark_watched(
    tmdb_id: int,
    db: Prisma = Depends(get_db),
    user=Depends(get_current_active_user),
):
    """Remove a movie from the Watched list (undo). Idempotent — a repeated
    undo is a no-op rather than a 404."""
    await db.userwatchedmovie.delete_many(
        where={"userId": user.id, "tmdbId": tmdb_id}
    )
    return None


@router.post("/hidden", status_code=204)
async def hide_movie(
    body: HideMovieRequest,
    db: Prisma = Depends(get_db),
    user=Depends(get_current_active_user),
):
    """Mark a movie "not interested" (swipe left). Idempotent."""
    existing = await db.userhiddenmovie.find_unique(
        where={"userId_tmdbId": {"userId": user.id, "tmdbId": body.tmdb_id}}
    )
    if existing is None:
        await db.userhiddenmovie.create(
            data={"userId": user.id, "tmdbId": body.tmdb_id}
        )
    return None


@router.get("/hidden", response_model=HiddenIdsResponse)
async def list_hidden(
    db: Prisma = Depends(get_db),
    user=Depends(get_current_active_user),
):
    """The user's hidden ("not interested") tmdb ids. The web home feed
    (TMDB top-rated, not the CEFR query) filters these client-side, so it
    needs the raw id set; the mobile CEFR feed excludes them in SQL instead."""
    rows = await db.userhiddenmovie.find_many(where={"userId": user.id})
    return HiddenIdsResponse(tmdb_ids=[r.tmdbId for r in rows])


@router.delete("/hidden/{tmdb_id}", status_code=204)
async def unhide_movie(
    tmdb_id: int,
    db: Prisma = Depends(get_db),
    user=Depends(get_current_active_user),
):
    """Un-hide a movie (undo the not-interested swipe). Idempotent."""
    await db.userhiddenmovie.delete_many(
        where={"userId": user.id, "tmdbId": tmdb_id}
    )
    return None


@router.get("/{movie_id}", response_model=MovieResponse)
async def get_movie(movie_id: int, response: Response, db: Prisma = Depends(get_db)):
    """Get a specific movie by ID"""
    movie = await db.movie.find_unique(where={"id": movie_id})

    if not movie:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Movie not found"
        )

    response.headers["Cache-Control"] = _MOVIE_DETAIL_CACHE
    return movie


@router.get("/{movie_id}/difficulty")
async def get_movie_difficulty(movie_id: int, response: Response, db: Prisma = Depends(get_db)):
    import json

    movie = await db.movie.find_unique(where={"id": movie_id})

    if not movie:
        raise HTTPException(status_code=404, detail="Movie not found")

    # Parse cefrDistribution if it's a JSON string
    breakdown = {}
    if movie.cefrDistribution:
        if isinstance(movie.cefrDistribution, str):
            breakdown = json.loads(movie.cefrDistribution)
        else:
            breakdown = movie.cefrDistribution

    response.headers["Cache-Control"] = _MOVIE_DETAIL_CACHE
    return {
        # #103: this used to bucket the score on its own boundaries, one band
        # off from the home feed, so the same film could read B1 on the shelf
        # and B2 on its detail screen.
        "difficulty_level": cefr_from_score(movie.difficultyScore),
        "difficulty_score": movie.difficultyScore,
        "breakdown": breakdown
    }


@router.post("/", response_model=MovieResponse, status_code=status.HTTP_201_CREATED)
async def create_movie(
    movie_data: MovieCreate,
    current_user = Depends(get_admin_user),
    db: Prisma = Depends(get_db)
):
    """Create a new movie (admin only).

    #102: the docstring used to say "admin only for now" over a TODO and a
    plain `get_current_active_user`, so any signed-in account could write a
    row — and, through the old `script_text` field, arbitrary-length text
    into the movies table. Both are fixed here: the guard is real, and the
    field is gone.
    """
    new_movie = await db.movie.create(
        data={
            "title": movie_data.title,
            "year": movie_data.year,
            "genre": movie_data.genre,
            "description": movie_data.description,
            "poster_url": movie_data.poster_url
        }
    )

    return new_movie


@router.get("/{movie_id}/vocabulary/preview")
async def get_vocabulary_preview(
    movie_id: int,
    response: Response,
    db: Prisma = Depends(get_db),
    _: None = Depends(_vocab_preview_throttle),
) -> Dict[str, Any]:
    """
    Get a preview of the movie vocabulary (PUBLIC - no auth required).
    Returns sample words from each CEFR level (3 per level), no translations.
    """
    # Check if movie exists
    movie = await db.movie.find_unique(where={"id": movie_id})
    if not movie:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Movie not found"
        )

    # Get script for this movie
    script = await db.moviescript.find_first(where={"movieId": movie_id})
    if not script:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Script not found for this movie"
        )

    # Get all word classifications
    all_words = await db.wordclassification.find_many(
        where={"scriptId": script.id},
        order={'confidence': 'desc'}
    )

    hidden = await get_hidden_word_set(
        db, (form for w in all_words for form in (w.word, w.lemma))
    )

    # Group by level and take first 3 from each
    top_words_by_level: Dict[str, List[Dict[str, Any]]] = {}
    level_distribution: Dict[str, int] = {"A1": 0, "A2": 0, "B1": 0, "B2": 0, "C1": 0, "C2": 0}

    for word in all_words:
        if word.word.lower() in hidden or (word.lemma or "").lower() in hidden:
            continue
        if is_profane_entry(word.word, word.lemma):
            continue
        if is_internationalism_entry(word.word, word.lemma):
            continue
        level = word.cefrLevel if isinstance(word.cefrLevel, str) else word.cefrLevel.value
        # Words the classifier could not place (#91) are not a band and are
        # not taught. This loop predates should_keep_word and inlines its
        # filters, so it needs the check spelled out too.
        if level == "UNKNOWN":
            continue
        level_distribution[level] = level_distribution.get(level, 0) + 1

        if level not in top_words_by_level:
            top_words_by_level[level] = []
        if len(top_words_by_level[level]) < 3:
            top_words_by_level[level].append({
                # Display the lemma, not the inflected surface form
                # ("stakeholders" row renders as "stakeholder").
                "word": display_form(word.word, word.lemma),
                "lemma": word.lemma,
                "confidence": word.confidence,
                "frequency_rank": word.frequencyRank
            })

    # Idioms: a stored column read for every script that has been parsed once
    # (issue #106). Only a never-parsed script reaches spaCy here, and when it
    # does, the queue slot below still applies — under load, shed the parse and
    # return the word list without idioms. A fast partial answer beats a 90s wait.
    idioms = []
    idioms_unavailable = False
    try:
        idioms = await get_script_idioms(
            db, script, max_pending=MAX_PENDING_PREVIEW_PARSES
        )
    except NLPOverloaded:
        logger.warning(
            "movie %s: NLP queue full, serving preview without idioms", movie_id
        )
        idioms_unavailable = True
    except Exception:
        logger.exception("Error detecting idioms")
        idioms = []

    # Only the complete answer is cacheable. When the NLP queue shed the parse
    # above we served the word list without idioms on purpose — pinning that
    # degraded body for an hour would turn a one-off shed into an hour of
    # movies that look like they have no idioms at all.
    if not idioms_unavailable:
        response.headers["Cache-Control"] = _VOCAB_PREVIEW_CACHE

    return {
        "movie_id": movie_id,
        "idioms_unavailable": idioms_unavailable,
        "total_words": len(all_words),
        "unique_words": len(all_words),
        "level_distribution": level_distribution,
        "top_words_by_level": top_words_by_level,
        "average_confidence": sum(w.confidence for w in all_words) / len(all_words) if all_words else 0,
        "wordlist_coverage": 0.0,
        "idioms": idioms,
        "preview": True
    }


@router.get("/{movie_id}/vocabulary/full")
async def get_vocabulary_full(
    movie_id: int,
    current_user = Depends(get_current_active_user),
    db: Prisma = Depends(get_db)
) -> Dict[str, Any]:
    """
    Get the complete movie vocabulary.
    Returns all words with CEFR levels, supports translations.
    """
    # Check if movie exists
    movie = await db.movie.find_unique(where={"id": movie_id})
    if not movie:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Movie not found"
        )

    # Get script for this movie
    script = await db.moviescript.find_first(where={"movieId": movie_id})
    if not script:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Script not found for this movie"
        )

    # Get all word classifications
    cefr_words = await db.wordclassification.find_many(
        where={"scriptId": script.id},
        order={'confidence': 'desc'}
    )

    hidden = await get_hidden_word_set(
        db, (form for w in cefr_words for form in (w.word, w.lemma))
    )

    from src.routes.cefr import should_keep_word

    # Group by level, filtering ultra-common A1 words
    top_words_by_level: Dict[str, List[Dict[str, Any]]] = {}
    level_distribution: Dict[str, int] = {"A1": 0, "A2": 0, "B1": 0, "B2": 0, "C1": 0, "C2": 0}

    # On-the-fly rank fill for classifications stored before ranks were kept
    # (6.2% of `word_classifications` have one); without it the client-side
    # common/rare sort is a no-op for most words. Measured at 0.005ms a word —
    # ~3ms for the largest script — which is cheaper than the round trip a
    # lookup table would cost, so #137's backfill went to `lemmas` (which the
    # SRS and quiz orderings read) and this stayed. Same formula either way.
    from ..utils.word_frequency import frequency_rank

    _rank_cache: Dict[str, Optional[int]] = {}

    def _compute_rank(token: str) -> Optional[int]:
        key = token.lower()
        if key not in _rank_cache:
            _rank_cache[key] = frequency_rank(key)
        return _rank_cache[key]

    for word in cefr_words:
        if word.word.lower() in hidden or (word.lemma or "").lower() in hidden:
            continue
        level = word.cefrLevel if isinstance(word.cefrLevel, str) else word.cefrLevel.value

        if not should_keep_word(word.word, word.lemma, level):
            continue

        level_distribution[level] = level_distribution.get(level, 0) + 1

        rank = word.frequencyRank
        if rank is None:
            rank = _compute_rank(word.lemma or word.word)

        if level not in top_words_by_level:
            top_words_by_level[level] = []
        top_words_by_level[level].append({
            # Display the lemma, not the inflected surface form
            # ("stakeholders" row renders as "stakeholder").
            "word": display_form(word.word, word.lemma),
            "lemma": word.lemma,
            "confidence": word.confidence,
            "frequency_rank": rank
        })

    for level in top_words_by_level:
        # Default: least common first. higher frequency_rank = rarer word.
        # Words without rank data go to the end.
        top_words_by_level[level].sort(
            key=lambda x: (x['frequency_rank'] is None, -(x['frequency_rank'] or 0)),
        )

    import logging
    log = logging.getLogger("uvicorn.error")
    log.info(f"[VOCAB-FULL] movie_id={movie_id} script_id={script.id} title={movie.title!r} dist={level_distribution}")

    # Idioms: stored per script, parsed at most once (issue #106).
    idioms = []
    try:
        idioms = await get_script_idioms(db, script)
    except Exception:
        logger.exception("Error detecting idioms")
        idioms = []

    return {
        "movie_id": movie_id,
        "script_id": 0,
        "total_words": len(cefr_words),
        "unique_words": len(cefr_words),
        "level_distribution": level_distribution,
        "top_words_by_level": top_words_by_level,
        "average_confidence": sum(w.confidence for w in cefr_words) / len(cefr_words) if cefr_words else 0,
        "wordlist_coverage": 0.0,
        "idioms": idioms,
        "preview": False
    }


