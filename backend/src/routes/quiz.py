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
    build_translation_choices,
    compute_stars,
    compute_xp,
    is_unit_unlocked,
    pick_card_types,
    srs_outcome_for_card,
)
from ..services.movie_progress_service import recompute_for_user_movie
from ..services.sentence_bank_service import get_llm_examples_for_lemmas
from ..services.srs_engine import (
    advance_user_rollup_after_review,
    advance_word_after_review,
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
    # TMDB id of the active tile's movie. When provided AND the movie
    # has subtitle vocab on file, words are sourced from THAT movie's
    # top-frequency unknown lemmas in the user's CEFR ±1 band, with
    # SRS-due words bubbled in first. Falls back to the legacy
    # cross-movie offset-based pull when absent or empty.
    tmdb_id: Optional[int] = None


class QuizChoice(BaseModel):
    word: str
    is_correct: bool


class CardPayload(BaseModel):
    word: str
    card_type: str  # "mcq" | "self_rate"
    translation: Optional[str] = None
    # Present iff card_type is "mcq": 4 translation choices, exactly one
    # is_correct.
    choices: Optional[List[QuizChoice]] = None
    # Global LLM-authored (Haiku) example sentence — never a subtitle
    # extract. None when the sentence worker hasn't covered the word yet.
    example_sentence: Optional[str] = None


class StartSessionResponse(BaseModel):
    session_id: int
    cards: List[CardPayload]


class CardResultPayload(BaseModel):
    word: str
    card_type: str  # "mcq" | "self_rate" (legacy: "type", "synonym_mcq")
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
    # v0.7 §7.5 — movie-anchored sessions return the user's
    # comprehension % before and after the SRS advance for this lesson.
    # The frontend renders the delta as the headline reward on
    # QuizResultScreen. Null for batch / cross-movie sessions where
    # the per-movie figure doesn't apply.
    comprehension_before: Optional[float] = None
    comprehension_after: Optional[float] = None


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
    translations: Dict[str, str],
    *,
    rng: Optional[random.Random] = None,
) -> List[CardSpec]:
    """Compose the card deck. Scored slots become tap-to-answer
    translation MCQs whose distractors come from the other deck words'
    translations. A slot without one (no translation, or too few
    distinct distractors) falls back to self_rate so the session
    length stays fixed."""
    r = rng or random.Random()
    types = pick_card_types(total=len(answers), rng=r)
    cards: List[CardSpec] = []
    for word, card_type in zip(answers, types):
        translation = translations.get(word)
        if card_type == "mcq":
            choices = build_translation_choices(word, translations, rng=r)
            if choices:
                cards.append(CardSpec(
                    word=word, card_type="mcq",
                    translation=translation, choices=choices,
                ))
                continue
        # Self-rate path: either by design, or because neither MCQ format
        # could be built for this word.
        cards.append(CardSpec(
            word=word, card_type="self_rate", translation=translation,
        ))
    return cards


async def _cards_response(
    db: Prisma, session_id: int, cards: List[CardSpec]
) -> StartSessionResponse:
    """Serialize the deck, attaching each word's global LLM-authored
    (Haiku) example sentence — subtitle extracts are never used. Lookup
    misses (sentence-worker backlog) and failures degrade to a
    sentence-less card rather than blocking the session."""
    examples: Dict[str, str] = {}
    try:
        examples = await get_llm_examples_for_lemmas(db, [c.word for c in cards])
    except Exception as e:
        logger.warning(f"[quiz.cards] llm example lookup failed: {e}")
    return StartSessionResponse(
        session_id=session_id,
        cards=[
            CardPayload(**c.__dict__, example_sentence=examples.get(c.word))
            for c in cards
        ],
    )


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
    # Translation MCQs are in the user's native language (falls back to
    # learning language, then "es" if neither is set).
    target_lang = (current_user.nativeLanguage or current_user.learningLanguage or "es").lower()
    translations = await _translate_words(db, answers, target_lang, current_user.id)

    cards = _build_cards(answers, translations, rng=rng)

    session = await db.quizsession.create(data={
        "userId": current_user.id,
        "movieId": body.movie_id,
        "cefrLevel": body.level,
        "kind": body.kind,
    })

    return await _cards_response(db, session.id, cards)


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
    # Scored = translation MCQs, plus "type" / "synonym_mcq" from
    # historical rows (typed cards and the retired synonym format).
    scored_cards = [c for c in cards if c.cardType in ("type", "mcq", "synonym_mcq")]
    correct = sum(1 for c in scored_cards if c.isCorrect)
    total_scored = len(scored_cards)
    self_rate_count = sum(1 for c in cards if c.cardType == "self_rate")
    stars = compute_stars(correct, total_scored)
    xp = compute_xp(correct, self_rate_count, stars)

    # v0.7 §7.5 — snapshot the user's pre-session comprehension % for
    # this movie before SRS advancement runs. The post-session figure
    # is read back after `recompute_for_user_movie`. Both are null for
    # batch / no-movie sessions; the client uses null to suppress the
    # delta UI on QuizResultScreen.
    comprehension_before: Optional[float] = None
    if session.movieId is not None:
        before_row = await db.usermovieprogress.find_unique(
            where={"userId_movieId": {"userId": current_user.id, "movieId": session.movieId}}
        )
        comprehension_before = float(before_row.comprehensibilityPercent) if before_row else 0.0

    # Finalize session.
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    await db.quizsession.update(
        where={"id": session_id},
        data={
            "completedAt": now,
            "stars": stars,
            "correctCount": correct,
            "totalScored": total_scored,
        },
    )

    # Advance per-card SRS state. Quiz-tested IS the "studied" signal — if
    # the user has never seen the word before, create the UserWord row so
    # this session pulls it into the SRS queue going forward.
    #
    # Skipped for batch sessions (session.movieId is None) because the
    # (userId, word, movieId) composite key has no clear value when cards
    # span multiple movies; those are tracked via UnitProgress only.
    if session.movieId is not None:
        srs_correct = 0
        srs_scored = 0
        for c in cards:
            outcome = srs_outcome_for_card(c.cardType, c.isCorrect, c.selfRating)
            if outcome == "skip":
                continue
            card_correct = outcome == "correct"
            existing = await db.userword.find_first(where={
                "userId": current_user.id,
                "word": c.word,
                "movieId": session.movieId,
            })
            if existing is None:
                existing = await db.userword.create(data={
                    "userId": current_user.id,
                    "word": c.word,
                    "movieId": session.movieId,
                })
            await advance_word_after_review(
                db,
                user_word_id=existing.id,
                current_box=existing.srsBox,
                correct=card_correct,
                now=now,
            )
            srs_scored += 1
            if card_correct:
                srs_correct += 1
        if srs_scored > 0:
            await advance_user_rollup_after_review(
                db,
                user_id=current_user.id,
                correct_count=srs_correct,
                total_count=srs_scored,
                today=now.date(),
            )
            # Recompute the reel-tile progress for this movie so the status
            # badge + comprehensibility % reflect the cards we just advanced.
            await recompute_for_user_movie(
                db,
                user_id=current_user.id,
                movie_id=session.movieId,
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

    # v0.7 §7.5 — read the post-session comprehension % back. The
    # earlier `recompute_for_user_movie` already wrote the fresh figure;
    # we just re-fetch it for the response. Null when the session
    # wasn't movie-anchored or the user has no progress row yet.
    comprehension_after: Optional[float] = None
    if session.movieId is not None and comprehension_before is not None:
        after_row = await db.usermovieprogress.find_unique(
            where={"userId_movieId": {"userId": current_user.id, "movieId": session.movieId}}
        )
        comprehension_after = float(after_row.comprehensibilityPercent) if after_row else comprehension_before

    return CompleteSessionResponse(
        stars=stars, xp_earned=xp,
        correct_count=correct, total_scored=total_scored,
        comprehension_before=comprehension_before,
        comprehension_after=comprehension_after,
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
    cards = _build_cards(answers, translations, rng=rng)

    session = await db.quizsession.create(data={
        "userId": current_user.id,
        "movieId": None,
        "cefrLevel": body.level,
        "kind": "batch",
    })

    return await _cards_response(db, session.id, cards)


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


_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]
# Cap how many of a tile's 5 cards can be SRS reintroductions. The rest
# stay new movie-specific lemmas so the user always learns something.
SRS_REINTRO_CAP = 2


def _band_levels(level: str) -> list[str]:
    """CEFR ±1 band as a list of level strings."""
    try:
        i = _LEVELS.index(level)
    except ValueError:
        i = 0
    return _LEVELS[max(0, i - 1): min(len(_LEVELS), i + 2)]


async def _movie_specific_words(
    db: Prisma,
    user_id: int,
    tmdb_id: int,
    level: str,
    words_per_tile: int,
) -> list[str]:
    """Return movie-specific lemmas (lowercase strings) for one tile,
    SRS-due words first (capped), then top-frequency unknowns from the
    movie in the user's CEFR ±1 band. Returns [] if the movie has no
    lemma mappings — caller should fall back to the legacy path.
    """
    band = _band_levels(level)

    # 1. SRS-due reintroductions. Pull from user_words where srs_due_at
    #    is in the past, ordered most-overdue first, capped at the
    #    reintro budget. We don't restrict these to the movie — the
    #    point is they're old debts being paid.
    srs_rows = await db.query_raw(
        """
        SELECT word
        FROM user_words
        WHERE user_id = $1
          AND is_learned = false
          AND srs_due_at <= NOW()
        ORDER BY srs_due_at ASC
        LIMIT $2
        """,
        user_id, SRS_REINTRO_CAP,
    )
    srs_words: list[str] = [r["word"].lower() for r in srs_rows]

    needed = words_per_tile - len(srs_words)
    if needed <= 0:
        return srs_words[:words_per_tile]

    # 2. Movie-specific unknowns at level ±1. Excludes lemmas the user
    #    already has in user_words (whether learned or in SRS queue) so
    #    we don't duplicate the SRS slice.
    band_placeholders = ",".join(f"${i + 4}" for i in range(len(band)))
    movie_rows = await db.query_raw(
        f"""
        SELECT l.lemma
        FROM movie_lemma_mappings mlm
        JOIN movies m  ON m.id = mlm.movie_id
        JOIN lemmas l  ON l.id = mlm.lemma_id
        WHERE m.tmdb_id = $1
          AND l.cefr_level::text IN ({band_placeholders})
          AND NOT EXISTS (
              SELECT 1 FROM user_words uw
              WHERE uw.user_id = $2
                AND LOWER(uw.word) = LOWER(l.lemma)
          )
          AND NOT EXISTS (
              SELECT 1 FROM hidden_words hw
              WHERE LOWER(hw.word) = LOWER(l.lemma)
          )
        ORDER BY mlm.frequency_in_movie DESC, l.frequency_rank ASC NULLS LAST
        LIMIT $3
        """,
        tmdb_id, user_id, needed, *band,
    )
    new_words = [r["lemma"].lower() for r in movie_rows]

    return srs_words + new_words


@router.post("/journey/sessions", response_model=StartSessionResponse)
async def start_journey_session(
    body: StartJourneySessionRequest,
    current_user = Depends(get_current_active_user),
    db: Prisma = Depends(get_db),
):
    """Start a quiz session for one journey tile.

    Word-selection strategy:
      1. If `tmdb_id` is provided AND the movie has lemma mappings on
         file, pull words from THAT movie's subtitle vocab — SRS-due
         lemmas first (capped at SRS_REINTRO_CAP), then top-frequency
         unknown lemmas in the user's CEFR ±1 band.
      2. Otherwise (or if the movie's mapping yields nothing usable),
         fall back to the legacy cross-movie offset query: tile N gets
         the Nth window of frequency-ranked words at the user's level.
    """
    words: list[str] = []
    movie_id: Optional[int] = None

    if body.tmdb_id is not None:
        words = await _movie_specific_words(
            db, current_user.id, body.tmdb_id, body.level, body.words_per_tile,
        )
        # Look up the internal movie id so the session is correctly
        # attributed (powers per-movie progress + stats downstream).
        movie_row = await db.movie.find_first(where={"tmdbId": body.tmdb_id})
        if movie_row:
            movie_id = movie_row.id

    if not words:
        offset = body.tile_index * body.words_per_tile
        words = await _get_journey_words_at_level(
            db, body.level, offset, body.words_per_tile
        )

    if not words:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No words available at level {body.level} for tile "
                f"{body.tile_index}."
            ),
        )

    target_lang = (
        current_user.nativeLanguage
        or current_user.learningLanguage
        or "es"
    ).lower()
    translations = await _translate_words(db, words, target_lang, current_user.id)
    cards = _build_cards(words, translations)

    session = await db.quizsession.create(data={
        "userId": current_user.id,
        "movieId": movie_id,
        "cefrLevel": body.level,
        "kind": "journey",
    })

    return await _cards_response(db, session.id, cards)
