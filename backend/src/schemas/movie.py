from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from prisma.enums import difficultylevel


class MovieCreate(BaseModel):
    title: str
    year: int
    genre: Optional[str] = None
    difficulty_level: Optional[difficultylevel] = difficultylevel.INTERMEDIATE
    script_text: Optional[str] = None
    description: Optional[str] = None
    poster_url: Optional[str] = None


class MovieResponse(BaseModel):
    id: int
    title: str
    year: int
    genre: Optional[str]
    difficultyLevel: Optional[difficultylevel]
    wordCount: Optional[int]
    description: Optional[str]
    poster_url: Optional[str]
    createdAt: Optional[datetime]

    class Config:
        from_attributes = True


class MovieListResponse(BaseModel):
    movies: List[MovieResponse]
    total: int
    page: int
    page_size: int


