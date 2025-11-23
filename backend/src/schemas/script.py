"""
Pydantic schemas for script-related API endpoints
"""

from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from datetime import datetime
from prisma.enums import scriptsource


class ScriptMetadata(BaseModel):
    """Metadata about script processing"""
    title: Optional[str] = None
    year: Optional[str] = None
    author: Optional[str] = None
    genre: Optional[str] = None
    pdf_url: Optional[str] = None
    method: Optional[str] = None
    pages: Optional[int] = None
    total_blocks: Optional[int] = None
    dialogue_lines: Optional[int] = None
    format: Optional[str] = None


class ScriptResponse(BaseModel):
    """Response schema for script retrieval"""
    script_id: int
    movie_id: int
    source_used: str
    cleaned_text: str
    word_count: int
    is_complete: bool
    is_truncated: bool
    from_cache: bool
    metadata: Dict[str, Any] = Field(default_factory=dict)
    fetched_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ScriptFetchRequest(BaseModel):
    """Request schema for fetching a script"""
    movie_title: Optional[str] = Field(None, min_length=1, max_length=200)
    script_id: Optional[str] = Field(None, description="STANDS4 script ID (from search results)")
    movie_id: Optional[int] = None
    year: Optional[int] = Field(None, ge=1900, le=2100)
    force_refresh: bool = Field(False, description="Force refetch even if cached")


class ScriptSearchResponse(BaseModel):
    """Response for script search"""
    movie_title: str
    has_cached_script: bool
    cached_source: Optional[str] = None
    cached_word_count: Optional[int] = None


class ScriptStatsResponse(BaseModel):
    """Statistics about script library"""
    total_scripts: int
    by_source: Dict[str, int]
    total_words: int
    avg_words_per_script: float
    complete_scripts: int
    truncated_scripts: int
