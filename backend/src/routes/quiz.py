"""
Quiz / gamification endpoints.

Flow:
  1. POST /quiz/sessions    — pick words, build cards, open session.
  2. POST /quiz/sessions/{id}/cards — batch-submit card results.
  3. POST /quiz/sessions/{id}/complete — finalize: stars, xp, rollups.
  4. GET  /quiz/movies/{movie_id}/units — journey screen state.
  5. POST /quiz/pre-movie/{movie_id} — shortcut: 10-card pre-movie quiz.
  6. GET  /quiz/leaderboard / leaderboard/me — rankings tab.

Pure logic (card selection, star/xp math) lives in services/quiz_service.py
so it's unit-testable without a DB. This file is orchestration only.
"""
from __future__ import annotations

import logging
import random
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from prisma import Prisma
from pydantic import BaseModel, Field

from ..database import get_db
from ..middleware.auth import get_current_active_user
from ..services.quiz_service import (
    CARDS_PER_SESSION,
    CardSpec,
    compute_stars,
    compute_xp,
    is_unit_unlocked,
    pick_card_types,
)
from ..services.translation_service import TranslationService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/quiz", tags=["quiz"])

LEVEL_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"]


# --- Request / response schemas -------------------------------------------

class StartSessionRequest(BaseModel):
    movie_id: int
    level: str = Field(..., pattern=r"^(A1|A2|B1|B2|C1|C2)$")
    kind: str = Field("unit", pattern=r"^(unit|pre_movie|batch)$")


class StartBatchSessionRequest(BaseModel):
    movie_ids: List[int] = Field(..., min_length=1)
    level: str = Field(..., pattern=r"^(A1|A2|B1|B2|C1|C2)$")
    kind: str = Field("batch", pattern=r"^(unit|pre_movie|batch)$")


class StartJourneySessionRequest(BaseModel):
    level: str = Field(..., pattern=r"^(A1|A2|B1|B2|C1|C2)$")
    tile_index: int = Field(..., ge=0)
    words_per_tile: int = Field(5, ge=1, le=20)


class CardPayload(BaseModel):
    word: str
    card_type: str  # "type" | "self_rate"
    translation: Optional[str] = None


class StartSessionResponse(BaseModel):
    session_id: int
    cards: List[CardPayload]


class CardResultPayload(BaseModel):
    word: str
    card_type: str  # "type" | "self_rate"
    is_correct: Optional[bool] = None
    self_rating: Optional[str] = Field(None, pattern=r"^(know|kinda|dont)$")
    answer_ms: int


class SubmitCardsRequest(BaseModel):
    results: List[CardResultPayload]


class CompleteSessionResponse(BaseModel):
    stars: int
    xp_earned: int
    correct_count: int
    total_scored: int


class UnitStatePayload(BaseModel):
    level: str
    word_count: int
    best_stars: int
    attempts: int
    locked: bool


class LeaderboardEntry(BaseModel):
    user_id: int
    username: str
    profile_picture_url: Optional[str] = None
    total_stars: int
    xp: int
    retention_score: float
    rank: int


# --- Internal helpers ------------------------------------------------------

async def _load_level_word_pool(
    db: Prisma, movie_id: int, level: str
) -> List[str]:
    """All classified words for this movie at this CEFR level, excluding
    admin-hidden words. De-duped, lowercased at the boundary so distractor
    selection doesn't show 'Target' and 'target' as two options."""
    script = await db.moviescript.find_first(where={"movieId": movie_id})
    if not script:
        return []
    classifications = await db.wordclassification.find_many(
        where={"scriptId": script.id, "cefrLevel": level}
    )
    hidden_rows = await db.hiddenword.find_many()
    hidden = {h.word for h in hidden_rows}
    seen: set[str] = set()
    words: List[str] = []
    for c in classifications:
        w = c.word
        k = w.lower()
        if k in hidden or k in seen:
            continue
        seen.add(k)
        words.append(w)
    return words


async def _translate_words(
    db: Prisma, words: List[str], target_lang: str, user_id: int
) -> Dict[str, str]:
    """Batch-translate. Return {word: translation}. On error, the word is
    omitted from the map — the caller substitutes the source word so the
    card is still playable."""
    if not words or not target_lang or target_lang.lower() == "en":
        return {}
    try:
        service = TranslationService(db)
        results = await service.batch_translate(
            texts=words,
            target_lang=target_lang,
            source_lang="en",
            user_id=user_id,
        )
        out: Dict[str, str] = {}
        for w, r in zip(words, results):
            if "error" in r:
                continue
            t = r.get("translated") or r.get("translation")
            if t and t.lower() != w.lower():
                out[w] = t
        return out
    except Exception as e:
        logger.warning(f"[QUIZ] Batch translate failed, falling back: {e}")
        return {}


def _build_cards(
    answers: List[str],
    pool: List[str],
    translations: Dict[str, str],
    *,
    rng: Optional[random.Random] = None,
) -> List[CardSpec]:
    """Compose the card deck. Typed cards require a translation (the user
    types it back). If we don't have one, the slot falls back to self_rate
    so the session length stays fixed."""
    del pool  # no longer needed (distractors removed with MCQ)
    r = rng or random.Random()
    types = pick_card_types(total=len(answers), rng=r)
    cards: List[CardSpec] = []
    for word, card_type in zip(answers, types):
        translation = translations.get(word)
        if card_type == "type" and translation:
            cards.append(CardSpec(
                word=word, card_type="type", translation=translation,
            ))
            continue
        # Self-rate path: either by design, or because no translation is
        # available to score a typed answer against.
        cards.append(CardSpec(
            word=word, card_type="self_rate", translation=translation,
        ))
    return cards


# --- Endpoints -------------------------------------------------------------

@router.post("/sessions", response_model=StartSessionResponse)
async def start_session(
    body: StartSessionRequest,
    current_user = Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    pool = await _load_level_word_pool(db, body.movie_id, body.level)
    if not pool:
        raise HTTPException(
            status_code=404,
            detail=f"No words available for movie {body.movie_id} at level {body.level}",
        )

    rng = random.Random()
    answers = rng.sample(pool, min(CARDS_PER_SESSION, len(pool)))
    # The user types the translation, so we fetch their native language
    # (falls back to learning language, then "es" if neither is set).
    target_lang = (current_user.nativeLanguage or current_user.learningLanguage or "es").lower()
    translations = await _translate_words(db, answers, target_lang, current_user.id)

    cards = _build_cards(answers, pool, translations, rng=rng)

    session = await db.quizsession.create(data={
        "userId": current_user.id,
        "movieId": body.movie_id,
        "cefrLevel": body.level,
        "kind": body.kind,
    })

    return StartSessionResponse(
        session_id=session.id,
        cards=[CardPayload(**c.__dict__) for c in cards],
    )


@router.post("/sessions/{session_id}/cards")
async def submit_cards(
    session_id: int,
    body: SubmitCardsRequest,
    current_user = Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    session = await db.quizsession.find_unique(where={"id": session_id})
    if not session or session.userId != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.completedAt is not None:
        raise HTTPException(status_code=400, detail="Session already completed")

    await db.quizcardresult.create_many(data=[
        {
            "sessionId": session_id,
            "word": r.word,
            "cardType": r.card_type,
            "isCorrect": r.is_correct,
            "selfRating": r.self_rating,
            "answerMs": r.answer_ms,
        }
        for r in body.results
    ])
    return {"stored": len(body.results)}


@router.post("/sessions/{session_id}/complete", response_model=CompleteSessionResponse)
async def complete_session(
    session_id: int,
    current_user = Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    session = await db.quizsession.find_unique(where={"id": session_id})
    if not session or session.userId != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.completedAt is not None:
        # Idempotent — return the stored result.
        return CompleteSessionResponse(
            stars=session.stars or 0,
            xp_earned=0,
            correct_count=session.correctCount,
            total_scored=session.totalScored,
        )

    cards = await db.quizcardresult.find_many(where={"sessionId": session_id})
    # Historical rows may say "mcq" — count both, they're scored the same way.
    scored_cards = [c for c in cards if c.cardType in ("type", "mcq")]
    correct = sum(1 for c in scored_cards if c.isCorrect)
    total_scored = len(scored_cards)
    self_rate_count = sum(1 for c in cards if c.cardType == "self_rate")
    stars = compute_stars(correct, total_scored)
    xp = compute_xp(correct, self_rate_count, stars)

    # Finalize session.
    from datetime import datetime, timezone
    await db.quizsession.update(
        where={"id": session_id},
        data={
            "completedAt": datetime.now(timezone.utc),
            "stars": stars,
            "correctCount": correct,
            "totalScored": total_scored,
        },
    )

    # Unit progress (high-water mark). Upsert avoids a race on first attempt.
    # "batch" sessions store progress under sentinel movieId=-1; "unit" stores
    # under the actual movieId; "pre_movie" never updates progress.
    progress_movie_id: Optional[int] = None
    if session.kind == "unit" and session.movieId is not None:
        progress_movie_id = session.movieId
    elif session.kind == "batch":
        progress_movie_id = -1

    if progress_movie_id is not None:
        existing = await db.unitprogress.find_unique(where={
            "userId_movieId_cefrLevel": {
                "userId": current_user.id,
                "movieId": progress_movie_id,
                "cefrLevel": session.cefrLevel,
            }
        })
        if existing:
            await db.unitprogress.update(
                where={
                    "userId_movieId_cefrLevel": {
                        "userId": current_user.id,
                        "movieId": progress_movie_id,
                        "cefrLevel": session.cefrLevel,
                    }
                },
                data={
                    "bestStars": max(existing.bestStars, stars),
                    "attempts": existing.attempts + 1,
                },
            )
        else:
            await db.unitprogress.create(data={
                "userId": current_user.id,
                "movieId": progress_movie_id,
                "cefrLevel": session.cefrLevel,
                "bestStars": stars,
                "attempts": 1,
            })

    # User rollup stats.
    stats = await db.userquizstats.find_unique(where={"userId": current_user.id})
    if stats:
        new_total_sessions = stats.totalSessions + 1
        new_total_stars = stats.totalStars + stars
        # Running average: (old_avg * old_n + new_accuracy) / new_n
        new_accuracy = (correct / total_scored) if total_scored else 0.0
        new_avg = (stats.avgAccuracy * stats.totalSessions + new_accuracy) / new_total_sessions
        await db.userquizstats.update(
            where={"userId": current_user.id},
            data={
                "totalStars": new_total_stars,
                "totalSessions": new_total_sessions,
                "avgAccuracy": new_avg,
                "xp": stats.xp + xp,
                "lastActiveAt": datetime.now(timezone.utc),
            },
        )
    else:
        await db.userquizstats.create(data={
            "userId": current_user.id,
            "totalStars": stars,
            "totalSessions": 1,
            "avgAccuracy": (correct / total_scored) if total_scored else 0.0,
            "xp": xp,
        })

    return CompleteSessionResponse(
        stars=stars, xp_earned=xp,
        correct_count=correct, total_scored=total_scored,
    )


@router.get("/movies/{movie_id}/units", response_model=List[UnitStatePayload])
async def get_movie_units(
    movie_id: int,
    current_user = Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """Journey-screen state: each CEFR level's word count, best stars, attempts,
    and whether it's unlocked (previous level must have been attempted)."""
    script = await db.moviescript.find_first(where={"movieId": movie_id})
    if not script:
        return []

    # Count words per level for this movie.
    classifications = await db.wordclassification.find_many(
        where={"scriptId": script.id}
    )
    hidden_rows = await db.hiddenword.find_many()
    hidden = {h.word for h in hidden_rows}
    counts: Dict[str, int] = {lv: 0 for lv in LEVEL_ORDER}
    for c in classifications:
        level = c.cefrLevel if isinstance(c.cefrLevel, str) else c.cefrLevel.value
        if c.word.lower() in hidden:
            continue
        if level in counts:
            counts[level] += 1

    # Pull this user's per-level progress for this movie.
    progress_rows = await db.unitprogress.find_many(
        where={"userId": current_user.id, "movieId": movie_id}
    )
    by_level = {p.cefrLevel: p for p in progress_rows}
    attempted = {lv for lv, p in by_level.items() if p.attempts > 0}

    out: List[UnitStatePayload] = []
    for level in LEVEL_ORDER:
        if counts[level] == 0:
            continue
        p = by_level.get(level)
        out.append(UnitStatePayload(
            level=level,
            word_count=counts[level],
            best_stars=p.bestStars if p else 0,
            attempts=p.attempts if p else 0,
            locked=not is_unit_unlocked(level, LEVEL_ORDER, attempted),
        ))
    return out


# --- Batch-journey endpoints ----------------------------------------------
# Multi-movie journey: pools words across 2+ movies so the journey has more
# to chew on. Unit progress is tracked *per level* (movieId=null) since there
# is no single movie to attribute stars to — the user picks a bag of movies.

async def _load_batch_pool(
    db: Prisma, movie_ids: List[int], level: str
) -> List[str]:
    """Union of word pools across the given movies at the given CEFR level.
    Deduplicates so a word appearing in three movies shows up once."""
    seen: set[str] = set()
    out: List[str] = []
    for mid in movie_ids:
        for w in await _load_level_word_pool(db, mid, level):
            k = w.lower()
            if k in seen:
                continue
            seen.add(k)
            out.append(w)
    return out


@router.get("/batch/units", response_model=List[UnitStatePayload])
async def get_batch_units(
    movie_ids: str = Query(..., description="Comma-separated movie IDs"),
    current_user = Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """Per-level word counts across multiple movies. Unit progress is read
    from the *-1 sentinel* movieId rows in UnitProgress (see start_batch_session)."""
    try:
        ids = [int(x) for x in movie_ids.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid movie_ids")
    if not ids:
        raise HTTPException(status_code=400, detail="movie_ids is required")

    counts: Dict[str, int] = {lv: 0 for lv in LEVEL_ORDER}
    for lvl in LEVEL_ORDER:
        pool = await _load_batch_pool(db, ids, lvl)
        counts[lvl] = len(pool)

    # Batch progress: stored under the sentinel movieId = -1. Not elegant, but
    # it avoids a new table; a batch journey is inherently ephemeral.
    progress_rows = await db.unitprogress.find_many(
        where={"userId": current_user.id, "movieId": -1}
    )
    by_level = {p.cefrLevel: p for p in progress_rows}
    attempted = {lv for lv, p in by_level.items() if p.attempts > 0}

    out: List[UnitStatePayload] = []
    for level in LEVEL_ORDER:
        if counts[level] == 0:
            continue
        p = by_level.get(level)
        out.append(UnitStatePayload(
            level=level,
            word_count=counts[level],
            best_stars=p.bestStars if p else 0,
            attempts=p.attempts if p else 0,
            locked=not is_unit_unlocked(level, LEVEL_ORDER, attempted),
        ))
    return out


@router.post("/batch/sessions", response_model=StartSessionResponse)
async def start_batch_session(
    body: StartBatchSessionRequest,
    current_user = Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """Start a 10-card session with words pooled from multiple movies.
    Session.movieId stays null (no single-movie attribution); unit progress
    is keyed on the sentinel movieId=-1 so the journey-screen 'best stars'
    for batch runs still work."""
    if not body.movie_ids:
        raise HTTPException(status_code=400, detail="movie_ids is required")

    pool = await _load_batch_pool(db, body.movie_ids, body.level)
    if not pool:
        raise HTTPException(
            status_code=404,
            detail=f"No words across these movies at level {body.level}",
        )

    rng = random.Random()
    answers = rng.sample(pool, min(CARDS_PER_SESSION, len(pool)))
    target_lang = (current_user.nativeLanguage or current_user.learningLanguage or "es").lower()
    translations = await _translate_words(db, answers, target_lang, current_user.id)
    cards = _build_cards(answers, pool, translations, rng=rng)

    session = await db.quizsession.create(data={
        "userId": current_user.id,
        "movieId": None,
        "cefrLevel": body.level,
        "kind": "batch",
    })

    return StartSessionResponse(
        session_id=session.id,
        cards=[CardPayload(**c.__dict__) for c in cards],
    )


@router.post("/pre-movie/{movie_id}", response_model=StartSessionResponse)
async def start_pre_movie_quiz(
    movie_id: int,
    current_user = Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """Shortcut: starts a 10-card session at max(user_level, movie_level).
    Kind is 'pre_movie' so it doesn't advance unit progress.

    Falls back to adjacent levels if the preferred level is empty — a movie
    can have zero words at the user's level but plenty at a nearby one.
    """
    movie = await db.movie.find_unique(where={"id": movie_id})
    if not movie:
        raise HTTPException(status_code=404, detail="Movie not found")

    user_level = current_user.proficiencyLevel
    user_level = user_level.value if hasattr(user_level, "value") else (user_level or "B1")
    movie_level = movie.difficultyLevel
    movie_level = movie_level.value if hasattr(movie_level, "value") else (movie_level or "B1")

    def _rank(level: str) -> int:
        return LEVEL_ORDER.index(level) if level in LEVEL_ORDER else 2

    # Pick the harder of the two as the primary target, then search outward
    # for a level that actually has words in this movie.
    primary = user_level if _rank(user_level) >= _rank(movie_level) else movie_level
    target_idx = _rank(primary)

    # Ordered candidate levels: primary, then one up, one down, two up, ...
    # Always returns *something* if any level has words.
    candidates: List[str] = [primary]
    for delta in range(1, len(LEVEL_ORDER)):
        for step in (target_idx - delta, target_idx + delta):
            if 0 <= step < len(LEVEL_ORDER):
                candidates.append(LEVEL_ORDER[step])

    for lvl in candidates:
        pool = await _load_level_word_pool(db, movie_id, lvl)
        if pool:
            return await start_session(
                body=StartSessionRequest(movie_id=movie_id, level=lvl, kind="pre_movie"),
                current_user=current_user,
                db=db,
            )

    # Nothing found. Give a precise reason so the user knows whether to wait
    # (classification in progress) or trigger it (script exists but not yet
    # analysed).
    script = await db.moviescript.find_first(where={"movieId": movie_id})
    if not script:
        detail = (
            "No script available for this movie yet. Open the movie and upload "
            "a script to enable quizzes."
        )
    else:
        any_class = await db.wordclassification.find_first(
            where={"scriptId": script.id}
        )
        if not any_class:
            detail = (
                "This movie's script hasn't been analysed yet. Open the movie "
                "to start vocabulary analysis, then try the quiz again."
            )
        else:
            detail = (
                "All vocabulary for this movie is currently hidden. Try another "
                "movie or unhide some words."
            )
    raise HTTPException(status_code=404, detail=detail)


@router.get("/leaderboard", response_model=List[LeaderboardEntry])
async def get_leaderboard(
    metric: str = Query("stars", pattern=r"^(stars|xp|retention)$"),
    limit: int = Query(50, ge=1, le=100),
    db: Prisma = Depends(get_db),
):
    """Global leaderboard. `metric` picks the sort key."""
    order_key = {
        "stars": "totalStars",
        "xp": "xp",
        "retention": "retentionScore",
    }[metric]
    stats = await db.userquizstats.find_many(
        order={order_key: "desc"},
        take=limit,
        include={"user": True},
    )
    entries: List[LeaderboardEntry] = []
    for rank, s in enumerate(stats, start=1):
        if s.user is None:
            continue
        entries.append(LeaderboardEntry(
            user_id=s.userId,
            username=s.user.username,
            profile_picture_url=s.user.profilePictureUrl,
            total_stars=s.totalStars,
            xp=s.xp,
            retention_score=s.retentionScore,
            rank=rank,
        ))
    return entries


@router.get("/leaderboard/me")
async def get_my_rank(
    metric: str = Query("stars", pattern=r"^(stars|xp|retention)$"),
    current_user = Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """Returns {rank, me, neighbors: [above, below]} for the given metric.
    rank=None if the user has no completed sessions yet."""
    field = {"stars": "totalStars", "xp": "xp", "retention": "retentionScore"}[metric]

    me_stats = await db.userquizstats.find_unique(
        where={"userId": current_user.id}, include={"user": True}
    )
    if not me_stats:
        return {"rank": None, "me": None, "neighbors": []}

    my_value = getattr(me_stats, field)
    higher_count = await db.userquizstats.count(where={field: {"gt": my_value}})
    rank = higher_count + 1

    # Pull 2 neighbors: rank-1 (one above) and rank+1 (one below).
    neighbors: List[Dict[str, Any]] = []
    if rank > 1:
        above = await db.userquizstats.find_many(
            where={field: {"gt": my_value}},
            order={field: "asc"},
            take=1,
            include={"user": True},
        )
        if above and above[0].user:
            neighbors.append({
                "rank": rank - 1,
                "user_id": above[0].userId,
                "username": above[0].user.username,
                "value": getattr(above[0], field),
            })
    below = await db.userquizstats.find_many(
        where={field: {"lt": my_value}},
        order={field: "desc"},
        take=1,
        include={"user": True},
    )
    if below and below[0].user:
        neighbors.append({
            "rank": rank + 1,
            "user_id": below[0].userId,
            "username": below[0].user.username,
            "value": getattr(below[0], field),
        })

    return {
        "rank": rank,
        "me": {
            "user_id": current_user.id,
            "username": me_stats.user.username if me_stats.user else "",
            "total_stars": me_stats.totalStars,
            "xp": me_stats.xp,
            "retention_score": me_stats.retentionScore,
        },
        "neighbors": neighbors,
    }


# --- Journey (level-global, frequency-sorted) ---------------------------------

async def _get_journey_words_at_level(
    db: Prisma, level: str, offset: int, limit: int
) -> List[str]:
    """Return `limit` unique words at `level`, sorted easiest-first by
    global frequency rank (lower rank = more common in the language =
    easier to learn). Words with no rank data go to the end.

    Deduplication is done across all movies: the same word can be
    classified in many scripts, so we pick the single occurrence with
    the best (lowest) frequencyRank and sort by that.
    """
    rows = await db.query_raw(
        """
        SELECT word, best_rank
        FROM (
            SELECT LOWER(word) AS word,
                   MIN(frequency_rank) AS best_rank
            FROM word_classifications
            WHERE cefr_level::text = $1
              AND word IS NOT NULL
              AND TRIM(word) <> ''
            GROUP BY LOWER(word)
        ) sub
        ORDER BY best_rank ASC NULLS LAST
        OFFSET $2 LIMIT $3
        """,
        level, offset, limit,
    )
    hidden_rows = await db.hiddenword.find_many()
    hidden = {h.word.lower() for h in hidden_rows}
    return [r["word"] for r in rows if r["word"].lower() not in hidden]


@router.post("/journey/sessions", response_model=StartSessionResponse)
async def start_journey_session(
    body: StartJourneySessionRequest,
    current_user = Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """Start a quiz session for one journey tile.

    Words are drawn from a global, cross-movie frequency-ranked list at
    the requested CEFR level. Tile 0 gets the 5 most common words at
    that level, tile 1 the next 5, and so on — so the user always
    progresses from easier to harder vocabulary as they climb the path.
    """
    offset = body.tile_index * body.words_per_tile
    words = await _get_journey_words_at_level(
        db, body.level, offset, body.words_per_tile
    )

    if not words:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No words available at level {body.level} for tile "
                f"{body.tile_index}. Either the level has fewer than "
                f"{offset + body.words_per_tile} classified words, or "
                f"none have been classified yet."
            ),
        )

    target_lang = (
        current_user.nativeLanguage
        or current_user.learningLanguage
        or "es"
    ).lower()
    translations = await _translate_words(db, words, target_lang, current_user.id)
    cards = _build_cards(words, [], translations)

    session = await db.quizsession.create(data={
        "userId": current_user.id,
        "movieId": None,
        "cefrLevel": body.level,
        "kind": "journey",
    })

    return StartSessionResponse(
        session_id=session.id,
        cards=[CardPayload(**c.__dict__) for c in cards],
    )
