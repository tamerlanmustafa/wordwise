from sqlalchemy import Column, Integer, String, Text, ForeignKey, Float, Enum
from sqlalchemy.orm import relationship
import enum
from ..database import Base


class DifficultyLevel(str, enum.Enum):
    A1 = "A1"
    A2 = "A2"
    B1 = "B1"
    B2 = "B2"
    C1 = "C1"
    C2 = "C2"


class Word(Base):
    __tablename__ = "words"
    
    id = Column(Integer, primary_key=True, index=True)
    word = Column(String, nullable=False, index=True)
    definition = Column(Text)
    difficulty_level = Column(Enum(DifficultyLevel), default=DifficultyLevel.A1)
    frequency = Column(Float, default=0.0)
    part_of_speech = Column(String)
    example_sentence = Column(Text)
    translation = Column(String)
    
    # Foreign Keys
    movie_id = Column(Integer, ForeignKey("movies.id"), nullable=True)
    
    # Relationships
    movie = relationship("Movie", back_populates="words")
    user_lists = relationship("UserWordList", back_populates="word", cascade="all, delete-orphan")


