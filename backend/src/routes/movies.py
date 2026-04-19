import json
from fastapi import APIRouter, Depends, HTTPException, status, Query
from prisma import Prisma
from prisma.enums import difficultylevel
from typing import Optional, List, Dict, Any
from ..database import get_db
from ..schemas.movie import MovieCreate, MovieResponse, MovieListResponse, ScriptSearchResponse
from ..middleware.auth import get_current_active_user
from ..services import STANDS4ScriptsClient

router = APIRouter(prefix="/movies", tags=["movies"])


@router.get("/", response_model=MovieListResponse)
async def list_movies(
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=100),
    difficulty: Optional[difficultylevel] = None,
    db: Prisma = Depends(get_db)
):
    """List all movies with pagination and optional filtering"""
    where_clause = {}

    if difficulty:
        where_clause["difficultyLevel"] = difficulty

    total = await db.movie.count(where=where_clause)
    movies = await db.movie.find_many(
        where=where_clause,
        skip=skip,
        take=limit
    )

    return {
        "movies": movies,
        "total": total,
        "page": skip // limit + 1,
        "page_size": limit
    }


@router.get("/by-level")
async def list_movies_by_level(
    level: str = Query(..., description="Difficulty level: ELEMENTARY, INTERMEDIATE, ADVANCED, etc."),
    limit: int = Query(50, ge=1, le=200),
    db: Prisma = Depends(get_db),
):
    """
    List processed movies filtered by their stored CEFR difficulty level.
    Joined with movie_jobs to surface tmdb_id (when available) so the
    mobile client can lazily fetch poster/overview from TMDB.
    """
    try:
        target = level.upper()
        # Validate against enum
        difficultylevel(target)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid level: {level}")

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
        WHERE m.difficulty_level::text = $1
        ORDER BY m.difficulty_score ASC NULLS LAST, m.id ASC
        LIMIT $2
        """,
        target,
        limit,
    )

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


CEFR_SCORE_RANGES = {
    "A1": (0, 24),
    "A2": (25, 34),
    "B1": (35, 44),
    "B2": (45, 54),
    "C1": (55, 69),
    "C2": (70, 100),
}


@router.get("/by-cefr")
async def list_movies_by_cefr(
    level: str = Query(..., description="CEFR level: A1, A2, B1, B2, C1, C2"),
    genre: Optional[str] = Query(None, description="Genre name to filter by (e.g. Drama, Comedy)"),
    limit: int = Query(15, ge=1, le=100),
    db: Prisma = Depends(get_db),
):
    """List movies whose difficulty score falls within a CEFR level range, optionally filtered by genre."""
    key = level.upper()
    if key not in CEFR_SCORE_RANGES:
        raise HTTPException(status_code=400, detail=f"Invalid CEFR level: {level}")

    lo, hi = CEFR_SCORE_RANGES[key]

    if genre:
        rows = await db.query_raw(
            """
            SELECT m.id                AS movie_id,
                   m.title             AS title,
                   m.year              AS year,
                   m.poster_url        AS poster_url,
                   m.description       AS description,
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
              AND m.genre IS NOT NULL
              AND m.genre ILIKE '%' || $3 || '%'
              AND COALESCE(m.tmdb_vote_count, 0) >= 50
            ORDER BY m.tmdb_vote_average DESC NULLS LAST, m.difficulty_score ASC
            LIMIT $4
            """,
            lo,
            hi,
            genre,
            limit,
        )
    else:
        rows = await db.query_raw(
            """
            SELECT m.id                AS movie_id,
                   m.title             AS title,
                   m.year              AS year,
                   m.poster_url        AS poster_url,
                   m.description       AS description,
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
              AND COALESCE(m.tmdb_vote_count, 0) >= 50
            ORDER BY m.tmdb_vote_average DESC NULLS LAST, m.difficulty_score ASC
            LIMIT $3
            """,
            lo,
            hi,
            limit,
        )

    return {
        "level": key,
        "movies": [
            {
                "movie_id": r["movie_id"],
                "tmdb_id": r["tmdb_id"],
                "title": r["title"],
                "year": r["year"],
                "poster_url": r["poster_url"],
                "description": r["description"],
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
    }


@router.get("/{movie_id}", response_model=MovieResponse)
async def get_movie(movie_id: int, db: Prisma = Depends(get_db)):
    """Get a specific movie by ID"""
    movie = await db.movie.find_unique(where={"id": movie_id})

    if not movie:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Movie not found"
        )

    return movie


@router.get("/{movie_id}/difficulty")
async def get_movie_difficulty(movie_id: int, db: Prisma = Depends(get_db)):
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

    # Map difficulty level to CEFR level based on score
    difficulty_level = None
    if movie.difficultyScore is not None:
        # Map 0-100 score to CEFR levels
        score = movie.difficultyScore
        if score < 20:
            difficulty_level = "A1"
        elif score < 35:
            difficulty_level = "A2"
        elif score < 50:
            difficulty_level = "B1"
        elif score < 65:
            difficulty_level = "B2"
        elif score < 80:
            difficulty_level = "C1"
        else:
            difficulty_level = "C2"

    return {
        "difficulty_level": difficulty_level,
        "difficulty_score": movie.difficultyScore,
        "breakdown": breakdown
    }


@router.get("/recommendations")
async def get_movie_recommendations(
    level: Optional[str] = Query(None),
    limit: int = Query(10, ge=1, le=50),
    db: Prisma = Depends(get_db)
):
    where_clause = {}

    if level:
        from prisma.enums import difficultylevel
        try:
            target_level = difficultylevel(level.upper())
            where_clause["difficultyLevel"] = target_level
        except ValueError:
            pass

    movies = await db.movie.find_many(
        where=where_clause,
        take=limit,
        order={"difficultyScore": "asc"}
    )

    return {"movies": movies, "level": level, "total": len(movies)}


@router.post("/", response_model=MovieResponse, status_code=status.HTTP_201_CREATED)
async def create_movie(
    movie_data: MovieCreate,
    current_user = Depends(get_current_active_user),
    db: Prisma = Depends(get_db)
):
    """Create a new movie (admin only for now)"""
    # Check if user is admin (for now, allow all authenticated users)
    # TODO: Add proper admin check

    new_movie = await db.movie.create(
        data={
            "title": movie_data.title,
            "year": movie_data.year,
            "genre": movie_data.genre,
            "difficultyLevel": movie_data.difficulty_level,
            "script_text": movie_data.script_text,
            "description": movie_data.description,
            "poster_url": movie_data.poster_url
        }
    )

    return new_movie


@router.get("/scripts/search", response_model=List[ScriptSearchResponse])
async def search_scripts(
    query: str = Query(..., min_length=1, description="Movie title to search for")
):
    """Search for movie scripts using STANDS4 API"""
    if not query or len(query.strip()) == 0:
        return []

    try:
        client = STANDS4ScriptsClient()
        results = await client.search_script(query)

        return [
            ScriptSearchResponse(
                title=result.title,
                subtitle=result.subtitle,
                writer=result.writer,
                link=result.link
            )
            for result in results
        ]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to search scripts: {str(e)}"
        )


@router.get("/{movie_id}/vocabulary/preview")
async def get_vocabulary_preview(
    movie_id: int,
    db: Prisma = Depends(get_db)
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

    # Group by level and take first 3 from each
    top_words_by_level: Dict[str, List[Dict[str, Any]]] = {}
    level_distribution: Dict[str, int] = {"A1": 0, "A2": 0, "B1": 0, "B2": 0, "C1": 0, "C2": 0}

    for word in all_words:
        level = word.cefrLevel if isinstance(word.cefrLevel, str) else word.cefrLevel.value
        level_distribution[level] = level_distribution.get(level, 0) + 1

        if level not in top_words_by_level:
            top_words_by_level[level] = []
        if len(top_words_by_level[level]) < 3:
            top_words_by_level[level].append({
                "word": word.word,
                "lemma": word.lemma,
                "confidence": word.confidence,
                "frequency_rank": word.frequencyRank
            })

    # Detect idioms from script text
    from src.services.cefr_classifier import detect_phrasal_verbs_and_idioms

    idioms = []
    if script.cleanedScriptText:
        try:
            idiom_results = detect_phrasal_verbs_and_idioms(script.cleanedScriptText)
            idioms = [
                {
                    "phrase": phrase,
                    "type": expr_type,
                    "cefr_level": level,
                    "words": phrase.split()
                }
                for phrase, expr_type, level in idiom_results
            ]
        except Exception as e:
            print(f"Error detecting idioms: {e}")
            idioms = []

    return {
        "movie_id": movie_id,
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

    from src.routes.cefr import should_keep_word

    # Group by level, filtering ultra-common A1 words
    top_words_by_level: Dict[str, List[Dict[str, Any]]] = {}
    level_distribution: Dict[str, int] = {"A1": 0, "A2": 0, "B1": 0, "B2": 0, "C1": 0, "C2": 0}

    # Lazy-load wordfreq for on-the-fly rank backfill. Only 7% of stored
    # classifications have frequency_rank populated, so without this the
    # client-side common/rare sort is a no-op for most words.
    try:
        import wordfreq as _wordfreq
    except Exception:
        _wordfreq = None

    _rank_cache: Dict[str, Optional[int]] = {}

    def _compute_rank(token: str) -> Optional[int]:
        if _wordfreq is None:
            return None
        key = token.lower()
        if key in _rank_cache:
            return _rank_cache[key]
        try:
            zipf = _wordfreq.zipf_frequency(key, 'en')
            rank = int(10 ** (7 - zipf)) if zipf > 0 else 100000
        except Exception:
            rank = None
        _rank_cache[key] = rank
        return rank

    for word in cefr_words:
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
            "word": word.word,
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

    # Detect idioms from script text
    from src.services.cefr_classifier import detect_phrasal_verbs_and_idioms

    idioms = []
    if script.cleanedScriptText:
        try:
            idiom_results = detect_phrasal_verbs_and_idioms(script.cleanedScriptText)
            idioms = [
                {
                    "phrase": phrase,
                    "type": expr_type,
                    "cefr_level": level,
                    "words": phrase.split()
                }
                for phrase, expr_type, level in idiom_results
            ]
        except Exception as e:
            print(f"Error detecting idioms: {e}")
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


