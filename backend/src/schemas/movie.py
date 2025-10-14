from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from ..models.movie import DifficultyLevel


class MovieCreate(BaseModel):
    title: str
    year: int
    genre: Optional[str] = None
    difficulty_level: Optional[DifficultyLevel] = DifficultyLevel.INTERMEDIATE
    script_text: Optional[str] = None
    description: Optional[str] = None
    poster_url: Optional[str] = None


class MovieResponse(BaseModel):
    id: int
    title: str
    year: int
    genre: Optional[str]
    difficulty_level: DifficultyLevel
    word_count: int
    description: Optional[str]
    poster_url: Optional[str]
    created_at: datetime
    
    class Config:
        from_attributes = True


class MovieListResponse(BaseModel):
    movies: List[MovieResponse]
    total: int
    page: int
    page_size: int


