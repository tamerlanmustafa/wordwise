from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class MovieCreate(BaseModel):
    title: str
    year: int
    genre: Optional[str] = None
    script_text: Optional[str] = None
    description: Optional[str] = None
    poster_url: Optional[str] = None


class MovieResponse(BaseModel):
    id: int
    title: str
    year: int
    genre: Optional[str]
    # #103: a movie's level is derived from `difficultyScore`, never stored, so
    # there is no level field to echo back here. Callers that need one ask
    # /movies/{id}/difficulty or read it off the by-level / by-cefr rows.
    difficultyScore: Optional[int]
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


class ScriptSearchResponse(BaseModel):
    title: str
    subtitle: Optional[str] = None
    writer: Optional[str] = None
    link: str


