from pydantic import BaseModel
from typing import Optional
from prisma.enums import difficultylevel


class WordCreate(BaseModel):
    word: str
    definition: Optional[str] = None
    difficulty_level: Optional[difficultylevel] = difficultylevel.BEGINNER
    frequency: Optional[float] = 0.0
    part_of_speech: Optional[str] = None
    example_sentence: Optional[str] = None
    translation: Optional[str] = None


class WordResponse(BaseModel):
    id: int
    word: str
    definition: Optional[str]
    difficulty_level: Optional[difficultylevel]
    frequency: Optional[float]
    part_of_speech: Optional[str]
    example_sentence: Optional[str]
    translation: Optional[str]

    class Config:
        from_attributes = True


