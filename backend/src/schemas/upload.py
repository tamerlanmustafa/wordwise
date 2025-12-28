"""
File Upload Schemas

Request and response schemas for file upload endpoints.
"""

from pydantic import BaseModel
from typing import Dict, Optional


class FileUploadResponse(BaseModel):
    """Response after successful file upload and processing"""
    movie_id: int
    title: str
    word_count: int
    unique_words: int
    cefr_distribution: Dict[str, int]

    class Config:
        from_attributes = True
