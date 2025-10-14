from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from ..database import get_db
from ..models.movie import Movie
from ..models.user import User
from ..schemas.movie import MovieCreate, MovieResponse, MovieListResponse
from ..middleware.auth import get_current_active_user

router = APIRouter(prefix="/movies", tags=["movies"])


@router.get("/", response_model=MovieListResponse)
async def list_movies(
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=100),
    difficulty: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """List all movies with pagination and optional filtering"""
    query = db.query(Movie)
    
    if difficulty:
        query = query.filter(Movie.difficulty_level == difficulty)
    
    total = query.count()
    movies = query.offset(skip).limit(limit).all()
    
    return {
        "movies": movies,
        "total": total,
        "page": skip // limit + 1,
        "page_size": limit
    }


@router.get("/{movie_id}", response_model=MovieResponse)
async def get_movie(movie_id: int, db: Session = Depends(get_db)):
    """Get a specific movie by ID"""
    movie = db.query(Movie).filter(Movie.id == movie_id).first()
    
    if not movie:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Movie not found"
        )
    
    return movie


@router.post("/", response_model=MovieResponse, status_code=status.HTTP_201_CREATED)
async def create_movie(
    movie_data: MovieCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """Create a new movie (admin only for now)"""
    # Check if user is admin (for now, allow all authenticated users)
    # TODO: Add proper admin check
    
    new_movie = Movie(
        title=movie_data.title,
        year=movie_data.year,
        genre=movie_data.genre,
        difficulty_level=movie_data.difficulty_level,
        script_text=movie_data.script_text,
        description=movie_data.description,
        poster_url=movie_data.poster_url
    )
    
    db.add(new_movie)
    db.commit()
    db.refresh(new_movie)
    
    return new_movie


