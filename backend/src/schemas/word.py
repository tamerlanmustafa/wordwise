from pydantic import BaseModel
from typing import Optional
from ..models.word import DifficultyLevel


class WordCreate(BaseModel):
    word: str
    definition: Optional[str] = None
    difficulty_level: Optional[DifficultyLevel] = DifficultyLevel.A1
    frequency: Optional[float] = 0.0
    part_of_speech: Optional[str] = None
    example_sentence: Optional[str] = None
    translation: Optional[str] = None


class WordResponse(BaseModel):
    id: int
    word: str
    definition: Optional[str]
    difficulty_level: DifficultyLevel
    frequency: float
    part_of_speech: Optional[str]
    example_sentence: Optional[str]
    translation: Optional[str]
    
    class Config:
        from_attributes = True


