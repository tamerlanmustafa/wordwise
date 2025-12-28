"""
Book Schemas

Request and response schemas for book-related endpoints.
"""

from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime
from prisma.enums import difficultylevel


class BookResponse(BaseModel):
    """Response for a single book"""
    id: int
    title: str
    author: Optional[str]
    year: Optional[int]
    description: Optional[str]
    coverUrl: Optional[str]
    gutenbergId: Optional[int]
    openLibraryKey: Optional[str]
    isbn: Optional[str]
    difficultyLevel: Optional[difficultylevel]
    difficultyScore: Optional[int]
    wordCount: Optional[int]
    createdAt: datetime

    class Config:
        from_attributes = True


class BookListResponse(BaseModel):
    """Response for list of books"""
    books: List[BookResponse]
    total: int
    page: int
    page_size: int


class BookSearchResult(BaseModel):
    """Search result from Gutendex/Open Library"""
    gutenberg_id: int
    title: str
    author: Optional[str]
    authors: List[str] = []
    year: Optional[int]
    subjects: List[str] = []
    cover_small: Optional[str]
    cover_medium: Optional[str]
    cover_large: Optional[str]
    is_public_domain: bool = True
    download_count: Optional[int]
    plain_text_url: Optional[str]
    open_library_key: Optional[str]


class BookSearchResponse(BaseModel):
    """Response for book search"""
    query: str
    books: List[BookSearchResult]
    total: int
    has_text: bool
    source: str


class BookAnalyzeResponse(BaseModel):
    """Response after analyzing a book"""
    book_id: int
    title: str
    author: Optional[str]
    word_count: int
    unique_words: int
    cefr_distribution: Dict[str, int]
    difficulty_level: Optional[str]
    difficulty_score: Optional[int]
    already_exists: bool
    warning: Optional[str] = None


class BookVocabularyWord(BaseModel):
    """A word in the book vocabulary"""
    word: str
    lemma: str
    cefr_level: str
    confidence: float
    frequency_rank: Optional[int]


class BookVocabularyResponse(BaseModel):
    """Vocabulary analysis for a book"""
    book_id: int
    title: str
    total_words: int
    unique_words: int
    level_distribution: Dict[str, int]
    top_words_by_level: Dict[str, List[BookVocabularyWord]]
