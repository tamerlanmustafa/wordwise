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
    movie = await db.movie.find_unique(where={"id": movie_id})

    if not movie:
        raise HTTPException(status_code=404, detail="Movie not found")

    return {
        "difficulty_level": movie.difficultyLevel.value if movie.difficultyLevel else None,
        "difficulty_score": movie.difficultyScore,
        "distribution": movie.cefrDistribution
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
    Returns only 3 sample words from each CEFR level, no translations.
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

    return {
        "movie_id": movie_id,
        "total_words": len(all_words),
        "unique_words": len(all_words),
        "level_distribution": level_distribution,
        "top_words_by_level": top_words_by_level,
        "average_confidence": sum(w.confidence for w in all_words) / len(all_words) if all_words else 0,
        "wordlist_coverage": 0.0,
        "preview": True
    }


@router.get("/{movie_id}/vocabulary/full")
async def get_vocabulary_full(
    movie_id: int,
    current_user = Depends(get_current_active_user),
    db: Prisma = Depends(get_db)
) -> Dict[str, Any]:
    """
    Get the complete movie vocabulary (PROTECTED - auth required).
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

    for word in cefr_words:
        level = word.cefrLevel if isinstance(word.cefrLevel, str) else word.cefrLevel.value

        if not should_keep_word(word.word, word.lemma, level):
            continue

        level_distribution[level] = level_distribution.get(level, 0) + 1

        if level not in top_words_by_level:
            top_words_by_level[level] = []
        top_words_by_level[level].append({
            "word": word.word,
            "lemma": word.lemma,
            "confidence": word.confidence,
            "frequency_rank": word.frequencyRank
        })

    for level in top_words_by_level:
        top_words_by_level[level].sort(
            key=lambda x: (x['frequency_rank'] is None, x['frequency_rank'] or 999999),
            reverse=True
        )

    return {
        "movie_id": movie_id,
        "script_id": 0,
        "total_words": len(cefr_words),
        "unique_words": len(cefr_words),
        "level_distribution": level_distribution,
        "top_words_by_level": top_words_by_level,
        "average_confidence": sum(w.confidence for w in cefr_words) / len(cefr_words) if cefr_words else 0,
        "wordlist_coverage": 0.0,
        "preview": False
    }


