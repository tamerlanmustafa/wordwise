from fastapi import APIRouter, Depends, HTTPException, status, Query
from prisma import Prisma
from prisma.enums import difficultylevel
from typing import Optional, List
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


